import { Bot, session, ScenarioEngine } from "@maxhub/max-bot-api";
import { candidateTest } from "./scenario.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не задан BOT_TOKEN. Скопируй .env.example в .env и вставь токен от Master Bot.");
  process.exit(1);
}

const bot = new Bot(token);
const scenarios = new ScenarioEngine();
scenarios.register(candidateTest);

bot.api.setMyCommands([
  { name: "start", description: "Начать" },
  { name: "test", description: "Пройти тест кандидата на должность охранника" },
  { name: "cancel", description: "Отменить прохождение теста" },
]);

bot.use(session());
bot.use(scenarios.controllerMiddleware());

bot.command("start", (ctx) =>
  ctx.reply(
    "Здравствуйте! Это бот ООО «ОП «РЖД-ОХРАНА» для кандидатов на должность охранника.\n" +
      "Команда /test — начать короткий тест.",
  ),
);

bot.command("cancel", async (ctx) => {
  const canceled = ctx.scenario.cancel();
  await ctx.reply(canceled ? "Тест отменён." : "Активного теста нет.");
});

bot.use(scenarios.interceptMiddleware());
bot.command("test", scenarios.start(candidateTest));

bot.start();
console.log("Бот запущен.");
