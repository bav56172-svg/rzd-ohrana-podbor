import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import path from "node:path";

const FILE_PATH = path.join(process.cwd(), "data", "candidates.xlsx");
const HEADERS = [
  "Дата",
  "ФИО",
  "Телефон",
  "Дата рождения",
  "Разряд",
  "Тест 1 (квалификация)",
  "Тест 2 (психология)",
  "Итоговый результат",
];

async function loadOrCreateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  if (existsSync(FILE_PATH)) {
    await workbook.xlsx.readFile(FILE_PATH);
    const sheet = workbook.getWorksheet("Кандидаты");
    // Обновляем заголовок на случай добавления новых колонок (например
    // "Дата рождения") — старые строки данных не трогаем, они просто
    // останутся короче новой шапки.
    sheet.getRow(1).values = HEADERS;
    sheet.getRow(1).font = { bold: true };
    return { workbook, sheet };
  }
  const sheet = workbook.addWorksheet("Кандидаты");
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true };
  return { workbook, sheet };
}

function formatTestCell(test) {
  if (!test) return "—";
  return `${test.score}/${test.maxScore} (${test.percent}%)`;
}

// record: { fio, phone, birthdate, grade, rejectReason, test1, test2, finalResult }
// test1/test2: { score, maxScore, percent, passed } | null
export async function appendCandidateRow(record) {
  const { workbook, sheet } = await loadOrCreateWorkbook();
  sheet.addRow([
    new Date().toLocaleString("ru-RU"),
    record.fio,
    record.phone,
    record.birthdate ?? "—",
    record.grade ?? "—",
    formatTestCell(record.test1),
    formatTestCell(record.test2),
    record.finalResult,
  ]);
  await workbook.xlsx.writeFile(FILE_PATH);
  return FILE_PATH;
}

export { FILE_PATH as candidatesFilePath };
