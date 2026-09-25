import { defineScenario, transition, Keyboard } from "@maxhub/max-bot-api";
import {
  test1Questions,
  test2Questions,
  test1MaxScore,
  test2MaxScore,
  PASS_THRESHOLD_PERCENT,
} from "./questions.js";
import { appendCandidateRow } from "./results-store.js";
import { sendCandidatesFile } from "./notify-email.js";

// ВАЖНО про архитектуру этого файла (наступили на грабли 2026-09-25):
// ScenarioEngine выполняет обработчик ТЕКУЩЕГО шага один раз на одно
// входящее событие и НЕ выполняет автоматически следующий шаг после
// transition.goto(...) — новый шаг просто становится "текущим" и будет
// выполнен только при СЛЕДУЮЩЕМ входящем событии. Поэтому КАЖДЫЙ шаг
// обязан сам отправить всё, что должно быть видно пользователю как
// результат этого события (следующий вопрос, отказ, финал) — ПРЯМО
// внутри своего обработчика, а не полагаться на то, что это сделает
// шаг, на который мы transition.goto(...). Раньше вопросы были разбиты
// на "показ" и "-wait" шаги отдельно — это давало эффект "нужно нажать
// кнопку дважды" (для соседних вопросов) и полную остановку на переходе
// между тестами (там кнопки вообще не было, второму событию неоткуда
// взяться).

function questionKeyboard(question) {
  const buttons = question.options.map((opt) => [
    Keyboard.button.callback(opt.text, `${question.id}:${opt.text}`),
  ]);
  return Keyboard.inlineKeyboard(buttons);
}

async function sendQuestion(ctx, testLabel, question, index, total) {
  await ctx.reply(
    `${testLabel}\nВопрос ${index + 1} из ${total} (${question.block})\n\n${question.text}`,
    { attachments: [questionKeyboard(question)] },
  );
}

const WELCOME_TEXT =
  "Здравствуйте! Это бот ООО «ОП «РЖД-ОХРАНА» — крупнейшего предприятия по " +
  "охране объектов, имущества и обеспечению порядка на объектах " +
  "железнодорожного транспорта.\n\n" +
  "Мы предлагаем: официальное оформление по ТК РФ, расширенный соцпакет и " +
  "ДМС, оплату проезда в отпуск раз в год, санаторно-курортное лечение, " +
  "реферальную программу.\n\n" +
  "Дальше — два коротких теста кандидата: квалификация и психологическая " +
  "пригодность (10-15 минут).";

const REJECT_TEXT =
  "Спасибо за ответы. К сожалению, по результатам теста мы не можем продолжить " +
  "рассмотрение вашей кандидатуры на данную позицию.";

const TEST1_LABEL = "Тест 1 из 2 — Квалификация";
const TEST2_LABEL = "Тест 2 из 2 — Психологическая пригодность";

function startTestKeyboard() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback("Пройти тест", "start-test")]]);
}

export function initialCandidateData(prefill) {
  return {
    fio: null,
    phone: null,
    grade: null,
    pendingDocs: [],
    test1Answers: {},
    test1Score: 0,
    test2Answers: {},
    test2Score: 0,
    ...(prefill || {}),
  };
}

export const candidateTest = defineScenario()({
  id: "candidate-test",
  initialStep: "welcome",
  idleTimeoutMs: 30 * 60 * 1000,
  createData: () => initialCandidateData(),
  steps: buildSteps(),
});

function buildSteps() {
  const steps = {};

  steps.welcome = async ({ ctx }) => {
    await ctx.reply(WELCOME_TEXT, { attachments: [startTestKeyboard()] });
    return transition.goto("welcome-wait", {});
  };

  steps["welcome-wait"] = async ({ ctx, data }) => {
    if (ctx.callback?.payload !== "start-test") {
      return transition.stay();
    }
    await ctx.answerOnCallback().catch(() => {});
    if (data.fio && data.phone) {
      await sendQuestion(ctx, TEST1_LABEL, test1Questions[0], 0, test1Questions.length);
      return transition.goto("t1_0", {});
    }
    await ctx.reply("Как к вам обращаться? Напишите ФИО.");
    return transition.goto("ask-fio", {});
  };

  steps["ask-fio"] = async ({ ctx }) => {
    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await ctx.reply("Пожалуйста, напишите ФИО текстом.");
      return transition.stay();
    }
    await ctx.reply("Контактный телефон для связи?");
    return transition.goto("ask-phone", { fio: text });
  };

  steps["ask-phone"] = async ({ ctx }) => {
    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await ctx.reply("Пожалуйста, напишите номер телефона текстом.");
      return transition.stay();
    }
    await sendQuestion(ctx, TEST1_LABEL, test1Questions[0], 0, test1Questions.length);
    return transition.goto("t1_0", { phone: text });
  };

  buildTest(steps, {
    questions: test1Questions,
    prefix: "t1_",
    testLabel: TEST1_LABEL,
    answersKey: "test1Answers",
    scoreKey: "test1Score",
    onComplete: onTest1Complete,
  });

  buildTest(steps, {
    questions: test2Questions,
    prefix: "t2_",
    testLabel: TEST2_LABEL,
    answersKey: "test2Answers",
    scoreKey: "test2Score",
    onComplete: onTest2Complete,
  });

  return steps;

  // Последний вопрос Теста 1 отвечен: считаем результат и либо отсеиваем,
  // либо показываем первый вопрос Теста 2 прямо здесь же.
  async function onTest1Complete(ctx, data) {
    const percent = test1MaxScore > 0 ? Math.round((data.test1Score / test1MaxScore) * 100) : 0;
    const passed = percent >= PASS_THRESHOLD_PERCENT;
    if (!passed) {
      await ctx.reply(REJECT_TEXT);
      await saveResult({ data, rejectReason: `не набрал проходной балл в Тесте 1 (${percent}%)` });
      return transition.complete();
    }
    await ctx.reply("Первый тест пройден. Переходим ко второму — психологическая пригодность.");
    await sendQuestion(ctx, TEST2_LABEL, test2Questions[0], 0, test2Questions.length);
    return transition.goto("t2_0", {});
  }

  // Последний вопрос Теста 2 отвечен: финал, без отсева по баллам Теста 2.
  async function onTest2Complete(ctx, data) {
    await ctx.reply(
      "Тест пройден, спасибо! Ваши ответы переданы менеджеру по подбору " +
        "персонала — мы свяжемся с вами по указанному телефону.",
    );
    await saveResult({ data, rejectReason: null });
    return transition.complete();
  }
}

