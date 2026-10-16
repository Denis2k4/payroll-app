// ============================================================
// KIỂM TRA DỮ LIỆU - đọc theo VỊ TRÍ CỘT CỐ ĐỊNH, giống taxCalc.js
// Chạy trên tiến trình main (Node), TRƯỚC khi các ô số bị ép về 0
// bằng hàm num(), để không bỏ sót lỗi "sai định dạng số".
//
// Toàn bộ danh sách cột chuẩn (FULL_HEADER_COLUMNS) là nguồn duy nhất
// để: (1) kiểm tra dòng tiêu đề đúng tên & đúng vị trí từng cột,
// (2) kiểm tra file/từng dòng có ĐỦ SỐ CỘT theo mẫu hay không,
// (3) suy ra danh sách cột số (NUMERIC_COLUMNS) để kiểm tra định dạng.
// Nếu sau này mẫu Excel đổi vị trí/thêm cột, chỉ cần sửa DUY NHẤT
// mảng FULL_HEADER_COLUMNS bên dưới (nhớ đồng bộ với COL trong taxCalc.js).
// ============================================================

// Toàn bộ 45 cột theo đúng thứ tự trong file mẫu "mau-danh-sach-nhan-vien.xlsx" (0-based).
// isNumeric: cột chứa số (dùng để kiểm tra định dạng số).
// required: cột bắt buộc phải có giá trị trên mỗi dòng dữ liệu.
const FULL_HEADER_COLUMNS = [
  { index: 0, label: "TT" },
  { index: 1, label: "Mã NV", required: true },
  { index: 2, label: "Khối", required: true },
  { index: 3, label: "Cơ sở", required: true },
  { index: 4, label: "Bộ phận", required: true },
  { index: 5, label: "Họ tên", required: true },
  { index: 6, label: "Chức vụ", required: true },
  { index: 7, label: "Lương chính thức", isNumeric: true },
  { index: 8, label: "Lương thử việc", isNumeric: true },
  { index: 9, label: "Công tiêu chuẩn", isNumeric: true },
  { index: 10, label: "Công Thử việc", isNumeric: true },
  { index: 11, label: "Công Chính thức", isNumeric: true },
  { index: 12, label: "Số công ngày nghỉ phép (AL)", isNumeric: true },
  { index: 13, label: "Số công ngày nghỉ bù (CLPH)", isNumeric: true },
  { index: 14, label: "Số công ngày nghỉ bù (RR)", isNumeric: true },
  { index: 15, label: "Số công ngày nghĩ lễ (PH)", isNumeric: true },
  { index: 16, label: "Ngày công thực tế đi làm", isNumeric: true },
  { index: 17, label: "Tổng công", isNumeric: true },
  { index: 18, label: "Lương theo ngày công đi làm thực tế", isNumeric: true },
  { index: 19, label: "Phụ cấp trách nhiệm", isNumeric: true },
  { index: 20, label: "Thưởng KPI", isNumeric: true },
  { index: 21, label: "Phụ cấp ca đêm", isNumeric: true },
  { index: 22, label: "Phụ cấp ca đêm lễ", isNumeric: true },
  { index: 23, label: "Lương làm thêm giờ", isNumeric: true },
  { index: 24, label: "Lương ngày lễ", isNumeric: true },
  { index: 25, label: "Tiền ăn ca", isNumeric: true },
  { index: 26, label: "Tiền gửi xe", isNumeric: true },
  { index: 27, label: "Hỗ trợ điện thoại", isNumeric: true },
  { index: 28, label: "Hỗ trợ đi lại", isNumeric: true },
  { index: 29, label: "Hỗ trợ khác", isNumeric: true },
  { index: 30, label: "Hỗ trợ nắng nóng (05 - 09)", isNumeric: true },
  { index: 31, label: "Tiền sinh nhật", isNumeric: true },
  { index: 32, label: "Thưởng dịch vụ hằng tháng (SVC)", isNumeric: true },
  { index: 33, label: "Thưởng Hoa hồng Spa", isNumeric: true },
  { index: 34, label: "Thưởng nghỉ lễ", isNumeric: true },
  { index: 35, label: "Tổng thu nhập", isNumeric: true },
  { index: 36, label: "Khấu trừ đi muộn về sớm", isNumeric: true },
  { index: 37, label: "Bảo hiểm xã hội", isNumeric: true },
  { index: 38, label: "Thuế TNCN", isNumeric: true },
  { index: 39, label: "Truy thu lương/Các khoản tạm ứng", isNumeric: true },
  { index: 40, label: "Tổng các khoản khấu trừ", isNumeric: true },
  { index: 41, label: "Các khoản khác", isNumeric: true },
  { index: 42, label: "Thực nhận", isNumeric: true },
  { index: 43, label: "Ghi chú" },
  { index: 44, label: "Email" },
];

