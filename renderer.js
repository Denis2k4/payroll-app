// ============================================================
// TRẠNG THÁI CHUNG
// ============================================================
let danhSachNhanVien = []; // toàn bộ dữ liệu đọc từ Excel (thứ tự gốc, không đổi)
let validationResult = null; // kết quả bước 3 - Kiểm tra dữ liệu
let thuMucLuu = null;
let currentStep = 1;
let maxUnlockedStep = 1;
let searchableEmployeeTexts = [];
let validationRowsByIndex = new Map();
let searchRenderTimer = null;
let validationPanelDirty = true;
let emailHistoryDirty = true;
let emailHistoryPage = 1;
let previewHeadInitialized = false;
let visiblePreviewIndexes = [];
let previewPage = 1;
const PREVIEW_PAGE_SIZE = 50;
let pdfJobInFlight = false;
let emailJobInFlight = false;
let pendingConfirm = false;

// ===========================================================
const DEFAULT_EMAIL_TEMPLATE = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#333;max-width:650px">
    <p>Kính gửi Anh/Chị <strong>{{hoTen}}</strong>,</p>

    <p>
        Phòng Nhân sự xin gửi đến Anh/Chị
        <strong>Phiếu lương tháng {{thangNam}}</strong>,
        được đính kèm trong email này.
    </p>

    <div style="background:#f0fdf4;border-left:4px solid #065f46;padding:14px 16px;border-radius:6px;margin:20px 0;">
        <strong>Thông tin hỗ trợ</strong><br>
        Phú Hồ Gia Career<br>
        📞 SĐT/Zalo: <strong>0968 297 188</strong>
    </div>

    <p>
        Anh/Chị vui lòng kiểm tra thông tin trên phiếu lương.
        Nếu có bất kỳ thắc mắc nào, vui lòng liên hệ theo thông tin trên để được hỗ trợ.
    </p>

    <p>
        Xin cảm ơn Anh/Chị đã đồng hành cùng Công ty.
    </p>

    <br>

    <p>
        Trân trọng,<br>
        <strong>PHÒNG NHÂN SỰ</strong><br>
        Công ty TNHH Tập đoàn PHG
    </p>
