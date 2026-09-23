import nodemailer from "nodemailer";
import { candidatesFilePath } from "./results-store.js";

// Адрес получателя и SMTP-доступ — Андрей укажет позже (см. bot/README.md).
// Пока EMAIL_TO не задан, отправка тихо пропускается (не ошибка).
export async function sendCandidatesFile() {
  const to = process.env.EMAIL_TO;
  if (!to) {
    console.log("EMAIL_TO не задан — рассылка результата пропущена.");
    return { sent: false, reason: "no_email_to" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: "РЖД-Охрана — новый результат тестирования кандидата",
    text: "Во вложении — обновлённая таблица кандидатов на должность охранника.",
    attachments: [{ path: candidatesFilePath }],
  });

  return { sent: true };
}