// Регистрирует по одному шагу на вопрос (плюс шаг follow-up, если задан
// followUpOnFail). Каждый шаг сам отправляет то, что должно появиться
// дальше — следующий вопрос, follow-up-вопрос, отказ или результат теста
// (через onComplete) — до того как сделать transition.goto(...).
function buildTest(steps, { questions, prefix, testLabel, answersKey, scoreKey, onComplete }) {
  const total = questions.length;
  const stepIdFor = (idx) => `${prefix}${idx}`;

  questions.forEach((question, i) => {
    const stepId = stepIdFor(i);
    const nextIndex = i + 1;

    steps[stepId] = async ({ ctx, data }) => {
      const payload = ctx.callback?.payload;
      if (!payload || !payload.startsWith(`${question.id}:`)) {
        await ctx.reply("Пожалуйста, выберите вариант кнопкой выше.");
        return transition.stay();
      }
      await ctx.answerOnCallback().catch(() => {});

      const chosenText = payload.slice(question.id.length + 1);
      const option = question.options.find((o) => o.text === chosenText);
      const answers = { ...data[answersKey], [question.id]: chosenText };
      const patch = { [answersKey]: answers };
      if (question.id === "t1q2") {
        // разряд удостоверения фиксируем отдельно для анкеты
        patch.grade = chosenText;
      }

      if (question.type === "filter" && option?.pass === false) {
        if (question.followUpOnFail) {
          const fu = question.followUpOnFail;
          await ctx.reply(fu.text, { attachments: [questionKeyboard(fu)] });
          return transition.goto(`${stepId}f`, patch);
        }
        await ctx.reply(REJECT_TEXT);
        await saveResult({ data: { ...data, ...patch }, rejectReason: option.rejectReason });
        return transition.complete();
      }

      patch[scoreKey] = data[scoreKey] + (option?.score ?? 0);
      const nextData = { ...data, ...patch };

      if (nextIndex < total) {
        await sendQuestion(ctx, testLabel, questions[nextIndex], nextIndex, total);
        return transition.goto(stepIdFor(nextIndex), patch);
      }
      return onComplete(ctx, nextData);
    };

    if (question.followUpOnFail) {
      const fu = question.followUpOnFail;
      const targetIndex = nextIndex + (fu.skipNext ?? 0);

      steps[`${stepId}f`] = async ({ ctx, data }) => {
        const payload = ctx.callback?.payload;
        if (!payload || !payload.startsWith(`${fu.id}:`)) {
          await ctx.reply("Пожалуйста, выберите вариант кнопкой выше.");
          return transition.stay();
        }
        await ctx.answerOnCallback().catch(() => {});

        const chosenText = payload.slice(fu.id.length + 1);
        const willing = fu.options.find((o) => o.text === chosenText)?.willing;

        if (!willing) {
          await ctx.reply(REJECT_TEXT);
          await saveResult({
            data,
            rejectReason: question.options.find((o) => o.pass === false)?.rejectReason,
          });
          return transition.complete();
        }

        const patch = { pendingDocs: [...data.pendingDocs, fu.note] };
        const nextData = { ...data, ...patch };

        if (targetIndex < total) {
          await sendQuestion(ctx, testLabel, questions[targetIndex], targetIndex, total);
          return transition.goto(stepIdFor(targetIndex), patch);
        }
        return onComplete(ctx, nextData);
      };
    }
  });
}

async function saveResult({ data, rejectReason }) {
  const test1Percent = test1MaxScore > 0 ? Math.round((data.test1Score / test1MaxScore) * 100) : 0;
  const test2Percent = test2MaxScore > 0 ? Math.round((data.test2Score / test2MaxScore) * 100) : 0;

  const test1 = data.test1Answers && Object.keys(data.test1Answers).length
    ? { score: data.test1Score, maxScore: test1MaxScore, percent: test1Percent }
    : null;
  const test2 = data.test2Answers && Object.keys(data.test2Answers).length
    ? { score: data.test2Score, maxScore: test2MaxScore, percent: test2Percent }
    : null;

  const pendingNote = data.pendingDocs?.length ? ` (${data.pendingDocs.join(", ")})` : "";
  const finalResult = rejectReason
    ? `Отсеян: ${rejectReason}`
    : `Прошёл оба теста, рекомендован${pendingNote}`;

  try {
    await appendCandidateRow({
      fio: data.fio,
      phone: data.phone,
      grade: data.grade,
      test1,
      test2,
      finalResult,
    });
    await sendCandidatesFile();
  } catch (err) {
    console.error("Не удалось сохранить/отправить результат кандидата:", err);
  }
}