// Tổng số cột bắt buộc phải có theo đúng mẫu.
const EXPECTED_COLUMN_COUNT = FULL_HEADER_COLUMNS.length;

// Các cột bắt buộc phải có trong dòng tiêu đề (0-based), dùng để
// nhận diện nhanh file có đúng mẫu cột cố định hay không.
const REQUIRED_HEADER_COLUMNS = FULL_HEADER_COLUMNS.filter(
  (col) => col.required,
);

// Các cột bắt buộc phải có giá trị trên MỖI dòng dữ liệu, suy ra từ
// FULL_HEADER_COLUMNS để không bao giờ lệch với danh sách cột chuẩn.
const REQUIRED_VALUE_COLUMNS = REQUIRED_HEADER_COLUMNS.map((col) => ({
  index: col.index,
  code: `missing_${col.label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")}`,
  label: col.label,
  message: `Thiếu ${col.label.toLowerCase()}`,
}));

// Danh sách các cột số (0-based -> tên cột), suy ra từ FULL_HEADER_COLUMNS
// để luôn đồng bộ với thứ tự cột thật trong file Excel.
const NUMERIC_COLUMNS = FULL_HEADER_COLUMNS.filter(
  (col) => col.isNumeric,
).reduce((acc, col) => {
  acc[col.index] = col.label;
  return acc;
}, {});

function normalize(value) {
  return String(value ?? "").trim();
}

