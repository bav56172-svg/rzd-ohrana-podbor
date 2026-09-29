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
  "Статус",
  "Причина отказа",
];

function formatTestCell(test) {
  if (!test) return "—";
  return `${test.score}/${test.maxScore} (${test.percent}%)`;
}

// Обратный разбор "6/10 (60%)" — нужен, чтобы пересчитать балл у старых
// строк файла при каждой пересортировке (сами объекты test1/test2 в
// файле не хранятся, только отформатированный текст).
function parseTestCell(text) {
  const str = String(text ?? "");
  const m = /(\d+)\/(\d+)\s*\((\d+)%\)/.exec(str);
  if (!m) return null;
  return { score: Number(m[1]), maxScore: Number(m[2]), percent: Number(m[3]) };
}

async function loadExistingRows() {
  const rows = [];
  if (!existsSync(FILE_PATH)) return rows;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE_PATH);
  const sheet = workbook.getWorksheet("Кандидаты");
  if (!sheet) return rows;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // шапка
    const v = row.values; // 1-indexed, v[0] не используется
    const finalResult = v[8] ?? "";
    const isRejected = v[9] ? v[9] === "Отклонён" : String(finalResult).startsWith("Отсеян");
    rows.push({
      date: v[1] ?? "",
      fio: v[2] ?? "",
      phone: v[3] ?? "",
      birthdate: v[4] ?? "—",
      grade: v[5] ?? "—",
      test1: parseTestCell(v[6]),
      test2: parseTestCell(v[7]),
      finalResult,
      status: isRejected ? "Отклонён" : "Прошёл",
      rejectReason: v[10] || (isRejected ? String(finalResult).replace(/^Отсеян:\s*/, "") : ""),
    });
  });
  return rows;
}

function averageScore(row) {
  const percents = [row.test1?.percent, row.test2?.percent].filter(
    (p) => typeof p === "number",
  );
  if (!percents.length) return 0;
  return percents.reduce((sum, p) => sum + p, 0) / percents.length;
}

// Прошедшие — по убыванию среднего балла тестов (лучшие сверху).
// Отклонённые — всегда в самом низу списка, независимо от баллов,
// и всегда с указанной причиной отказа.
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const aRejected = a.status === "Отклонён";
    const bRejected = b.status === "Отклонён";
    if (aRejected !== bRejected) return aRejected ? 1 : -1;
    return averageScore(b) - averageScore(a);
  });
}

// record: { fio, phone, birthdate, grade, rejectReason, test1, test2, finalResult }
// test1/test2: { score, maxScore, percent } | null
// rejectReason: строка с причиной отказа, если кандидат отсеян, иначе null/undefined
export async function appendCandidateRow(record) {
  const existingRows = await loadExistingRows();

  const rejected = Boolean(record.rejectReason);
  const newRow = {
    date: new Date().toLocaleString("ru-RU"),
    fio: record.fio,
    phone: record.phone,
    birthdate: record.birthdate ?? "—",
    grade: record.grade ?? "—",
    test1: record.test1,
    test2: record.test2,
    finalResult: record.finalResult,
    status: rejected ? "Отклонён" : "Прошёл",
    rejectReason: rejected ? record.rejectReason : "",
  };

  const sortedRows = sortRows([...existingRows, newRow]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Кандидаты");
  sheet.addRow(HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (const r of sortedRows) {
    sheet.addRow([
      r.date,
      r.fio,
      r.phone,
      r.birthdate,
      r.grade,
      formatTestCell(r.test1),
      formatTestCell(r.test2),
      r.finalResult,
      r.status,
      r.rejectReason || "—",
    ]);
  }
  await workbook.xlsx.writeFile(FILE_PATH);
  return FILE_PATH;
}

export { FILE_PATH as candidatesFilePath };