</div>
`;

const selectedIndexes = new Set(); // index trong danhSachNhanVien được tick chọn để xuất PDF / gửi email

// Lịch sử gửi email: index trong danhSachNhanVien -> { status: 'sending'|'sent'|'error', time, error }
const emailHistory = new Map();

// index trong danhSachNhanVien đã xuất PDF thành công (dùng cho Dashboard)
const pdfExportedIndexes = new Set();

const searchState = { query: "", boPhan: "", khoi: "", coSo: "" };
const sortState = { key: null, dir: 1 };

const $ = (id) => document.getElementById(id);

// ============================================================
// GIẤY PHÉP SỬ DỤNG THEO THÁNG
// ============================================================
async function capNhatTrangThaiGiayPhep() {
  const box = $("licenseBox");
  const statusEl = $("licenseStatus");
  const form = $("licenseForm");
  if (!box || !statusEl) return null;

  const giayPhep = await window.api.kiemTraGiayPhep();
  box.classList.remove("ok", "het-han");

  if (giayPhep.hopLe) {
    box.classList.add("ok");
    statusEl.textContent = `✓ Đã kích hoạt, có hiệu lực đến ${giayPhep.ngayHetHan}`;
    form.hidden = true;
  } else {
    box.classList.add("het-han");
    statusEl.textContent = `Chưa kích hoạt cho kỳ hiện tại (hết hạn ${giayPhep.ngayHetHan}). Vui lòng liên hệ tác giả để lấy mã.`;
    form.hidden = false;
  }
  return giayPhep;
}

$("btnKichHoat")?.addEventListener("click", async () => {
  const ma = $("oMaKichHoat").value;
  const ketQua = await window.api.kichHoatMa(ma);
  showToast(ketQua.message, ketQua.thanhCong ? "success" : "error");
  if (ketQua.thanhCong) {
    $("oMaKichHoat").value = "";
    await capNhatTrangThaiGiayPhep();
  }
});

capNhatTrangThaiGiayPhep();

// ============================================================
// MODAL XÁC NHẬN & TOAST THÔNG BÁO NỔI
// ============================================================
function showConfirmModal({
  title,
  message,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
}) {
  if (pendingConfirm) return Promise.resolve(false);
  pendingConfirm = true;
  return new Promise((resolve) => {
    const overlay = $("modalOverlay");
    const confirmBtn = $("modalConfirmBtn");
    const cancelBtn = $("modalCancelBtn");

    $("modalTitle").textContent = title;
    $("modalMessage").textContent = message;
    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    overlay.hidden = false;

    const cleanup = (result) => {
      pendingConfirm = false;
      overlay.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    };

    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (event) => {
      if (event.target === overlay) cleanup(false);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") cleanup(false);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

function showToast(message, type = "success", duration = 5000) {
  const container = $("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = type === "success" ? "✓" : type === "error" ? "✕" : "!";

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Đóng thông báo");
  closeBtn.textContent = "×";

  toast.append(icon, text, closeBtn);
  container.appendChild(toast);

  const remove = () => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  };

  closeBtn.addEventListener("click", remove);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(remove, duration);
}

const moneyFormatter = new Intl.NumberFormat("vi-VN");
const dinhDangTien = (n) => moneyFormatter.format(Math.round(Number(n) || 0));
const dinhDangSo = (n) => {
  const so = Number(n);
  return Number.isFinite(so) ? so.toFixed(2) : "";
};

function boDauTiengViet(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const previewColumns = [
  { key: "tt", label: "TT", kind: "index" },
  { key: "maNV", label: "Mã NV", sortable: true },
  { key: "hoTen", label: "Họ tên", sortable: true },
  { key: "khoi", label: "Khối", sortable: true },
  { key: "coSo", label: "Cơ sở", sortable: true },
  { key: "boPhan", label: "Bộ phận", sortable: true },
  { key: "chucVu", label: "Chức vụ", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "actions", label: "Hành động", kind: "actions" },
];

function getPreviewValue(nv, column, sttHienThi) {
  if (column.kind === "index") return String(sttHienThi);
  if (column.kind === "actions") {
    return "";
  }
  const value = nv[column.key];
  if (column.kind === "money") return dinhDangTien(value);
  if (column.kind === "number") return dinhDangSo(value);
  return value !== undefined && value !== null ? String(value) : "";
}

// ============================================================
// BƯỚC 1 - ĐỌC FILE EXCEL
// ============================================================
$("btnChonExcel").addEventListener("click", async () => {
  $("btnChonExcel").disabled = true;
  $("trangThai").textContent = "Đang đọc file Excel...";

  let ketQua;
  try {
    ketQua = await window.api.chonFileExcel();
  } catch (error) {
    $("trangThai").textContent =
      `Không thể đọc file Excel: ${error.message || error}`;
    $("btnChonExcel").disabled = false;
    return;
  }

  $("btnChonExcel").disabled = false;
  if (!ketQua) return; // người dùng bấm Hủy

  if (ketQua.error) {
    $("trangThai").textContent = `Lỗi định dạng file: ${ketQua.error}`;
    return;
  }

  danhSachNhanVien = ketQua.data || [];
  validationResult = ketQua.validation || null;
  searchableEmployeeTexts = danhSachNhanVien.map((nv) =>
    boDauTiengViet(`${nv.maNV || ""} ${nv.hoTen || ""}`),
  );
  validationRowsByIndex = new Map(
    (validationResult?.rows || []).map((row) => [row.rowIndex, row]),
  );
  validationPanelDirty = true;
  emailHistoryDirty = true;
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  selectedIndexes.clear();
  emailHistory.clear();
  pdfExportedIndexes.clear();
  emailHistoryPage = 1;
  sortState.key = null;
  previewPage = 1;
  searchState.query = "";
  searchState.boPhan = "";
  searchState.khoi = "";
  searchState.coSo = "";
  $("oTimKiem").value = "";
  $("locBoPhan").value = "";
  $("locKhoi").value = "";
  $("locCoSo").value = "";

  $("tenFileExcel").textContent = ketQua.filePath.split(/[\\/]/).pop();
  $("soLuong").textContent = danhSachNhanVien.length.toString();

  const trangThaiParts = [];
  trangThaiParts.push(
    danhSachNhanVien.length
      ? `Đã đọc ${danhSachNhanVien.length} nhân viên theo đúng vị trí cột.`
      : "Không tìm thấy dòng dữ liệu hợp lệ trong file Excel.",
  );
  if (ketQua.formatWarning) {
    trangThaiParts.push(`⚠ ${ketQua.formatWarning}`);
  }
  if (validationResult && !validationResult.isClean) {
    trangThaiParts.push(
      `Kiểm tra dữ liệu phát hiện ${validationResult.totalErrors} lỗi và ${validationResult.totalWarnings} cảnh báo — xem Bước 3.`,
    );
  }
  $("trangThai").textContent = trangThaiParts.join("\n");

  populateFilterOptions();
  renderPreviewTable();
  renderDashboard();
  capNhatTrangThaiNutXuat();

  maxUnlockedStep = danhSachNhanVien.length ? 4 : 1;
  updateStepsNav();
  goToStep(danhSachNhanVien.length ? 2 : 1);
});

// ============================================================
// TẢI FILE EXCEL MẪU
// ============================================================
$("linkTaiFileMau").addEventListener("click", async (event) => {
  event.preventDefault();

  let ketQua;
  try {
    ketQua = await window.api.taiFileMau();
  } catch (error) {
    $("trangThai").textContent =
      `Không thể tải file mẫu: ${error.message || error}`;
    return;
  }

  if (!ketQua) return; // người dùng bấm Hủy khi chọn nơi lưu

  if (ketQua.error) {
    $("trangThai").textContent = `Lỗi tải file mẫu: ${ketQua.error}`;
    return;
  }

  $("trangThai").textContent =
    `Đã lưu file Excel mẫu tại:\n${ketQua.savedPath}`;
});

// ============================================================
// CHỌN LOGO CÔNG TY (dùng cho phiếu lương PDF)
// ============================================================
$("btnChonLogo").addEventListener("click", async () => {
  $("btnChonLogo").disabled = true;
  let ketQua;
  try {
    ketQua = await window.api.chonLogo();
  } catch (error) {
    $("trangThai").textContent =
      `Không thể chọn logo: ${error.message || error}`;
    $("btnChonLogo").disabled = false;
    return;
  }

  $("btnChonLogo").disabled = false;
  if (!ketQua) return; // người dùng bấm Hủy

  if (ketQua.error) {
    $("trangThai").textContent = `Lỗi chọn logo: ${ketQua.error}`;
    return;
  }

  $("tenFileLogo").textContent = `Đã chọn: ${ketQua.fileName}`;
  $("logoPreviewImg").src = ketQua.dataUri;
  $("logoPreviewWrap").hidden = false;
  $("btnXoaLogo").hidden = false;
  $("trangThai").textContent = "Đã cập nhật logo công ty cho phiếu lương.";
  luuCauHinhNeuBat();
});

$("btnXoaLogo").addEventListener("click", async () => {
  try {
    await window.api.xoaLogo();
  } catch (error) {
    $("trangThai").textContent =
      `Không thể xóa logo: ${error.message || error}`;
    return;
  }

  $("tenFileLogo").textContent = "Đang dùng logo mặc định.";
  $("logoPreviewImg").src = "";
  $("logoPreviewWrap").hidden = true;
  $("btnXoaLogo").hidden = true;
  $("trangThai").textContent = "Đã xóa logo tùy chỉnh, quay về logo mặc định.";
  luuCauHinhNeuBat();
});

// ============================================================
// GHI NHỚ CẤU HÌNH (Tên công ty, Logo, Tiêu đề/Nội dung email, Email Gmail)
// ============================================================
let luuCauHinhTimer = null;

function hienThongBaoGhiNho(message, isError = false) {
  const el = $("ghiNhoTrangThai");
  if (!el) return;
  el.hidden = false;
  el.classList.toggle("error", isError);
  el.textContent = message;
}

function luuCauHinhNeuBat() {
  if (!$("chkGhiNhoCauHinh").checked) return;
  clearTimeout(luuCauHinhTimer);
  luuCauHinhTimer = setTimeout(async () => {
    luuCauHinhTimer = null;
    if (!$("chkGhiNhoCauHinh").checked) return;
    const payload = {
      tenCongTy: $("tenCongTy").value,
      emailTieuDe: $("emailTieuDe").value,
      emailNoiDung: $("emailNoiDung").value,
      emailNguoiGui: $("emailNguoiGui").value,
      emailMatKhauUngDung: $("emailMatKhauUngDung").value,
    };
    try {
      const ketQua = await window.api.luuCauHinh(payload);
      if (ketQua && ketQua.ok) {
        hienThongBaoGhiNho(
          ketQua.daLuuMatKhau || !payload.emailMatKhauUngDung
            ? "✓ Đã lưu cấu hình."
            : "✓ Đã lưu cấu hình (máy này không hỗ trợ mã hoá nên KHÔNG lưu mật khẩu ứng dụng — cần nhập lại mỗi lần mở app).",
        );
      } else {
        hienThongBaoGhiNho(
          `Không thể lưu cấu hình: ${(ketQua && ketQua.error) || "Lỗi không rõ"}`,
          true,
        );
      }
    } catch (error) {
      hienThongBaoGhiNho(
        `Không thể lưu cấu hình: ${error.message || error}`,
        true,
      );
    }
  }, 600);
}

[
  "tenCongTy",
  "emailTieuDe",
  "emailNoiDung",
  "emailNguoiGui",
  "emailMatKhauUngDung",
].forEach((id) => {
  $(id).addEventListener("input", luuCauHinhNeuBat);
});

$("chkGhiNhoCauHinh").addEventListener("change", async () => {
  if ($("chkGhiNhoCauHinh").checked) {
    luuCauHinhNeuBat();
  } else {
    clearTimeout(luuCauHinhTimer);
    luuCauHinhTimer = null;
    try {
      await window.api.xoaCauHinh();
    } catch {
      /* bỏ qua lỗi xoá — không ảnh hưởng luồng chính */
    }
    hienThongBaoGhiNho("Đã xoá cấu hình đã lưu trên máy này.");
  }
});

async function khoiTaoCauHinhDaLuu() {
  let cauHinh;
  try {
    cauHinh = await window.api.taiCauHinh();
  } catch {
    return;
  }
  if (!cauHinh || cauHinh.error) return;

  $("chkGhiNhoCauHinh").checked = true;
  if (cauHinh.tenCongTy) $("tenCongTy").value = cauHinh.tenCongTy;
  if (cauHinh.emailTieuDe) $("emailTieuDe").value = cauHinh.emailTieuDe;
  if (cauHinh.emailNoiDung)
    $("emailNoiDung").value = cauHinh.emailNoiDung || "";
  if (cauHinh.emailNguoiGui) $("emailNguoiGui").value = cauHinh.emailNguoiGui;
  if (cauHinh.emailMatKhauUngDung)
    $("emailMatKhauUngDung").value = cauHinh.emailMatKhauUngDung;

  if (cauHinh.logoDataUri) {
    $("tenFileLogo").textContent =
      `Đã chọn: ${cauHinh.logoFileName || "logo đã lưu"}`;
    $("logoPreviewImg").src = cauHinh.logoDataUri;
    $("logoPreviewWrap").hidden = false;
    $("btnXoaLogo").hidden = false;
  }

  hienThongBaoGhiNho("Đã tải cấu hình đã lưu từ lần trước.");
}

// ============================================================
// BƯỚC 2 - XEM TRƯỚC DỮ LIỆU (sắp xếp / tìm kiếm / lọc)
// ============================================================
function populateFilterOptions() {
  const boPhanSet = new Set();
  const khoiSet = new Set();
  const coSoSet = new Set();
  danhSachNhanVien.forEach((nv) => {
    if (nv.boPhan) boPhanSet.add(nv.boPhan);
    if (nv.khoi) khoiSet.add(nv.khoi);
    if (nv.coSo) coSoSet.add(nv.coSo);
  });

  const fillSelect = (select, values, placeholder) => {
    const current = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>`;
    const sortedValues = [...values].sort((a, b) => a.localeCompare(b, "vi"));
    const fragment = document.createDocumentFragment();
    sortedValues.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      fragment.appendChild(opt);
    });
    select.appendChild(fragment);
    if (values.has(current)) select.value = current;
  };

  fillSelect($("locBoPhan"), boPhanSet, "Tất cả bộ phận");
  fillSelect($("locKhoi"), khoiSet, "Tất cả khối");
  fillSelect($("locCoSo"), coSoSet, "Tất cả cơ sở");
}

