import { Bot, session, ScenarioEngine } from "@maxhub/max-bot-api";
import { candidateTest, initialCandidateData } from "./scenario.js";

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

// Временная диагностика: логируем каждое входящее обновление (тип +
// callback payload, если есть) — чтобы при следующем зависании кнопки
// видеть, дошло ли событие вообще и что именно пришло, а не гадать.
bot.use((ctx, next) => {
  console.log(
    `[update] type=${ctx.update.update_type} callback=${ctx.callback?.payload ?? "-"} text=${ctx.message?.body?.text ?? "-"}`,
  );
  return next();
});

bot.use(session());
bot.use(scenarios.controllerMiddleware());

// Ссылка с сайта: https://max.ru/<bot>?start=<encodeURIComponent(JSON)> с
// ФИО и телефоном — чтобы бот не спрашивал их повторно. MAX присылает это
// как отдельное событие update_type "bot_started" с полем payload —
// прочитано в исходнике SDK (dist/core/context.js, getStartPayload),
// а не угадано по аналогии с другими мессенджерами.
function parseStartPayload(raw) {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(raw));
    if (decoded.name && decoded.phone) {
      return { fio: decoded.name, phone: decoded.phone };
    }
  } catch {
    // payload не распознан — просто спросим ФИО/телефон в диалоге
  }
  return null;
}

// scenarios.start(definition, createData) — второй аргумент обязан быть
// функцией (ctx) => data; если передать данные — они ПОЛНОСТЬЮ заменяют
// createData сценария, а не мержатся с ним. Поэтому используем ту же
// initialCandidateData(), что и candidateTest.createData() в scenario.js —
// раньше здесь была своя копия со старыми полями answers/score (от версии
// с одним тестом), из-за чего test1Score/test2Score оставались undefined
// всю сессию. Проверено чтением исходника @maxhub/max-bot-api
// (dist/scenario/engine.js).
function beginTest(prefill) {
  return scenarios.start(candidateTest, () => initialCandidateData(prefill));
}

// Открытие бота по ссылке с сайта (с данными) — событие bot_started
bot.on("bot_started", async (ctx) => {
  const prefill = parseStartPayload(ctx.startPayload);
  return beginTest(prefill)(ctx);
});

// Ручной запуск командой /start (без ссылки — данных с сайта нет)
bot.command("start", beginTest(null));

bot.command("cancel", async (ctx) => {
  const canceled = ctx.scenario.cancel();
  await ctx.reply(canceled ? "Тест отменён." : "Активного теста нет.");
});

bot.use(scenarios.interceptMiddleware());
bot.command("test", beginTest(null));

// Напоминание при тишине во время теста. Раньше движок сценариев просто
// молча стирал прогресс кандидата через 30 минут без ответа (человек
// отвлёкся/потерял сигнал — и должен был начинать заново, не зная об
// этом). Теперь: idleTimeoutMs в scenario.js увеличен до 3 часов (данные
// не стираются при обычной паузе), а здесь — свой лёгкий таймер, который
// после 10 минут тишины сам присылает напоминание продолжить. Таймер
// перезапускается на каждое сообщение кандидата, пока тест активен, и
// снимается, как только тест завершён/отменён.
const REMINDER_AFTER_MS = 10 * 60 * 1000;
const REMINDER_TEXT =
  "⏳ Не пропадайте! Тест ждёт вас — просто ответьте на последний вопрос, " +
  "чтобы продолжить с того же места. Прогресс сохранён.";
const reminderTimers = new Map();

function clearReminder(chatId) {
  const timer = reminderTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    reminderTimers.delete(chatId);
  }
}

function scheduleReminder(chatId) {
  clearReminder(chatId);
  const timer = setTimeout(async () => {
    reminderTimers.delete(chatId);
    try {
      await bot.api.sendMessageToChat(chatId, REMINDER_TEXT);
    } catch (err) {
      console.error(`Не удалось отправить напоминание chatId=${chatId}:`, err);
    }
  }, REMINDER_AFTER_MS);
  reminderTimers.set(chatId, timer);
}

bot.use(async (ctx, next) => {
  await next();
  const chatId = ctx.chatId;
  if (chatId === undefined) return;
  if (ctx.session?.scenario) {
    scheduleReminder(chatId);
  } else {
    clearReminder(chatId);
  }
});

bot.start();
console.log("Бот запущен.");
