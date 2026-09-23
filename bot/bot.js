import { Bot, session, ScenarioEngine } from "@maxhub/max-bot-api";
import { candidateTest } from "./scenario.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не задан BOT_TOKEN. Скопируй env.example в .env и вставь токен от Master Bot.");
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

// Ссылка с сайта: https://max.ru/<bot>?start=<encodeURIComponent(JSON)>
// с ФИО и телефоном — чтобы бот не спрашивал их повторно.
// ПРЕДПОЛОЖЕНИЕ (не проверено на живом боте): MAX передаёт start-параметр
// как текст после команды /start, по аналогии с Telegram. Проверить, когда
// появится токен и можно будет реально потестировать.
function parseStartPayload(ctx) {
  const text = ctx.message?.body?.text || "";
  const payload = text.replace(/^\/start\s*/, "").trim();
  if (!payload) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(payload));
    if (decoded.name && decoded.phone) {
      return { fio: decoded.name, phone: decoded.phone };
    }
  } catch {
    // payload не распознан — просто спросим ФИО/телефон в диалоге
  }
  return null;
}

bot.command("start", async (ctx) => {
  const prefill = parseStartPayload(ctx);
  // ПРЕДПОЛОЖЕНИЕ: scenarios.start() принимает вторым аргументом начальные
  // данные сценария (переопределяет createData). Если SDK так не умеет —
  // не страшно: prefill просто не подставится, бот спросит ФИО/телефон
  // сам в диалоге (штатное поведение). Проверить на живом боте.
  return scenarios.start(candidateTest, prefill || {})(ctx);
});

bot.command("cancel", async (ctx) => {
  const canceled = ctx.scenario.cancel();
  await ctx.reply(canceled ? "Тест отменён." : "Активного теста нет.");
});

bot.use(scenarios.interceptMiddleware());
bot.command("test", scenarios.start(candidateTest));

bot.start();
console.log("Бот запущен.");