function getFilteredIndexes() {
  const q = boDauTiengViet(searchState.query.trim());
  const indexes = [];

  for (let i = 0; i < danhSachNhanVien.length; i++) {
    const nv = danhSachNhanVien[i];
    if (q && !searchableEmployeeTexts[i]?.includes(q)) continue;
    if (searchState.boPhan && nv.boPhan !== searchState.boPhan) continue;
    if (searchState.khoi && nv.khoi !== searchState.khoi) continue;
    if (searchState.coSo && nv.coSo !== searchState.coSo) continue;
    indexes.push(i);
  }

  if (sortState.key) {
    const col = previewColumns.find((c) => c.key === sortState.key);
    const isNumber = col && col.kind === "money";
    indexes.sort((a, b) => {
      const va = danhSachNhanVien[a][sortState.key];
      const vb = danhSachNhanVien[b][sortState.key];
      if (isNumber) return (Number(va) - Number(vb)) * sortState.dir;
      return (
        String(va ?? "").localeCompare(String(vb ?? ""), "vi") * sortState.dir
      );
    });
  }

  return indexes;
}

function updateHeadCheckboxState(filteredIndexes) {
  const headCheckbox = $("chonTatCa");
  if (!headCheckbox) return;

  if (!filteredIndexes || filteredIndexes.length === 0) {
    headCheckbox.disabled = true;
    headCheckbox.checked = false;
    headCheckbox.indeterminate = false;
    return;
  }

  headCheckbox.disabled = false;
  const allFilteredChecked = filteredIndexes.every((i) => selectedIndexes.has(i));
  const someFilteredChecked = filteredIndexes.some((i) => selectedIndexes.has(i));
  const onlyFilteredSelected = selectedIndexes.size === filteredIndexes.length;

  if (allFilteredChecked && onlyFilteredSelected) {
    headCheckbox.checked = true;
    headCheckbox.indeterminate = false;
  } else if (someFilteredChecked || allFilteredChecked) {
    headCheckbox.checked = false;
    headCheckbox.indeterminate = true;
  } else {
    headCheckbox.checked = false;
    headCheckbox.indeterminate = false;
  }
}

function renderPreviewTable() {
  const thead = $("bangXemTruocHead");
  const tbody = $("bangXemTruocBody");
  const filteredIndexes = getFilteredIndexes();
  visiblePreviewIndexes = filteredIndexes;
  const totalPages = Math.max(1, Math.ceil(filteredIndexes.length / PREVIEW_PAGE_SIZE));
  previewPage = Math.min(previewPage, totalPages);
  const pageStart = (previewPage - 1) * PREVIEW_PAGE_SIZE;
  const pageIndexes = filteredIndexes.slice(pageStart, pageStart + PREVIEW_PAGE_SIZE);

  if (!previewHeadInitialized) {
    const headCells = [
      `<th class="chk-cell" title="Chọn tất cả theo bộ lọc"><label style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;"><input type="checkbox" id="chonTatCa" aria-label="Chọn tất cả theo bộ lọc" title="Chọn tất cả theo bộ lọc"></label></th>`,
      ...previewColumns.map((column) => {
        if (!column.sortable) return `<th>${column.label}</th>`;
        return `<th class="sortable" data-sort-key="${column.key}">${column.label}<span class="sort-arrow"></span></th>`;
      }),
    ];
    thead.innerHTML = `<tr>${headCells.join("")}</tr>`;
    previewHeadInitialized = true;
  }
  updateHeadCheckboxState(filteredIndexes);
  thead.querySelectorAll("th.sortable").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    arrow.textContent =
      sortState.key === th.dataset.sortKey
        ? sortState.dir === 1
          ? "▲"
          : "▼"
        : "";
  });

  const rowsFragment = document.createDocumentFragment();
  pageIndexes.forEach((index, pagePos) => {
    const nv = danhSachNhanVien[index];
    const rowIssues = validationRowsByIndex.get(index) || null;
    const hasError =
      rowIssues && rowIssues.issues.some((it) => it.level === "error");
    const hasWarning = rowIssues && !hasError && rowIssues.issues.length > 0;
    const rowClass = hasError ? "has-error" : hasWarning ? "has-warning" : "";

    const cells = [
      `<td class="chk-cell"><input type="checkbox" class="row-chk" data-index="${index}" ${selectedIndexes.has(index) ? "checked" : ""} title="Chọn nhân viên này"></td>`,
      ...previewColumns.map((column) => {
        if (column.kind === "actions") {
          return `<td class="action-cell">
            <button class="row-action-btn secondary preview-btn" data-preview-index="${index}">Xem trước PDF</button>
            <button class="row-action-btn tertiary export-one-btn" data-export-index="${index}">Xuất PDF</button>
            <button class="row-action-btn tertiary send-email-one-btn" data-send-email-index="${index}" ${nv.email ? "" : 'disabled title="Nhân viên chưa có email"'}>Gửi email</button>
          </td>`;
        }
        const isNumber = column.kind === "money" || column.kind === "number";
        return `<td class="${isNumber ? "num" : ""}">${getPreviewValue(nv, column, pageStart + pagePos + 1)}</td>`;
      }),
    ];
    const tr = document.createElement("tr");
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = cells.join("");
    rowsFragment.appendChild(tr);
  });
  tbody.replaceChildren(rowsFragment);

  renderFilteredSummary(filteredIndexes);
  renderSelectionSummary();

  $("soLuongLocLabel").textContent =
    `${filteredIndexes.length} / ${danhSachNhanVien.length} nhân viên`;
  $("previewPagination").hidden = filteredIndexes.length <= PREVIEW_PAGE_SIZE;
  $("previewPaginationLabel").textContent = filteredIndexes.length
    ? `Hiển thị ${pageStart + 1}–${pageStart + pageIndexes.length} / ${filteredIndexes.length}`
    : "Không có nhân viên phù hợp";
  $("btnPreviewPrevious").disabled = previewPage === 1;
  $("btnPreviewNext").disabled = previewPage === totalPages;
}