// Chuẩn hoá tên cột tiêu đề để so sánh: gộp mọi khoảng trắng/xuống dòng
// liên tiếp (kể cả xuống dòng trong ô Excel, ví dụ "Phụ cấp ca đêm\n(30%)")
// thành 1 khoảng trắng, rồi trim. Nhờ vậy việc xuống dòng/thừa khoảng
// trắng trong ô tiêu đề không bị báo lỗi sai tên cột.
function normalizeHeaderLabel(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlank(value) {
  return normalize(value) === "";
}

// Đếm số cột BẮT BUỘC khớp đúng tên & đúng vị trí tại 1 dòng bất kỳ.
// Dùng để "chấm điểm" xem 1 dòng có phải là dòng tiêu đề thật hay không.
function scoreHeaderRow(row) {
  const list = Array.isArray(row) ? row : [];
  return REQUIRED_HEADER_COLUMNS.filter(
    (col) => normalizeHeaderLabel(list[col.index]) === col.label,
  ).length;
}

// Ngưỡng để coi 1 dòng là dòng tiêu đề hợp lệ: phải khớp QUÁ NỬA số cột
// bắt buộc, tránh nhận nhầm 1 dòng dữ liệu/banner tình cờ khớp 1-2 cột.
const HEADER_MATCH_THRESHOLD = Math.ceil(REQUIRED_HEADER_COLUMNS.length / 2);

/**
 * Dò tìm dòng tiêu đề thật trong N dòng đầu của file (thay vì luôn giả định
 * dòng tiêu đề là dòng đầu tiên - allRows[0]). Nhiều file Excel thực tế có
 * dòng banner/tên công ty/dòng trống phía trên dòng tiêu đề thật, nếu cứ lấy
 * cứng allRows[0] sẽ khiến validateHeader so sánh nhầm dòng, dẫn tới báo lỗi
 * sai tên & sai vị trí cột hàng loạt (dù cột trong file vẫn đúng mẫu).
 *
 * @param {Array<Array>} allRows - toàn bộ các dòng đọc từ Excel (header:1)
 * @param {number} maxScan - số dòng đầu tối đa sẽ quét để tìm tiêu đề
 * @returns {number} chỉ số dòng tiêu đề tìm được, hoặc -1 nếu không thấy
 */
function findHeaderRowIndex(allRows, maxScan = 10) {
  const list = Array.isArray(allRows) ? allRows : [];
  const limit = Math.min(list.length, maxScan);

  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const score = scoreHeaderRow(list[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestScore < HEADER_MATCH_THRESHOLD) {
    return -1;
  }
  return bestIndex;
}

// Chuỗi có phải là số hợp lệ hay không (chấp nhận dấu phẩy ngăn cách
// hàng nghìn kiểu VN, ví dụ "1,200,000" hoặc "1200000" hoặc "-500").
function parseNumericCell(raw) {
  const text = normalize(raw).replace(/,/g, "");
  if (text === "") return { blank: true, value: 0, valid: true };
  const n = Number(text);
  return { blank: false, value: n, valid: Number.isFinite(n) };
}

/**
 * Kiểm tra dòng tiêu đề có đúng và đủ mẫu cột cố định không:
 *  - Đủ số cột (>= EXPECTED_COLUMN_COUNT)
 *  - Đúng tên & đúng vị trí từng cột trong FULL_HEADER_COLUMNS
 * Không chặn việc đọc file (để không phá vỡ các file không có dòng
 * tiêu đề), chỉ trả về cảnh báo cho người dùng.
 */
function validateHeader(headerRow) {
  const row = Array.isArray(headerRow) ? headerRow : [];

  // 1) Cột bắt buộc (dùng để nhận diện đây có phải dòng tiêu đề không)
  const missingRequired = REQUIRED_HEADER_COLUMNS.filter(
    (col) => normalizeHeaderLabel(row[col.index]) !== col.label,
  );
  const matchedRequiredCount =
    REQUIRED_HEADER_COLUMNS.length - missingRequired.length;
  const headerDetected = matchedRequiredCount >= HEADER_MATCH_THRESHOLD;

  // 2) Đủ số cột so với mẫu chưa
  const columnCountIssues = [];
  if (row.length < EXPECTED_COLUMN_COUNT) {
    columnCountIssues.push(
      `Thiếu cột: file chỉ có ${row.length} cột, cần đủ ${EXPECTED_COLUMN_COUNT} cột theo mẫu (thiếu ${
        EXPECTED_COLUMN_COUNT - row.length
      } cột phía cuối, tính từ cột "${
        FULL_HEADER_COLUMNS[row.length]
          ? FULL_HEADER_COLUMNS[row.length].label
          : ""
      }" trở đi).`,
    );
  }

  // 3) Đúng tên & đúng vị trí từng cột trong toàn bộ mẫu (không chỉ cột bắt buộc)
  const mismatchedColumns = FULL_HEADER_COLUMNS.filter(
    (col) => normalizeHeaderLabel(row[col.index]) !== col.label,
  ).map((col) => {
    const actual = normalizeHeaderLabel(row[col.index]);
    return `Cột ${col.index + 1} (kỳ vọng "${col.label}", thực tế: ${
      actual ? `"${actual}"` : "(trống)"
    })`;
  });

  const missing = [...columnCountIssues, ...mismatchedColumns];

  return {
    headerDetected,
    ok: missing.length === 0,
    columnCount: row.length,
    expectedColumnCount: EXPECTED_COLUMN_COUNT,
    missing,
  };
}

/**
 * Kiểm tra toàn bộ dữ liệu (đã bỏ dòng trống, đã bỏ dòng tiêu đề nếu có).
 * @param {Array<Array>} rows - mảng các dòng dữ liệu thô (chưa ép kiểu)
 */
function validateRows(rows) {
  const list = Array.isArray(rows) ? rows : [];

  // Bước 1: kiểm tra từng dòng độc lập
  const rowResults = list.map((row, i) => {
    const issues = [];
    const maNV = normalize(row[1]);
    const hoTen = normalize(row[5]);

    // Thiếu cột: dòng bị ngắn hơn tổng số cột theo mẫu (dữ liệu bị cắt bớt)
    if (row.length < EXPECTED_COLUMN_COUNT) {
      const missingCols = FULL_HEADER_COLUMNS.slice(row.length).map(
        (col) => `Cột ${col.index + 1} (${col.label})`,
      );
      issues.push({
        level: "error",
        code: "missing_columns",
        message: `Thiếu ${missingCols.length} cột dữ liệu ở dòng ${i + 1} (dòng chỉ có ${row.length}/${EXPECTED_COLUMN_COUNT} cột): ${missingCols.join(", ")}.`,
      });
    }

    REQUIRED_VALUE_COLUMNS.forEach((col) => {
      if (isBlank(row[col.index])) {
        issues.push({ level: "error", code: col.code, message: col.message });
      }
    });

    Object.entries(NUMERIC_COLUMNS).forEach(([idxStr, label]) => {
      const idx = Number(idxStr);
      const raw = row[idx];
      const parsed = parseNumericCell(raw);

      if (parsed.blank) return;

      if (!parsed.valid) {
        issues.push({
          level: "error",
          code: "invalid_number",
          message: `Sai định dạng số tại cột "${label}" (giá trị: "${normalize(raw)}")`,
        });
      } else if (parsed.value < 0) {
        issues.push({
          level: "warning",
          code: "negative_value",
          message: `Giá trị âm tại cột "${label}" (${parsed.value.toLocaleString("vi-VN")})`,
        });
      }
    });

    return {
      rowIndex: i,
      stt: i + 1,
      maNV,
      hoTen: hoTen || "(chưa có tên)",
      issues,
    };
  });

  // Bước 2: kiểm tra trùng mã nhân viên trên toàn bộ danh sách
  const countByMaNV = new Map();
  rowResults.forEach((r) => {
    if (!r.maNV) return;
    countByMaNV.set(r.maNV, (countByMaNV.get(r.maNV) || 0) + 1);
  });

  rowResults.forEach((r) => {
    if (r.maNV && countByMaNV.get(r.maNV) > 1) {
      r.issues.push({
        level: "error",
        code: "duplicate_ma_nv",
        message: `Trùng mã nhân viên "${r.maNV}" (xuất hiện ${countByMaNV.get(r.maNV)} lần)`,
      });
    }
  });

  const rowsWithErrors = rowResults.filter((r) =>
    r.issues.some((i) => i.level === "error"),
  );
  const rowsWithWarnings = rowResults.filter(
    (r) =>
      !r.issues.some((i) => i.level === "error") &&
      r.issues.some((i) => i.level === "warning"),
  );
  const totalErrors = rowResults.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.level === "error").length,
    0,
  );
  const totalWarnings = rowResults.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.level === "warning").length,
    0,
  );

  return {
    rows: rowResults.filter((r) => r.issues.length > 0),
    totalRows: rowResults.length,
    rowsWithErrorsCount: rowsWithErrors.length,
    rowsWithWarningsCount: rowsWithWarnings.length,
    totalErrors,
    totalWarnings,
    isClean: totalErrors === 0 && totalWarnings === 0,
  };
}

module.exports = {
  validateHeader,
  validateRows,
  findHeaderRowIndex,
  NUMERIC_COLUMNS,
  REQUIRED_HEADER_COLUMNS,
  FULL_HEADER_COLUMNS,
  EXPECTED_COLUMN_COUNT,
};
