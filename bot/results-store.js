import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import path from "node:path";

const FILE_PATH = path.join(process.cwd(), "data", "candidates.xlsx");
const HEADERS = [
  "Дата",
  "ФИО",
  "Телефон",
  "Разряд",
  "Баллы",
  "Из максимума",
  "Процент",
  "Прошёл тест",
];

async function loadOrCreateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  if (existsSync(FILE_PATH)) {
    await workbook.xlsx.readFile(FILE_PATH);
    return { workbook, sheet: workbook.getWorksheet("Кандидаты") };
  }
  const sheet = workbook.addWorksheet("Кандидаты");
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true };
  return { workbook, sheet };
}

// record: { fio, phone, grade, score, maxScore, percent, passed }
export async function appendCandidateRow(record) {
  const { workbook, sheet } = await loadOrCreateWorkbook();
  sheet.addRow([
    new Date().toLocaleString("ru-RU"),
    record.fio,
    record.phone,
    record.grade,
    record.score,
    record.maxScore,
    `${record.percent}%`,
    record.passed ? "Да" : "Нет",
  ]);
  await workbook.xlsx.writeFile(FILE_PATH);
  return FILE_PATH;
}

export { FILE_PATH as candidatesFilePath };