function wirePreviewTableEvents() {
  const thead = $("bangXemTruocHead");
  const tbody = $("bangXemTruocBody");

  thead.addEventListener("click", (event) => {
    const th = event.target.closest("th.sortable");
    if (!th || !thead.contains(th)) return;

    const key = th.dataset.sortKey;
    if (sortState.key === key) {
      sortState.dir *= -1;
    } else {
      sortState.key = key;
      sortState.dir = 1;
    }
    previewPage = 1;
    renderPreviewTable();
  });

  thead.addEventListener("change", (event) => {
    const checkbox = event.target.closest("#chonTatCa");
    if (!checkbox) return;

    clearTimeout(searchRenderTimer);
    searchRenderTimer = null;
    const currentFilteredIndexes = getFilteredIndexes();
    if (!currentFilteredIndexes.length) {
      checkbox.checked = false;
      checkbox.indeterminate = false;
      return;
    }

    if (checkbox.checked) {
      // Tích chọn theo bộ lọc: chỉ chọn những nhân viên đang hiển thị theo bộ lọc
      selectedIndexes.clear();
      currentFilteredIndexes.forEach((index) => {
        selectedIndexes.add(index);
      });
    } else {
      // Bỏ chọn tất cả nhân viên trong bộ lọc hiện tại
      currentFilteredIndexes.forEach((index) => {
        selectedIndexes.delete(index);
      });
    }
    renderPreviewTable();
    capNhatTrangThaiNutXuat();
  });

  tbody.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".row-chk");
    if (!checkbox) return;

    const index = Number(checkbox.dataset.index);
    if (checkbox.checked) selectedIndexes.add(index);
    else selectedIndexes.delete(index);
    renderSelectionSummary();
    capNhatTrangThaiNutXuat();
    updateHeadCheckboxState(visiblePreviewIndexes);
  });

  tbody.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !tbody.contains(button)) return;

    if (button.matches(".preview-btn")) {
      if (pdfJobInFlight || emailJobInFlight) {
        showToast("Vui lòng đợi tác vụ PDF/email hiện tại hoàn tất.", "warning");
        return;
      }
      const index = Number(button.dataset.previewIndex);
      const nhanVien = danhSachNhanVien[index];
      if (!nhanVien) return;

      button.disabled = true;
      try {
        await window.api.xemTruocPdf({
          nhanVien,
          tenCongTy: $("tenCongTy").value,
          thangNam: $("thangNam").value,
        });
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (button.matches(".export-one-btn")) {
      const index = Number(button.dataset.exportIndex);
      const nhanVien = danhSachNhanVien[index];
      if (!nhanVien) return;
      const xacNhan = await showConfirmModal({
        title: "Xác nhận xuất PDF",
        message: `Xuất phiếu lương PDF cho "${nhanVien.hoTen || nhanVien.maNV}"?\n\nThư mục lưu: ${thuMucLuu || "(chưa chọn — sẽ được yêu cầu chọn)"}`,
        confirmLabel: "Xuất PDF",
      });
      if (xacNhan) {
        await xuatPdfChoDanhSach(
          [index],
          `Xuất PDF cho ${nhanVien.hoTen || nhanVien.maNV}`,
        );
      }
      return;
    }

    if (button.matches(".send-email-one-btn")) {
      const index = Number(button.dataset.sendEmailIndex);
      const nhanVien = danhSachNhanVien[index];
      if (!nhanVien) return;
      const xacNhan = await showConfirmModal({
        title: "Xác nhận gửi email",
        message: `Gửi phiếu lương qua email cho "${nhanVien.hoTen || nhanVien.maNV}" (${nhanVien.email})?`,
        confirmLabel: "Gửi email",
      });
      if (xacNhan) await guiEmailMotNguoi(index);
    }
  });
}

function renderFilteredSummary(filteredIndexes) {
  let tongThuNhap = 0;
  let tongKhauTru = 0;
  let tongThucNhan = 0;
  filteredIndexes.forEach((index) => {
    const nv = danhSachNhanVien[index];
    tongThuNhap += Number(nv.tongThuNhap) || 0;
    tongKhauTru += Number(nv.tongKhauTru) || 0;
    tongThucNhan += Number(nv.thucNhan) || 0;
  });

  $("soLuongLoc").textContent = filteredIndexes.length.toString();
  $("tongThuNhapLoc").textContent = dinhDangTien(tongThuNhap);
  $("tongKhauTruLoc").textContent = dinhDangTien(tongKhauTru);
  $("tongThucNhanLoc").textContent = dinhDangTien(tongThucNhan);
}

["oTimKiem"].forEach((id) => {
  $(id).addEventListener("input", () => {
    searchState.query = $(id).value;
    previewPage = 1;
    clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(renderPreviewTable, 120);
  });
});

$("locBoPhan").addEventListener("change", () => {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  searchState.boPhan = $("locBoPhan").value;
  previewPage = 1;
  renderPreviewTable();
});

$("locKhoi").addEventListener("change", () => {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  searchState.khoi = $("locKhoi").value;
  previewPage = 1;
  renderPreviewTable();
});

$("locCoSo").addEventListener("change", () => {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  searchState.coSo = $("locCoSo").value;
  previewPage = 1;
  renderPreviewTable();
});

$("btnResetLoc").addEventListener("click", () => {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  searchState.query = "";
  searchState.boPhan = "";
  searchState.khoi = "";
  searchState.coSo = "";
  previewPage = 1;
  $("oTimKiem").value = "";
  $("locBoPhan").value = "";
  $("locKhoi").value = "";
  $("locCoSo").value = "";
  renderPreviewTable();
});

$("btnPreviewPrevious").addEventListener("click", () => {
  if (previewPage <= 1) return;
  previewPage -= 1;
  renderPreviewTable();
});

$("btnPreviewNext").addEventListener("click", () => {
  const totalPages = Math.ceil(visiblePreviewIndexes.length / PREVIEW_PAGE_SIZE);
  if (previewPage >= totalPages) return;
  previewPage += 1;
  renderPreviewTable();
});

function renderSelectionSummary() {
  $("soLuongDaChon").textContent = selectedIndexes.size.toString();
  $("soLuongDaChonLabel").textContent =
    `${selectedIndexes.size} nhân viên đã chọn`;
}

