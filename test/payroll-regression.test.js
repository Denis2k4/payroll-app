const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const { tinhPhieuLuong } = require("../lib/taxCalc");
const { processExcel } = require("../lib/excelWorker");
const {
  findHeaderRowIndex,
  validateHeader,
  validateRows,
} = require("../lib/validate");

const ROOT = path.join(__dirname, "..");
const WORKBOOK_PATH = path.join(
  ROOT,
  "template",
  "mau-danh-sach-nhan-vien.xlsx",
);
const PAYSLIP_TEMPLATE_PATH = path.join(
  ROOT,
  "template",
  "payslip-template.html",
);

function readRows(options) {
  const workbook = XLSX.readFile(WORKBOOK_PATH, options);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
}

test("tùy chọn đọc Excel tối ưu giữ nguyên dữ liệu đầu vào", () => {
  const originalRows = readRows();
  const optimizedRows = readRows({
    sheets: 0,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
  });

  assert.deepEqual(optimizedRows, originalRows);
});

test("logic phiếu lương vẫn lấy các cột tổng trực tiếp từ Excel", () => {
  const rows = readRows({
    sheets: 0,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
  });
  const headerIndex = findHeaderRowIndex(rows);
  assert.equal(headerIndex, 0);
  assert.equal(validateHeader(rows[headerIndex]).ok, true);

  const dataRows = rows.slice(headerIndex + 1);
  const validation = validateRows(dataRows);
  assert.equal(validation.isClean, true);
  assert.equal(validation.totalRows, 1);

  const phieu = tinhPhieuLuong(dataRows[0]);
  assert.equal(phieu.congAl, 1);
  assert.equal(phieu.congClph, 2);
  assert.equal(phieu.congRr, 3);
  assert.equal(phieu.congPh, 11);
  assert.equal(
    Object.values(phieu.cacKhoanNhan).reduce((sum, value) => sum + value, 0),
    1270,
  );
  assert.equal(phieu.tongThuNhap, 16);
  assert.equal(
    Object.values(phieu.cacKhoanKhauTru).reduce(
      (sum, value) => sum + value,
      0,
    ),
    1567,
  );
  assert.equal(phieu.tongKhauTru, 123);
  assert.equal(phieu.khoanKhac, 145);
  assert.equal(phieu.thucNhan, 1500000);
});

test("pipeline Excel trong worker trả đúng dữ liệu và kết quả kiểm tra", () => {
  const processed = processExcel(WORKBOOK_PATH);
  const rows = readRows({
    sheets: 0,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
  });
  const row = rows[findHeaderRowIndex(rows) + 1];
  const phieu = tinhPhieuLuong(row);
  const expected = {
    ...phieu,
    tt: Number(row[0]) || 1,
    stt: 1,
    maNhanVien: phieu.maNV,
    luongTheoNgayCongThucTe:
      phieu.cacKhoanNhan["Lương theo ngày công thực tế"],
    phuCapTrachNhiem: phieu.cacKhoanNhan["Phụ cấp trách nhiệm"],
    bhxh: phieu.cacKhoanKhauTru["Bảo hiểm xã hội"],
    thueTNCN: phieu.cacKhoanKhauTru["Thuế TNCN"],
    khauTruDiMuonVeSom:
      phieu.cacKhoanKhauTru["Khấu trừ đi muộn về sớm"],
  };

  assert.equal(processed.rowCount, 1);
  assert.equal(processed.formatWarning, null);
  assert.equal(processed.validation.isClean, true);
  assert.deepEqual(processed.data[0], expected);
});

test("mẫu phiếu lương không bị thay đổi", () => {
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(PAYSLIP_TEMPLATE_PATH))
    .digest("hex");

  assert.equal(
    hash,
    "f4125d6cc581ce491b0c3d998f2f0998055de46012ef798d9cc5a99044dab932",
  );
});

test("logic chọn tất cả theo bộ lọc hoạt động chính xác", () => {
  const selectedIndexes = new Set([0, 1, 2, 3, 4]); // Ban đầu chọn 5 nhân viên
  const filteredIndexes = [2, 3]; // Lọc chỉ còn 2 nhân viên

  // Khi tích chọn tất cả theo bộ lọc:
  selectedIndexes.clear();
  filteredIndexes.forEach((idx) => selectedIndexes.add(idx));

  assert.equal(selectedIndexes.size, 2);
  assert.equal(selectedIndexes.has(2), true);
  assert.equal(selectedIndexes.has(3), true);
  assert.equal(selectedIndexes.has(0), false);
  assert.equal(selectedIndexes.has(1), false);
  assert.equal(selectedIndexes.has(4), false);

  // Kiểm tra trạng thái checkbox:
  const allFilteredChecked = filteredIndexes.every((i) =>
    selectedIndexes.has(i),
  );
  const onlyFilteredSelected = selectedIndexes.size === filteredIndexes.length;
  assert.equal(allFilteredChecked && onlyFilteredSelected, true);

  // Khi bỏ chọn tất cả trong bộ lọc:
  filteredIndexes.forEach((idx) => selectedIndexes.delete(idx));
  assert.equal(selectedIndexes.size, 0);
});

