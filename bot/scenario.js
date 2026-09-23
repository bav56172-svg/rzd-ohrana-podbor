import { defineScenario, transition, Keyboard } from "@maxhub/max-bot-api";
import { questions, maxScore, gradeQuestion, PASS_THRESHOLD_PERCENT } from "./questions.js";
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
  "Дальше — короткий тест кандидата (5-10 минут).";

function startTestKeyboard() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback("Пройти тест", "start-test")]]);
}

export const candidateTest = defineScenario()({
  id: "candidate-test",
  initialStep: "welcome",
  idleTimeoutMs: 30 * 60 * 1000,
  createData: () => ({ fio: null, phone: null, grade: null, answers: {}, score: 0 }),
  steps: buildSteps(),
});

function buildSteps() {
  const steps = {};

  // Приветствие с кратким повтором инфо с сайта + кнопка "Пройти тест"
  steps.welcome = async ({ ctx }) => {
    await ctx.reply(WELCOME_TEXT, { attachments: [startTestKeyboard()] });
    return transition.goto("welcome-wait", {});
  };

  steps["welcome-wait"] = async ({ ctx, data }) => {
    if (ctx.callback?.payload !== "start-test") {
      return transition.stay();
    }
    // Если ФИО/телефон уже пришли по ссылке с сайта — не спрашиваем повторно
    if (data.fio && data.phone) {
      return transition.goto("ask-grade", {});
    }
    return transition.goto("ask-fio", {});
  };

  steps["ask-fio"] = async ({ ctx }) => {
    await ctx.reply("Как к вам обращаться? Напишите ФИО.");
    return transition.goto("ask-fio-wait", {});
  };

  steps["ask-fio-wait"] = async ({ ctx, data }) => {
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

  steps["ask-phone-wait"] = async ({ ctx, data }) => {
    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await ctx.reply("Пожалуйста, напишите номер телефона текстом.");
      return transition.stay();
    }
    return transition.goto("ask-grade", { phone: text });
  };

  steps["ask-grade"] = async ({ ctx }) => {
    await ctx.reply(gradeQuestion.text, { attachments: [questionKeyboard(gradeQuestion)] });
    return transition.goto("ask-grade-wait", {});
  };

  steps["ask-grade-wait"] = async ({ ctx, data }) => {
    const payload = ctx.callback?.payload;
    if (!payload || !payload.startsWith(`${gradeQuestion.id}:`)) {
      await ctx.reply("Пожалуйста, выберите вариант кнопкой выше.");
      return transition.stay();
    }
    const grade = payload.slice(gradeQuestion.id.length + 1);
    return transition.goto("q0", { grade });
  };

  // Очковые вопросы теста (психологический профиль/надёжность/внимательность)
  questions.forEach((question, i) => {
    const stepId = `q${i}`;
    const nextStepId = i < questions.length - 1 ? `q${i + 1}` : "finish";

    steps[stepId] = async ({ ctx }) => {
      await ctx.reply(
        `Вопрос ${i + 1} из ${questions.length} (${question.block})\n\n${question.text}`,
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
      const answers = { ...data.answers, [question.id]: chosenText };
      const score = data.score + (option?.score ?? 0);
      return transition.goto(nextStepId, { answers, score });
    };
  });

  steps.finish = async ({ ctx, data }) => {
    const percent = maxScore > 0 ? Math.round((data.score / maxScore) * 100) : 0;
    const passed = percent >= PASS_THRESHOLD_PERCENT;

    await ctx.reply(
      "Тест пройден, спасибо! Ваши ответы переданы менеджеру по подбору " +
        "персонала — мы свяжемся с вами по указанному телефону.",
    );

    try {
      await appendCandidateRow({
        fio: data.fio,
        phone: data.phone,
        grade: data.grade,
        score: data.score,
        maxScore,
        percent,
        passed,
      });
      await sendCandidatesFile();
    } catch (err) {
      console.error("Не удалось сохранить/отправить результат кандидата:", err);
    }

    return transition.complete();
  };

  return steps;
}