// ============================================================
// BƯỚC 3 - KIỂM TRA DỮ LIỆU
// ============================================================
function renderValidationPanel() {
  if (currentStep !== 3) {
    validationPanelDirty = true;
    return;
  }
  validationPanelDirty = false;

  const tbody = $("bangKiemTraBody");
  const cleanBanner = $("cleanBanner");

  if (!validationResult) {
    tbody.innerHTML = "";
    cleanBanner.hidden = true;
    $("vTongDong").textContent = "0";
    $("vSoDongLoi").textContent = "0";
    $("vSoDongCanhBao").textContent = "0";
    $("vTongLoi").textContent = "0 / 0";
    return;
  }

  $("vTongDong").textContent = validationResult.totalRows.toString();
  $("vSoDongLoi").textContent = validationResult.rowsWithErrorsCount.toString();
  $("vSoDongCanhBao").textContent =
    validationResult.rowsWithWarningsCount.toString();
  $("vTongLoi").textContent =
    `${validationResult.totalErrors} / ${validationResult.totalWarnings}`;

  cleanBanner.hidden = !validationResult.isClean;

  tbody.innerHTML = validationResult.rows
    .slice()
    .sort((a, b) => a.stt - b.stt)
    .map((r) => {
      const hasError = r.issues.some((it) => it.level === "error");
      const badges = r.issues
        .map((it) => `<span class="badge ${it.level}">${it.message}</span>`)
        .join("");
      return `<tr class="${hasError ? "has-error" : "has-warning"}">
        <td>${r.stt}</td>
        <td>${r.maNV || "—"}</td>
        <td>${r.hoTen || "—"}</td>
        <td class="issues-cell">${badges}</td>
      </tr>`;
    })
    .join("");
}

// ============================================================
// BƯỚC 4 - GỬI EMAIL & LỊCH SỬ GỬI
// ============================================================
const trangThaiGuiEmailLabel = {
  sending: "Đang gửi...",
  sent: "✓ Đã gửi",
  error: "✕ Lỗi",
};

