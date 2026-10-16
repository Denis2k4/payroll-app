const { parentPort, workerData } = require("node:worker_threads");
const XLSX = require("xlsx");

const { tinhPhieuLuong } = require("./taxCalc");
const {
  validateHeader,
  validateRows,
  findHeaderRowIndex,
} = require("./validate");

function isBlankRow(row) {
  return (
    !Array.isArray(row) ||
    row.every((value) => String(value ?? "").trim() === "")
  );
}

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function enrichPayslip(row, stt) {
  const phieu = tinhPhieuLuong(row);
  return {
    ...phieu,
    tt: num(row[0]) || stt,
    stt,
    maNhanVien: phieu.maNV,
    luongTheoNgayCongThucTe:
      phieu.cacKhoanNhan["Lương theo ngày công thực tế"],
    phuCapTrachNhiem: phieu.cacKhoanNhan["Phụ cấp trách nhiệm"],
    bhxh: phieu.cacKhoanKhauTru["Bảo hiểm xã hội"],
    thueTNCN: phieu.cacKhoanKhauTru["Thuế TNCN"],
    khauTruDiMuonVeSom:
      phieu.cacKhoanKhauTru["Khấu trừ đi muộn về sớm"],
  };
}

function readExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath, {
    sheets: 0,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("File Excel không có sheet dữ liệu nào.");
  }

  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  const headerRowIndex = findHeaderRowIndex(allRows);
  const headerRow =
    headerRowIndex >= 0 ? allRows[headerRowIndex] : allRows[0] || [];
  const headerCheck = validateHeader(headerRow);
  const startIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  const rows = [];
  for (let index = startIndex; index < allRows.length; index++) {
    if (!isBlankRow(allRows[index])) rows.push(allRows[index]);
  }

  return { rows, headerCheck };
}

function processExcel(filePath) {
  const { rows, headerCheck } = readExcelFile(filePath);
  const formatWarning = headerCheck.headerDetected
    ? headerCheck.ok
      ? null
      : `File thiếu/sai vị trí một số cột bắt buộc so với mẫu cột cố định: ${headerCheck.missing.join(", ")}.`
    : "Không tìm thấy dòng tiêu đề đúng mẫu (Mã NV, Họ tên...) — đang đọc toàn bộ các dòng theo đúng vị trí cột cố định, vui lòng kiểm tra kỹ dữ liệu.";

  return {
    data: rows.map((row, index) => enrichPayslip(row, index + 1)),
    validation: validateRows(rows),
    formatWarning,
    rowCount: rows.length,
  };
}

if (parentPort) {
  try {
    parentPort.postMessage({ ok: true, value: processExcel(workerData.filePath) });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error.message || String(error),
    });
  }
}

module.exports = { processExcel };
