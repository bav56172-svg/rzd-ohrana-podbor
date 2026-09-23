import { defineScenario, transition, Keyboard } from "@maxhub/max-bot-api";
import { questions, maxScore } from "./questions.js";

function questionKeyboard(question) {
  const buttons = question.options.map((opt) => [
    Keyboard.button.callback(opt.text, `${question.id}:${opt.text}`),
  ]);
  return Keyboard.inlineKeyboard(buttons);
}

function stepIdForIndex(i) {
  return i < questions.length ? `q${i}` : "finish";
}

export const candidateTest = defineScenario()({
  id: "candidate-test",
  initialStep: "q0",
  idleTimeoutMs: 30 * 60 * 1000,
  createData: () => ({ answers: {}, score: 0 }),
  steps: buildSteps(),
});

function buildSteps() {
  const steps = {};

  questions.forEach((question, i) => {
    const stepId = stepIdForIndex(i);
    const nextStepId = stepIdForIndex(i + 1);

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
        // Пользователь написал текст вместо нажатия кнопки — просим нажать
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
    await ctx.reply(
      `Тест пройден. Спасибо!\n\nБаллы: ${data.score} из ${maxScore} (${percent}%).\n` +
        "Результаты переданы менеджеру по подбору персонала.",
    );
    // TODO: отправить data.answers/data.score менеджеру (Андрею) — нужен его
    // chat_id в MAX или другой канал доставки результатов. Пока просто лог.
    console.log("Результат теста кандидата:", JSON.stringify(data));
    return transition.complete();
  };

  return steps;
}
