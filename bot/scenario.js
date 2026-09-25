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

function questionKeyboard(question) {
  const buttons = question.options.map((opt) => [
    Keyboard.button.callback(opt.text, `${question.id}:${opt.text}`),
  ]);
  return Keyboard.inlineKeyboard(buttons);
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

function startTestKeyboard() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback("Пройти тест", "start-test")]]);
}

// Единый источник формы начальных данных сессии — используется и здесь
// (createData), и в bot.js при старте с prefill (ФИО/телефон с сайта),
// чтобы структура не расходилась между файлами (расходилась раньше —
// bot.js передавал scenarios.start() свою функцию createData, которая
// ПОЛНОСТЬЮ заменяет эту, а не мержится с ней, и имела старые поля
// answers/score от версии с одним тестом — test1Score оставался undefined
// всю сессию).
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
    if (data.fio && data.phone) {
      return transition.goto("t1_0", {});
    }
    return transition.goto("ask-fio", {});
  };

  steps["ask-fio"] = async ({ ctx }) => {
    await ctx.reply("Как к вам обращаться? Напишите ФИО.");
    return transition.goto("ask-fio-wait", {});
  };

  steps["ask-fio-wait"] = async ({ ctx }) => {
    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await ctx.reply("Пожалуйста, напишите ФИО текстом.");
      return transition.stay();
    }
    return transition.goto("ask-phone", { fio: text });
  };

  steps["ask-phone"] = async ({ ctx }) => {
    await ctx.reply("Контактный телефон для связи?");
    return transition.goto("ask-phone-wait", {});
  };

  steps["ask-phone-wait"] = async ({ ctx }) => {
    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await ctx.reply("Пожалуйста, напишите номер телефона текстом.");
      return transition.stay();
    }
    return transition.goto("t1_0", { phone: text });
  };

  buildTestSteps(steps, {
    questions: test1Questions,
    prefix: "t1_",
    testLabel: "Тест 1 из 2 — Квалификация",
    answersKey: "test1Answers",
    scoreKey: "test1Score",
    onFilterFail: "rejected",
    afterLast: "t1-result",
  });

  steps["t1-result"] = async ({ ctx, data }) => {
    const percent = test1MaxScore > 0 ? Math.round((data.test1Score / test1MaxScore) * 100) : 0;
    const passed = percent >= PASS_THRESHOLD_PERCENT;
    if (!passed) {
      return transition.goto("rejected", {
        rejectReason: `не набрал проходной балл в Тесте 1 (${percent}%)`,
      });
    }
    await ctx.reply("Первый тест пройден. Переходим ко второму — психологическая пригодность.");
    return transition.goto("t2_0", {});
  };

  buildTestSteps(steps, {
    questions: test2Questions,
    prefix: "t2_",
    testLabel: "Тест 2 из 2 — Психологическая пригодность",
    answersKey: "test2Answers",
    scoreKey: "test2Score",
    onFilterFail: null, // тест 2 не отсеивает жёстко, только баллы
    afterLast: "finish",
  });

  steps.rejected = async ({ ctx, data }) => {
    await ctx.reply(
      "Спасибо за ответы. К сожалению, по результатам теста мы не можем продолжить " +
        "рассмотрение вашей кандидатуры на данную позицию.",
    );
    await saveResult({ data, rejectReason: data.rejectReason });
    return transition.complete();
  };

  steps.finish = async ({ ctx, data }) => {
    await ctx.reply(
      "Тест пройден, спасибо! Ваши ответы переданы менеджеру по подбору " +
        "персонала — мы свяжемся с вами по указанному телефону.",
    );
    await saveResult({ data, rejectReason: null });
    return transition.complete();
  };

  return steps;
}

// Строит шаги для одного теста: показ вопроса -> ожидание ответа -> следующий.
// Для type "filter" неверный ответ обычно уводит на onFilterFail. Если у
// вопроса задан followUpOnFail — вместо немедленного отсева сначала
// спрашиваем готовность устранить проблему (оформить документ), и только
// при отказе уводим на onFilterFail.
function buildTestSteps(steps, { questions, prefix, testLabel, answersKey, scoreKey, onFilterFail, afterLast }) {
  const stepAt = (idx) => (idx < questions.length ? `${prefix}${idx}` : afterLast);

  questions.forEach((question, i) => {
    const stepId = `${prefix}${i}`;
    const nextStepId = stepAt(i + 1);

    steps[stepId] = async ({ ctx }) => {
      await ctx.reply(
        `${testLabel}\nВопрос ${i + 1} из ${questions.length} (${question.block})\n\n${question.text}`,
        { attachments: [questionKeyboard(question)] },
      );
      return transition.goto(`${stepId}-wait`, {});
    };

    steps[`${stepId}-wait`] = async ({ ctx, data }) => {
      const payload = ctx.callback?.payload;
      if (!payload || !payload.startsWith(`${question.id}:`)) {
        await ctx.reply("Пожалуйста, выберите вариант кнопкой выше.");
        return transition.stay();
      }
      const chosenText = payload.slice(question.id.length + 1);
      const option = question.options.find((o) => o.text === chosenText);
      const answers = { ...data[answersKey], [question.id]: chosenText };

      if (question.type === "filter" && option?.pass === false) {
        if (question.followUpOnFail) {
          return transition.goto(`${stepId}-followup`, { [answersKey]: answers });
        }
        if (onFilterFail) {
          return transition.goto(onFilterFail, {
            [answersKey]: answers,
            rejectReason: option.rejectReason,
          });
        }
      }
      if (question.id === "t1q2") {
        // разряд удостоверения фиксируем отдельно для анкеты
        return transition.goto(nextStepId, { [answersKey]: answers, grade: chosenText });
      }

      const score = data[scoreKey] + (option?.score ?? 0);
      return transition.goto(nextStepId, { [answersKey]: answers, [scoreKey]: score });
    };

    if (question.followUpOnFail) {
      const fu = question.followUpOnFail;
      const afterWilling = stepAt(i + 1 + (fu.skipNext ?? 0));

      steps[`${stepId}-followup`] = async ({ ctx }) => {
        await ctx.reply(fu.text, { attachments: [questionKeyboard(fu)] });
        return transition.goto(`${stepId}-followup-wait`, {});
      };

      steps[`${stepId}-followup-wait`] = async ({ ctx, data }) => {
        const payload = ctx.callback?.payload;
        if (!payload || !payload.startsWith(`${fu.id}:`)) {
          await ctx.reply("Пожалуйста, выберите вариант кнопкой выше.");
          return transition.stay();
        }
        const chosenText = payload.slice(fu.id.length + 1);
        const willing = fu.options.find((o) => o.text === chosenText)?.willing;

        if (!willing) {
          return transition.goto(onFilterFail, {
            rejectReason: question.options.find((o) => o.pass === false)?.rejectReason,
          });
        }
        return transition.goto(afterWilling, {
          pendingDocs: [...data.pendingDocs, fu.note],
        });
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