function renderEmailHistoryTable() {
  const tbody = $("bangDaChonBody");
  const pagination = $("emailHistoryPagination");

  $("soLuongDaChonLabel").textContent =
    `${selectedIndexes.size} nhân viên đã chọn`;

  if (currentStep !== 4) {
    emailHistoryDirty = true;
    return;
  }
  emailHistoryDirty = false;

  if (!danhSachNhanVien.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Chưa có dữ liệu. Hãy đọc file Excel ở Bước 1.</td></tr>`;
    pagination.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(danhSachNhanVien.length / PREVIEW_PAGE_SIZE));
  emailHistoryPage = Math.min(emailHistoryPage, totalPages);
  const pageStart = (emailHistoryPage - 1) * PREVIEW_PAGE_SIZE;
  const pageEmployees = danhSachNhanVien.slice(
    pageStart,
    pageStart + PREVIEW_PAGE_SIZE,
  );

  tbody.innerHTML = pageEmployees
    .map((nv, pageIndex) => {
      const index = pageStart + pageIndex;
      const su = emailHistory.get(index);
      const trangThai = su
        ? `<span class="badge ${su.status === "error" ? "error" : su.status === "sending" ? "warning" : ""}">${trangThaiGuiEmailLabel[su.status] || ""}</span>${su.status === "error" && su.error ? `<div class="muted small">${su.error}</div>` : ""}`
        : `<span class="muted">Chưa gửi</span>`;
      const thoiGian = su && su.time ? su.time.toLocaleString("vi-VN") : "—";
      const coEmail = Boolean(nv.email);

      return `
      <tr>
        <td>${nv.maNV || "—"}</td>
        <td>${nv.hoTen || "—"}</td>
        <td>${nv.email || '<span class="muted">(chưa có email)</span>'}</td>
        <td>${trangThai}</td>
        <td>${thoiGian}</td>
        <td class="action-cell">
          <button class="row-action-btn tertiary" data-gui-lai-index="${index}" ${coEmail ? "" : "disabled"}>${su && su.status === "sent" ? "Gửi lại" : "Gửi email"}</button>
        </td>
      </tr>`;
    })
    .join("");
  pagination.hidden = danhSachNhanVien.length <= PREVIEW_PAGE_SIZE;
  $("emailHistoryPaginationLabel").textContent =
    `Hiển thị ${pageStart + 1}–${pageStart + pageEmployees.length} / ${danhSachNhanVien.length}`;
  $("btnEmailHistoryPrevious").disabled = emailHistoryPage === 1;
  $("btnEmailHistoryNext").disabled = emailHistoryPage === totalPages;
}

function wireEmailHistoryEvents() {
  const tbody = $("bangDaChonBody");
  tbody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-gui-lai-index]");
    if (!button || !tbody.contains(button)) return;

    const index = Number(button.dataset.guiLaiIndex);
    const nv = danhSachNhanVien[index];
    if (!nv) return;
    const xacNhan = await showConfirmModal({
      title: "Xác nhận gửi email",
      message: `Gửi phiếu lương qua email cho "${nv.hoTen || nv.maNV}" (${nv.email})?`,
      confirmLabel: "Gửi email",
    });
    if (xacNhan) await guiEmailMotNguoi(index);
  });

  $("btnEmailHistoryPrevious").addEventListener("click", () => {
    if (emailHistoryPage <= 1) return;
    emailHistoryPage -= 1;
    renderEmailHistoryTable();
  });

  $("btnEmailHistoryNext").addEventListener("click", () => {
    const totalPages = Math.ceil(danhSachNhanVien.length / PREVIEW_PAGE_SIZE);
    if (emailHistoryPage >= totalPages) return;
    emailHistoryPage += 1;
    renderEmailHistoryTable();
  });
}

// ============================================================
// DASHBOARD TỔNG QUAN (Bước 4)
// ============================================================
function renderDashboard() {
  const tong = danhSachNhanVien.length;
  let daGui = 0;
  let loi = 0;
  emailHistory.forEach((su) => {
    if (su.status === "sent") daGui++;
    else if (su.status === "error") loi++;
  });
  const chuaGui = Math.max(tong - daGui - loi, 0);
  const phanTram = tong ? Math.round((daGui / tong) * 100) : 0;

  $("dbTongNhanVien").textContent = tong.toString();
  $("dbDaGui").textContent = daGui.toString();
  $("dbChuaGui").textContent = chuaGui.toString();
  $("dbLoi").textContent = loi.toString();
  $("dbPdfDaTao").textContent = pdfExportedIndexes.size.toString();
  $("dbPhanTram").textContent = `${phanTram}%`;
  $("dashboardBarFill").style.width = `${phanTram}%`;
}

function hienThanhTienDo(tongSo) {
  const wrap = $("progressWrap");
  wrap.hidden = false;
  $("progressBarFill").style.width = "0%";
  $("progressLabel").textContent = `0 / ${tongSo} (0%)`;
}

function capNhatThanhTienDo({ daXong, tongSo }) {
  const phanTram = tongSo ? Math.round((daXong / tongSo) * 100) : 0;
  $("progressBarFill").style.width = `${phanTram}%`;
  $("progressLabel").textContent = `${daXong} / ${tongSo} (${phanTram}%)`;
}

function anThanhTienDo() {
  $("progressWrap").hidden = true;
}

// Đăng ký lắng nghe tiến độ xuất PDF từ tiến trình main (đăng ký 1 lần duy nhất)
window.api.onXuatPdfTienDo((data) => {
  capNhatThanhTienDo(data);
});

function capNhatTrangThaiNutXuat() {
  $("btnXuatPdf").disabled =
    pdfJobInFlight || emailJobInFlight || !(danhSachNhanVien.length > 0 && thuMucLuu);
  $("btnXuatChon").disabled =
    pdfJobInFlight || emailJobInFlight || !(selectedIndexes.size > 0 && thuMucLuu);
  capNhatTrangThaiNutGuiEmail();
}

async function xuatPdfChoDanhSach(indexes, nhanTrangThaiDangXuat) {
  if (!indexes.length || pdfJobInFlight || emailJobInFlight) return;
  pdfJobInFlight = true;
  capNhatTrangThaiNutXuat();
  const danhSach = indexes.map((i) => danhSachNhanVien[i]);

  try {
    if (!thuMucLuu) {
      const duongDan = await window.api.chonThuMucLuu();
      if (!duongDan) {
        $("trangThai").textContent = "Đã hủy: chưa chọn thư mục lưu PDF.";
        return;
      }
      thuMucLuu = duongDan;
      $("tenThuMuc").textContent = duongDan;
      capNhatTrangThaiNutXuat();
    }

    $("trangThai").textContent =
      `${nhanTrangThaiDangXuat || "Đang xuất PDF"}, vui lòng đợi...`;
    $("btnXuatPdf").disabled = true;
    $("btnXuatChon").disabled = true;
    hienThanhTienDo(danhSach.length);

    const ketQua = await window.api.xuatPdf({
      danhSach,
      thuMucLuu,
      tenCongTy: $("tenCongTy").value,
      thangNam: $("thangNam").value,
    });

    if (ketQua.busy) {
      $("trangThai").textContent = ketQua.message;
      showToast(ketQua.message, "warning");
      return;
    }

    if (ketQua.loiGiayPhep) {
      $("trangThai").textContent = ketQua.loiGiayPhep;
      showToast(ketQua.loiGiayPhep, "error");
      await capNhatTrangThaiGiayPhep();
      return;
    }

    const thanhCong = ketQua.thanhCong || [];
    const loi = ketQua.loi || [];
    const maNVLoi = new Set(loi.map((l) => l.maNV));

    indexes.forEach((i) => {
      const nv = danhSachNhanVien[i];
      const maNV = nv.maNhanVien || nv.maNV || "";
      if (maNVLoi.has(maNV)) {
        pdfExportedIndexes.delete(i);
      } else {
        pdfExportedIndexes.add(i);
      }
    });

    let thongBao = `Đã xuất xong ${thanhCong.length}/${danhSach.length} phiếu lương vào:\n${thuMucLuu}`;
    if (loi.length > 0) {
      const chiTiet = loi
        .slice(0, 5)
        .map((l) => `- ${l.hoTen || l.maNV || "(không rõ)"}: ${l.message}`)
        .join("\n");
      thongBao += `\n\n⚠ ${loi.length} phiếu bị lỗi, các phiếu khác vẫn được xuất bình thường:\n${chiTiet}`;
      if (loi.length > 5) thongBao += `\n... và ${loi.length - 5} lỗi khác`;
    }
    $("trangThai").textContent = thongBao;

    if (loi.length === 0) {
      showToast(
        `Đã xuất xong ${thanhCong.length}/${danhSach.length} phiếu lương thành công.`,
        "success",
      );
    } else if (thanhCong.length > 0) {
      showToast(
        `Xuất xong ${thanhCong.length}/${danhSach.length} phiếu lương, ${loi.length} phiếu bị lỗi.`,
        "warning",
      );
    } else {
      showToast(
        `Xuất PDF thất bại cho toàn bộ ${danhSach.length} phiếu lương.`,
        "error",
      );
    }
  } catch (error) {
    $("trangThai").textContent =
      `Không thể xuất PDF: ${error.message || error}`;
    showToast(`Không thể xuất PDF: ${error.message || error}`, "error");
  } finally {
    pdfJobInFlight = false;
    capNhatTrangThaiNutXuat();
    renderDashboard();
    setTimeout(anThanhTienDo, 1200);
  }
}

$("btnChonThuMuc").addEventListener("click", async () => {
  const duongDan = await window.api.chonThuMucLuu();
  if (!duongDan) return;

  thuMucLuu = duongDan;
  $("tenThuMuc").textContent = duongDan;
  $("trangThai").textContent = "Đã chọn thư mục lưu PDF.";
  capNhatTrangThaiNutXuat();
});

$("btnXuatPdf").addEventListener("click", async () => {
  if (!danhSachNhanVien.length) return;
  const xacNhan = await showConfirmModal({
    title: "Xác nhận xuất PDF",
    message: `Xuất phiếu lương PDF cho toàn bộ ${danhSachNhanVien.length} nhân viên?\n\nThư mục lưu: ${thuMucLuu || "(chưa chọn — sẽ được yêu cầu chọn)"}`,
    confirmLabel: "Xuất PDF",
  });
  if (!xacNhan) return;
  await xuatPdfChoDanhSach(
    danhSachNhanVien.map((_, i) => i),
    `Đang xuất toàn bộ ${danhSachNhanVien.length} phiếu lương`,
  );
});

$("btnXuatChon").addEventListener("click", async () => {
  const indexes = [...selectedIndexes].sort((a, b) => a - b);
  if (!indexes.length) return;
  const xacNhan = await showConfirmModal({
    title: "Xác nhận xuất PDF",
    message: `Xuất phiếu lương PDF cho ${indexes.length} nhân viên đã chọn?\n\nThư mục lưu: ${thuMucLuu || "(chưa chọn — sẽ được yêu cầu chọn)"}`,
    confirmLabel: "Xuất PDF",
  });
  if (!xacNhan) return;
  await xuatPdfChoDanhSach(
    indexes,
    `Đang xuất ${indexes.length} phiếu lương đã chọn`,
  );
});

// ============================================================
// GỬI EMAIL PHIẾU LƯƠNG (Gmail)
// ============================================================
function layThongTinEmail() {
  const userTemplate = ($("emailNoiDung")?.value || "").trim();

  return {
    taiKhoanGmail: {
      email: ($("emailNguoiGui")?.value || "").trim(),
      matKhauUngDung: $("emailMatKhauUngDung")?.value || "",
    },
    tieuDe: $("emailTieuDe")?.value || "",
    noiDung: userTemplate || DEFAULT_EMAIL_TEMPLATE,
    tenCongTy: $("tenCongTy")?.value || "",
    thangNam: $("thangNam")?.value || "",
  };
}

function kiemTraThongTinGmail() {
  const { taiKhoanGmail } = layThongTinEmail();
  if (!taiKhoanGmail.email || !taiKhoanGmail.matKhauUngDung) {
    showToast(
      "Vui lòng nhập Email người gửi và Mật khẩu ứng dụng Gmail ở mục 5.",
      "error",
    );
    return false;
  }
  return true;
}

function capNhatTrangThaiNutGuiEmail() {
  $("btnGuiEmailTatCa").disabled =
    emailJobInFlight || pdfJobInFlight || !danhSachNhanVien.length;
  $("btnGuiEmailChon").disabled =
    emailJobInFlight || pdfJobInFlight || !selectedIndexes.size;
}

function hienThanhTienDoEmail(tongSo) {
  const wrap = $("progressWrapEmail");
  wrap.hidden = false;
  $("progressBarFillEmail").style.width = "0%";
  $("progressLabelEmail").textContent = `0 / ${tongSo} (0%)`;
}

function capNhatThanhTienDoEmail({ daXong, tongSo }) {
  const phanTram = tongSo ? Math.round((daXong / tongSo) * 100) : 0;
  $("progressBarFillEmail").style.width = `${phanTram}%`;
  $("progressLabelEmail").textContent = `${daXong} / ${tongSo} (${phanTram}%)`;
}

function anThanhTienDoEmail() {
  $("progressWrapEmail").hidden = true;
}

window.api.onGuiEmailTienDo((data) => {
  capNhatThanhTienDoEmail(data);
});

// Gửi email cho 1 nhân viên (dùng cho nút riêng từng dòng và nút "gửi lại"
// ở bảng lịch sử).
async function guiEmailMotNguoi(index) {
  if (emailJobInFlight || pdfJobInFlight) {
    showToast("Vui lòng đợi tác vụ PDF/email hiện tại hoàn tất.", "warning");
    return;
  }
  if (!kiemTraThongTinGmail()) return;
  const nv = danhSachNhanVien[index];
  if (!nv) return;
  if (!nv.email) {
    showToast(
      `"${nv.hoTen || nv.maNV}" chưa có email trong file Excel.`,
      "error",
    );
    return;
  }

  emailJobInFlight = true;
  capNhatTrangThaiNutXuat();
  emailHistory.set(index, { status: "sending" });
  renderEmailHistoryTable();
  renderDashboard();

  const { taiKhoanGmail, tieuDe, noiDung, tenCongTy, thangNam } =
    layThongTinEmail();

  $("trangThai").textContent = `Đang gửi email cho ${nv.hoTen || nv.maNV}...`;

  try {
    const ketQua = await window.api.guiEmail({
      nhanVien: nv,
      tenCongTy,
      thangNam,
      taiKhoanGmail,
      tieuDe,
      noiDung,
    });

    if (ketQua.ok) {
      emailHistory.set(index, {
        status: "sent",
        time: new Date(),
        email: nv.email,
      });
      showToast(
        `Đã gửi email phiếu lương cho ${nv.hoTen || nv.maNV}.`,
        "success",
      );
      $("trangThai").textContent =
        `Đã gửi email cho ${nv.hoTen || nv.maNV} (${nv.email}).`;
    } else {
      emailHistory.set(index, {
        status: "error",
        time: new Date(),
        error: ketQua.error,
      });
      showToast(`Gửi email thất bại: ${ketQua.error}`, "error");
      $("trangThai").textContent =
        `Gửi email thất bại cho ${nv.hoTen || nv.maNV}: ${ketQua.error}`;
    }
  } catch (error) {
    emailHistory.set(index, {
      status: "error",
      time: new Date(),
      error: error.message || String(error),
    });
    showToast(`Gửi email thất bại: ${error.message || error}`, "error");
  } finally {
    emailJobInFlight = false;
    capNhatTrangThaiNutXuat();
    renderEmailHistoryTable();
    renderDashboard();
  }
}

// Gửi email hàng loạt cho danh sách các index đã chọn.
async function guiEmailChoDanhSachIndex(indexes, nhanTrangThaiDangGui) {
  if (!indexes.length || emailJobInFlight || pdfJobInFlight) return;
  if (!kiemTraThongTinGmail()) return;
  emailJobInFlight = true;
  capNhatTrangThaiNutXuat();

  const danhSach = indexes.map((i) => danhSachNhanVien[i]);
  const thieuEmail = danhSach.filter((nv) => !nv.email);
  if (thieuEmail.length === danhSach.length) {
    showToast("Không có nhân viên nào trong danh sách có email.", "error");
    emailJobInFlight = false;
    return;
  }

  indexes.forEach((i) => {
    if (danhSachNhanVien[i].email) {
      emailHistory.set(i, { status: "sending" });
    }
  });
  renderEmailHistoryTable();
  renderDashboard();

  const { taiKhoanGmail, tieuDe, noiDung, tenCongTy, thangNam } =
    layThongTinEmail();

  $("trangThai").textContent =
    `${nhanTrangThaiDangGui || "Đang gửi email"}, vui lòng đợi...`;
  $("btnGuiEmailChon").disabled = true;
  $("btnGuiEmailTatCa").disabled = true;
  hienThanhTienDoEmail(danhSach.length);

  try {
    const ketQua = await window.api.guiEmailHangLoat({
      danhSach,
      tenCongTy,
      thangNam,
      taiKhoanGmail,
      tieuDe,
      noiDung,
    });

    if (ketQua.busy) {
      indexes.forEach((i) => {
        if (emailHistory.get(i)?.status === "sending") emailHistory.delete(i);
      });
      $("trangThai").textContent = ketQua.message;
      showToast(ketQua.message, "warning");
      return;
    }

    if (ketQua.loiGiayPhep) {
      $("trangThai").textContent = ketQua.loiGiayPhep;
      showToast(ketQua.loiGiayPhep, "error");
      await capNhatTrangThaiGiayPhep();
      return;
    }

    const thanhCong = ketQua.thanhCong || [];
    const loi = ketQua.loi || [];
    const now = new Date();
    const loiTheoMaNV = new Map();
    loi.forEach((item) => {
      if (!loiTheoMaNV.has(item.maNV)) loiTheoMaNV.set(item.maNV, item);
    });

    indexes.forEach((i) => {
      const nv = danhSachNhanVien[i];
      const bi_loi = loiTheoMaNV.get(nv.maNhanVien || nv.maNV);
      if (bi_loi) {
        emailHistory.set(i, {
          status: "error",
          time: now,
          error: bi_loi.message,
        });
      } else if (nv.email) {
        emailHistory.set(i, { status: "sent", time: now, email: nv.email });
      }
    });

    let thongBao = `Đã gửi xong ${thanhCong.length}/${danhSach.length} email phiếu lương.`;
    if (loi.length > 0) {
      const chiTiet = loi
        .slice(0, 5)
        .map((l) => `- ${l.hoTen || l.maNV || "(không rõ)"}: ${l.message}`)
        .join("\n");
      thongBao += `\n\n⚠ ${loi.length} email bị lỗi:\n${chiTiet}`;
      if (loi.length > 5) thongBao += `\n... và ${loi.length - 5} lỗi khác`;
    }
    $("trangThai").textContent = thongBao;

    if (loi.length === 0) {
      showToast(
        `Đã gửi xong ${thanhCong.length}/${danhSach.length} email.`,
        "success",
      );
    } else if (thanhCong.length > 0) {
      showToast(
        `Gửi xong ${thanhCong.length}/${danhSach.length} email, ${loi.length} email bị lỗi.`,
        "warning",
      );
    } else {
      showToast(
        `Gửi email thất bại cho toàn bộ ${danhSach.length} người.`,
        "error",
      );
    }
  } catch (error) {
    $("trangThai").textContent =
      `Không thể gửi email: ${error.message || error}`;
    showToast(`Không thể gửi email: ${error.message || error}`, "error");
  } finally {
    emailJobInFlight = false;
    capNhatTrangThaiNutXuat();
    renderEmailHistoryTable();
    renderDashboard();
    setTimeout(anThanhTienDoEmail, 1200);
  }
}

$("btnGuiEmailChon").addEventListener("click", async () => {
  const indexes = [...selectedIndexes].sort((a, b) => a - b);
  if (!indexes.length) return;
  const xacNhan = await showConfirmModal({
    title: "Xác nhận gửi email",
    message: `Gửi email phiếu lương cho ${indexes.length} nhân viên đã chọn?`,
    confirmLabel: "Gửi email",
  });
  if (!xacNhan) return;
  await guiEmailChoDanhSachIndex(
    indexes,
    `Đang gửi ${indexes.length} email đã chọn`,
  );
});

$("btnGuiEmailTatCa").addEventListener("click", async () => {
  if (!danhSachNhanVien.length) return;
  const indexes = danhSachNhanVien.map((_, i) => i);
  const xacNhan = await showConfirmModal({
    title: "Xác nhận gửi email",
    message: `Gửi email phiếu lương cho toàn bộ ${indexes.length} nhân viên?`,
    confirmLabel: "Gửi email",
  });
  if (!xacNhan) return;
  await guiEmailChoDanhSachIndex(
    indexes,
    `Đang gửi toàn bộ ${indexes.length} email`,
  );
});

// ============================================================
// ĐIỀU HƯỚNG 4 BƯỚC
// ============================================================
function updateStepsNav() {
  document.querySelectorAll(".step-btn").forEach((btn) => {
    const step = Number(btn.dataset.step);
    const locked = step > maxUnlockedStep;
    btn.disabled = locked;
    btn.classList.toggle("active", step === currentStep);
    btn.classList.toggle("done", step < currentStep && step <= maxUnlockedStep);
    btn.classList.toggle("locked", locked);
  });
}

function goToStep(step) {
  if (step > maxUnlockedStep) return;
  currentStep = step;
  document.querySelectorAll(".step-panel").forEach((panel) => {
    panel.hidden = Number(panel.dataset.stepPanel) !== step;
  });
  if (step === 3 && validationPanelDirty) renderValidationPanel();
  if (step === 4 && emailHistoryDirty) renderEmailHistoryTable();
  updateStepsNav();
}

document.querySelectorAll(".step-btn").forEach((btn) => {
  btn.addEventListener("click", () => goToStep(Number(btn.dataset.step)));
});

// ============================================================
// CUỘN LÊN ĐẦU / XUỐNG CUỐI TRANG
// ============================================================
const btnScrollTop = $("btnScrollTop");
const btnScrollBottom = $("btnScrollBottom");

function capNhatNutCuonTrang() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  btnScrollTop.hidden = window.scrollY < 80;
  btnScrollBottom.hidden = maxScroll <= 0 || window.scrollY >= maxScroll - 80;
}

btnScrollTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

btnScrollBottom.addEventListener("click", () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
});

window.addEventListener("scroll", capNhatNutCuonTrang, { passive: true });
window.addEventListener("resize", capNhatNutCuonTrang);

// ============================================================
// KHỞI TẠO
// ============================================================
wirePreviewTableEvents();
wireEmailHistoryEvents();
capNhatTrangThaiNutXuat();
renderEmailHistoryTable();
renderDashboard();
updateStepsNav();
khoiTaoCauHinhDaLuu();
capNhatNutCuonTrang();

// ============================================================
// AUTO-UPDATE UI
// ============================================================
(function initAutoUpdateUI() {
  const banner = document.getElementById("updateBanner");
  const icon = document.getElementById("updateIcon");
  const message = document.getElementById("updateMessage");
  const progressWrap = document.getElementById("updateProgressWrap");
  const progressFill = document.getElementById("updateProgressFill");
  const btnInstall = document.getElementById("btnCaiDatCapNhat");
  const btnDismiss = document.getElementById("btnDismissUpdate");
  const btnCheckUpdate = document.getElementById("btnKiemTraCapNhat");
  const textCheckUpdate = document.getElementById("textCheckUpdate");

  if (!banner) return;

  let autoHideTimer = null;
  let isManualCheck = false;

  function hideBanner() {
    clearTimeout(autoHideTimer);
    banner.hidden = true;
    banner.style.display = "none";
  }

  function showBanner(status) {
    clearTimeout(autoHideTimer);
    banner.hidden = false;
    banner.style.display = "flex";
    banner.setAttribute("data-status", status);
  }

  // Khởi đầu luôn ẩn banner
  hideBanner();

  // Nút X tắt thông báo cập nhật
  btnDismiss?.addEventListener("click", () => {
    hideBanner();
  });

  // Nút cài đặt & khởi động lại
  btnInstall?.addEventListener("click", () => {
    btnInstall.disabled = true;
    btnInstall.textContent = "Đang cài đặt…";
    hideBanner();
    if (window.api?.caiDatCapNhat) {
      window.api.caiDatCapNhat();
    }
  });

  // Lắng nghe trạng thái cập nhật từ main process
  if (window.api?.onCapNhatTrangThai) {
    window.api.onCapNhatTrangThai((data) => {
      const { status } = data;

      // CHỈ hiển thị banner khi có bản cập nhật mới (available, downloading, ready)
      if (status === "available") {
        icon.textContent = "✨";
        message.textContent = `Phát hiện phiên bản mới (${data.version || ""}). Đang tự động tải về…`;
        if (progressWrap) progressWrap.hidden = true;
        if (btnInstall) btnInstall.hidden = true;
        showBanner(status);
      } else if (status === "downloading") {
        icon.textContent = "⬇️";
        message.textContent = `Đang tải bản cập nhật: ${data.percent || 0}%`;
        if (progressWrap) {
          progressWrap.hidden = false;
          progressWrap.style.display = "block";
        }
        if (progressFill) progressFill.style.width = (data.percent || 0) + "%";
        if (btnInstall) btnInstall.hidden = true;
        showBanner(status);
      } else if (status === "ready") {
        icon.textContent = "🎉";
        message.textContent = `Phiên bản mới (${data.version || ""}) đã sẵn sàng!`;
        if (progressWrap) {
          progressWrap.hidden = true;
          progressWrap.style.display = "none";
        }
        if (btnInstall) {
          btnInstall.hidden = false;
          btnInstall.style.display = "inline-block";
          btnInstall.disabled = false;
          btnInstall.textContent = "Cài đặt & Khởi động lại";
        }
        showBanner(status);
      } else if (status === "up-to-date") {
        // Tự động ẩn banner
        hideBanner();
        if (isManualCheck) {
          showToast("Bạn đang sử dụng phiên bản mới nhất!", "success", 3000);
        }
      } else if (status === "error") {
        // Lỗi kiểm tra: ẩn banner để không chiếm diện tích
        hideBanner();
        console.warn("AutoUpdater status:", data.message);
        if (isManualCheck) {
          showToast("Không thể kết nối máy chủ kiểm tra cập nhật.", "warning", 3500);
        }
      } else if (status === "checking") {
        // Khi checking ngầm lúc mở app: giữ banner ẩn hoàn toàn
        hideBanner();
      }
    });
  }

  // Nút kiểm tra cập nhật thủ công cạnh link tải file mẫu
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener("click", async () => {
      if (btnCheckUpdate.classList.contains("checking")) return;
      isManualCheck = true;
      btnCheckUpdate.classList.add("checking");
      if (textCheckUpdate) textCheckUpdate.textContent = "Đang kiểm tra…";

      try {
        if (window.api?.kiemTraCapNhat) {
          const res = await window.api.kiemTraCapNhat();
          if (res && res.ok === false) {
            console.warn("Lỗi kiểm tra cập nhật:", res.error);
            showToast("Chưa thể kiểm tra cập nhật lúc này.", "warning", 3000);
          }
        }
      } catch (err) {
        console.warn("Lỗi kiểm tra cập nhật:", err);
      } finally {
        setTimeout(() => {
          btnCheckUpdate.classList.remove("checking");
          if (textCheckUpdate) textCheckUpdate.textContent = "Kiểm tra cập nhật";
          isManualCheck = false;
        }, 2000);
      }
    });
  }
})();
