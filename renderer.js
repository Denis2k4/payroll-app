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
let portalJobInFlight = false;
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
    overlay.style.display = "flex";

    const cleanup = (result) => {
      pendingConfirm = false;
      overlay.hidden = true;
      overlay.style.display = "none";
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

function formatMaNV(code) {
  if (!code) return "";
  return String(code).trim().replace(/lsf/gi, "LSF");
}

function getPreviewValue(nv, column, sttHienThi) {
  if (column.kind === "index") return String(sttHienThi);
  if (column.kind === "actions") {
    return "";
  }
  const value = nv[column.key];
  if (column.key === "maNV") return formatMaNV(value);
  if (column.kind === "money") return dinhDangTien(value);
  if (column.kind === "number") return dinhDangSo(value);
  return value !== undefined && value !== null ? String(value) : "";
}

// ============================================================
// BƯỚC 1 - ĐỌC FILE EXCEL & NẠP DỮ LIỆU
// ============================================================
async function xuLyDocFileExcel(filePath = null) {
  const thangNamInput = $("thangNam");
  const thangNamVal = thangNamInput?.value?.trim();
  if (!thangNamVal) {
    showToast("⚠ Vui lòng nhập Tháng lương trước khi nạp file Excel!", "warning");
    thangNamInput?.focus();
    thangNamInput?.classList.add("input-error");
    return;
  }
  thangNamInput?.classList.remove("input-error");

  $("btnChonExcel").disabled = true;
  $("trangThai").textContent = "Đang đọc file Excel...";

  let ketQua;
  try {
    if (filePath) {
      ketQua = await window.api.docFileExcelPath(filePath);
    } else {
      ketQua = await window.api.chonFileExcel();
    }
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
    showToast(`Lỗi: ${ketQua.error}`, "error", 4000);
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
  portalHistory.clear();
  emailHistoryPage = 1;
  sortState.key = null;
  previewPage = 1;
  searchState.query = "";
  searchState.boPhan = "";
  searchState.khoi = "";
  searchState.coSo = "";
  searchPdfQuery = "";
  searchEmailQuery = "";
  searchPortalQuery = "";
  portalBoPhanFilter = "";
  portalTrangThaiFilter = "all";
  portalSortState.key = "stt";
  portalSortState.dir = 1;
  searchValidationQuery = "";
  validationMucDoFilter = "all";

  if ($("oTimKiem")) $("oTimKiem").value = "";
  if ($("oTimKiemPdf")) $("oTimKiemPdf").value = "";
  if ($("oTimKiemEmail")) $("oTimKiemEmail").value = "";
  if ($("oTimKiemPortal")) $("oTimKiemPortal").value = "";
  if ($("oTimKiemValidation")) $("oTimKiemValidation").value = "";
  if ($("locBoPhan")) $("locBoPhan").value = "";
  if ($("locKhoi")) $("locKhoi").value = "";
  if ($("locCoSo")) $("locCoSo").value = "";
  if ($("locBoPhanPortal")) $("locBoPhanPortal").value = "";
  if ($("locTrangThaiPortal")) $("locTrangThaiPortal").value = "all";
  if ($("locMucDoValidation")) $("locMucDoValidation").value = "all";

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
      `Kiểm tra dữ liệu phát hiện ${validationResult.totalErrors} lỗi và ${validationResult.totalWarnings} cảnh báo.`,
    );
  }
  $("trangThai").textContent = trangThaiParts.join("\n");

  populateFilterOptions();
  renderPreviewTable();
  renderValidationPanel();
  renderPdfEmployeeTable();
  renderDashboard();
  renderEmailHistoryTable();
  renderPortalEmployeeTable();
  syncAllCheckboxes();

  if (danhSachNhanVien.length > 0) {
    $("mainNavbar").hidden = false;
    $("heroQuickStats").hidden = false;
    switchTab("preview");
    showToast(`✓ Đã nạp thành công ${danhSachNhanVien.length} nhân viên. Đã chuyển sang xem trước!`, "success");
  } else {
    $("mainNavbar").hidden = true;
    $("heroQuickStats").hidden = true;
    switchTab("home");
  }
}

$("btnChonExcel").addEventListener("click", async () => {
  await xuLyDocFileExcel();
});

// Hỗ trợ kéo thả file Excel vào khu vực dropzone
const dropzoneArea = $("dropzoneArea");
if (dropzoneArea) {
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzoneArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneArea.classList.add("dragover", "drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzoneArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneArea.classList.remove("dragover", "drag-over");
    });
  });

  dropzoneArea.addEventListener("click", (e) => {
    if (e.target.closest("#btnChonExcel")) return;
    xuLyDocFileExcel();
  });

  dropzoneArea.addEventListener("drop", async (e) => {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    const file = files[0];
    const filePath = window.api?.getPathForFile ? window.api.getPathForFile(file) : file.path;
    if (!filePath) {
      showToast("Không lấy được đường dẫn file.", "error");
      return;
    }
    await xuLyDocFileExcel(filePath);
  });
}

window.addEventListener("dragover", (e) => e.preventDefault(), false);
window.addEventListener("drop", (e) => e.preventDefault(), false);

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
      portalSupabaseUrl: $("portalSupabaseUrl")?.value || "",
      portalServiceRoleKey: $("portalServiceRoleKey")?.value || "",
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
  "portalSupabaseUrl",
  "portalServiceRoleKey",
].forEach((id) => {
  $(id)?.addEventListener("input", () => {
    luuCauHinhNeuBat();
    if (id === "portalSupabaseUrl" || id === "portalServiceRoleKey") {
      capNhatTrangThaiNutPortal();
    }
  });
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
  if (cauHinh.portalSupabaseUrl && $("portalSupabaseUrl"))
    $("portalSupabaseUrl").value = cauHinh.portalSupabaseUrl;
  if (cauHinh.portalServiceRoleKey && $("portalServiceRoleKey"))
    $("portalServiceRoleKey").value = cauHinh.portalServiceRoleKey;

  if (cauHinh.logoDataUri) {
    $("tenFileLogo").textContent =
      `Đã chọn: ${cauHinh.logoFileName || "logo đã lưu"}`;
    $("logoPreviewImg").src = cauHinh.logoDataUri;
    $("logoPreviewWrap").hidden = false;
    $("btnXoaLogo").hidden = false;
  }

  hienThongBaoGhiNho("Đã tải cấu hình đã lưu từ lần trước.");
  capNhatTrangThaiNutXuat();
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
  fillSelect($("locBoPhanPdf"), boPhanSet, "Tất cả bộ phận");
  fillSelect($("locBoPhanEmail"), boPhanSet, "Tất cả bộ phận");
  fillSelect($("locBoPhanPortal"), boPhanSet, "Tất cả bộ phận");
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
    syncAllCheckboxes();
  });

  tbody.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".row-chk");
    if (!checkbox) return;

    const index = Number(checkbox.dataset.index);
    if (checkbox.checked) selectedIndexes.add(index);
    else selectedIndexes.delete(index);
    syncAllCheckboxes();
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
// TRANG KIỂM TRA DỮ LIỆU TỰ ĐỘNG
// ============================================================
let searchValidationQuery = "";
let validationMucDoFilter = "all"; // 'all', 'error', 'warning'

function renderValidationPanel() {
  const tbody = $("bangKiemTraBody");
  const cleanBanner = $("cleanBanner");
  const badge = $("navValidationBadge");

  // Cập nhật huy hiệu trên thanh navbar
  if (badge) {
    if (!validationResult || validationResult.totalRows === 0) {
      badge.hidden = true;
    } else if (validationResult.isClean) {
      badge.textContent = "✓";
      badge.className = "tab-badge ok";
      badge.hidden = false;
      badge.title = "Dữ liệu hợp lệ, không có lỗi";
    } else {
      const errors = validationResult.rowsWithErrorsCount || validationResult.totalErrors || 0;
      const warnings = validationResult.rowsWithWarningsCount || validationResult.totalWarnings || 0;
      if (errors > 0) {
        badge.textContent = errors.toString();
        badge.className = "tab-badge error";
        badge.hidden = false;
        badge.title = `${errors} dòng phát hiện lỗi`;
      } else if (warnings > 0) {
        badge.textContent = warnings.toString();
        badge.className = "tab-badge warning";
        badge.hidden = false;
        badge.title = `${warnings} dòng có cảnh báo`;
      } else {
        badge.hidden = true;
      }
    }
  }

  if (!tbody) return;

  if (!validationResult) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">Chưa có dữ liệu kiểm tra. Vui lòng nạp file Excel trước.</td></tr>`;
    if (cleanBanner) cleanBanner.hidden = true;
    if ($("vTongDong")) $("vTongDong").textContent = "0";
    if ($("vSoDongLoi")) $("vSoDongLoi").textContent = "0";
    if ($("vSoDongCanhBao")) $("vSoDongCanhBao").textContent = "0";
    if ($("vTongLoi")) $("vTongLoi").textContent = "0 / 0";
    return;
  }

  if ($("vTongDong")) $("vTongDong").textContent = validationResult.totalRows.toString();
  if ($("vSoDongLoi")) $("vSoDongLoi").textContent = validationResult.rowsWithErrorsCount.toString();
  if ($("vSoDongCanhBao")) $("vSoDongCanhBao").textContent = validationResult.rowsWithWarningsCount.toString();
  if ($("vTongLoi")) $("vTongLoi").textContent = `${validationResult.totalErrors} / ${validationResult.totalWarnings}`;

  if (cleanBanner) cleanBanner.hidden = !validationResult.isClean;

  let rows = (validationResult.rows || []).slice();

  if (searchValidationQuery) {
    const q = boDauTiengViet(searchValidationQuery.toLowerCase());
    rows = rows.filter((r) => {
      const issueMsgs = (r.issues || []).map((it) => it.message).join(" ");
      const text = boDauTiengViet(`${r.stt} ${r.maNV || ""} ${r.hoTen || ""} ${issueMsgs}`).toLowerCase();
      return text.includes(q);
    });
  }

  if (validationMucDoFilter !== "all") {
    rows = rows.filter((r) => {
      const hasError = r.issues && r.issues.some((it) => it.level === "error");
      return validationMucDoFilter === "error" ? hasError : !hasError;
    });
  }

  if (!rows.length) {
    if (validationResult.isClean) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:36px;font-size:13.5px">
        <span style="font-size:26px;display:block;margin-bottom:8px">🎉</span>
        <strong style="color:var(--primary-dark)">Dữ liệu hoàn toàn chuẩn xác!</strong><br/>
        Không phát hiện bất kỳ lỗi hoặc cảnh báo định dạng nào trong file Excel này.
      </td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">Không tìm thấy dòng nào phù hợp với bộ lọc tìm kiếm.</td></tr>`;
    }
    return;
  }

  tbody.innerHTML = rows
    .sort((a, b) => a.stt - b.stt)
    .map((r) => {
      const hasError = r.issues.some((it) => it.level === "error");
      const badges = r.issues
        .map((it) => `<span class="badge ${it.level}">${it.message}</span>`)
        .join("");
      return `<tr class="${hasError ? "has-error" : "has-warning"}">
        <td style="text-align:center;font-weight:600;color:var(--text-muted)">${r.stt}</td>
        <td><strong style="color:var(--primary-dark)">${r.maNV || "—"}</strong></td>
        <td><strong>${r.hoTen || "—"}</strong></td>
        <td class="issues-cell">${badges}</td>
        <td style="text-align:center">
          <button type="button" class="row-action-btn secondary btn-xem-dong-preview" data-row-index="${r.rowIndex}" title="Xem dòng này trên bảng Xem trước">
            Xem dòng 👁️
          </button>
        </td>
      </tr>`;
    })
    .join("");
}

function wireValidationEvents() {
  $("btnChuyenSangXemTruoc")?.addEventListener("click", () => {
    switchTab("preview");
  });

  $("oTimKiemValidation")?.addEventListener("input", (e) => {
    searchValidationQuery = e.target.value.trim();
    renderValidationPanel();
  });

  $("locMucDoValidation")?.addEventListener("change", (e) => {
    validationMucDoFilter = e.target.value;
    renderValidationPanel();
  });

  $("btnResetLocValidation")?.addEventListener("click", () => {
    if ($("oTimKiemValidation")) $("oTimKiemValidation").value = "";
    if ($("locMucDoValidation")) $("locMucDoValidation").value = "all";
    searchValidationQuery = "";
    validationMucDoFilter = "all";
    renderValidationPanel();
  });

  $("bangKiemTraBody")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-xem-dong-preview");
    if (!btn) return;
    const rowIndex = Number(btn.dataset.rowIndex);
    const nv = danhSachNhanVien[rowIndex];
    if (nv) {
      searchState.query = nv.maNV || nv.hoTen || "";
      if ($("oTimKiem")) $("oTimKiem").value = searchState.query;
      searchState.boPhan = "";
      searchState.khoi = "";
      searchState.coSo = "";
      if ($("locBoPhan")) $("locBoPhan").value = "";
      if ($("locKhoi")) $("locKhoi").value = "";
      if ($("locCoSo")) $("locCoSo").value = "";
      previewPage = 1;
    }
    switchTab("preview");
  });
}

// ============================================================
// BẢNG NHÂN VIÊN XUẤT PDF (TRANG 2)
// ============================================================
let searchPdfQuery = "";
let pdfBoPhanFilter = "";
let pdfTrangThaiFilter = "all"; // 'all', 'da_xuat', 'chua_xuat'
const pdfSortState = { key: "stt", dir: 1 };

function getFilteredPdfIndexes() {
  if (!danhSachNhanVien.length) return [];
  let indexes = danhSachNhanVien.map((_, i) => i);

  if (searchPdfQuery) {
    const q = boDauTiengViet(searchPdfQuery.toLowerCase());
    indexes = indexes.filter((i) => (searchableEmployeeTexts[i] || "").includes(q));
  }
  if (pdfBoPhanFilter) {
    indexes = indexes.filter((i) => danhSachNhanVien[i].boPhan === pdfBoPhanFilter);
  }
  if (pdfTrangThaiFilter !== "all") {
    indexes = indexes.filter((i) => {
      const daXuat = pdfExportedIndexes.has(i);
      return pdfTrangThaiFilter === "da_xuat" ? daXuat : !daXuat;
    });
  }

  // Sắp xếp
  if (pdfSortState.key) {
    const { key, dir } = pdfSortState;
    indexes.sort((a, b) => {
      const nva = danhSachNhanVien[a];
      const nvb = danhSachNhanVien[b];
      if (key === "stt") return (a - b) * dir;
      if (key === "thucNhan") return (Number(nva.thucNhan || 0) - Number(nvb.thucNhan || 0)) * dir;
      if (key === "daXuat") {
        const va = pdfExportedIndexes.has(a) ? 1 : 0;
        const vb = pdfExportedIndexes.has(b) ? 1 : 0;
        return (va - vb) * dir;
      }
      const va = String(nva[key] || "");
      const vb = String(nvb[key] || "");
      return va.localeCompare(vb, "vi") * dir;
    });
  }

  return indexes;
}

function renderPdfEmployeeTable() {
  const tbody = $("bangNhanVienPdfBody");
  if (!tbody) return;

  const indexes = getFilteredPdfIndexes();
  const lblCount = $("soLuongLocPdfLabel");
  if (lblCount) {
    lblCount.textContent = `${indexes.length} / ${danhSachNhanVien.length} nhân viên`;
  }

  // Cập nhật mũi tên sắp xếp trên thead
  const thead = $("bangPdfTable")?.querySelector("thead");
  if (thead) {
    thead.querySelectorAll("th.sortable").forEach((th) => {
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) {
        arrow.textContent = pdfSortState.key === th.dataset.sortKey ? (pdfSortState.dir === 1 ? "▲" : "▼") : "";
      }
    });
  }

  if (!indexes.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Không tìm thấy nhân viên phù hợp bộ lọc.</td></tr>`;
    return;
  }

  const rows = indexes.map((index, stt) => {
    const nv = danhSachNhanVien[index];
    const isChecked = selectedIndexes.has(index);
    const daXuat = pdfExportedIndexes.has(index);

    return `<tr>
      <td class="chk-col"><input type="checkbox" class="row-chk-pdf" data-index="${index}" ${isChecked ? "checked" : ""}></td>
      <td>${stt + 1}</td>
      <td><span class="code-pill">${formatMaNV(nv.maNV) || "—"}</span></td>
      <td><strong>${nv.hoTen || "—"}</strong></td>
      <td>${nv.boPhan || "—"}</td>
      <td style="text-align:right;font-weight:600;color:var(--text)">${dinhDangTien(nv.thucNhan)}</td>
      <td style="text-align:center">${daXuat ? '<span class="badge ok">✓ Đã xuất</span>' : '<span class="badge" style="background:var(--card-bg);border:1px solid var(--border)">Chưa xuất</span>'}</td>
      <td style="text-align:center">
        <button class="row-action-btn secondary preview-btn" data-preview-index="${index}" type="button">Xem thử</button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = rows.join("");
}

function wirePdfTableEvents() {
  const tbody = $("bangNhanVienPdfBody");
  const chkAll = $("chkAllPdf");
  const searchInput = $("oTimKiemPdf");
  const locBoPhan = $("locBoPhanPdf");
  const locTrangThai = $("locTrangThaiPdf");
  const btnReset = $("btnResetLocPdf");

  // Sắp xếp khi click tiêu đề cột
  $("bangPdfTable")?.querySelector("thead")?.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.sortKey;
    if (pdfSortState.key === key) {
      pdfSortState.dir *= -1;
    } else {
      pdfSortState.key = key;
      pdfSortState.dir = 1;
    }
    renderPdfEmployeeTable();
  });

  chkAll?.addEventListener("change", (e) => {
    const filtered = getFilteredPdfIndexes();
    if (e.target.checked) {
      filtered.forEach((i) => selectedIndexes.add(i));
    } else {
      filtered.forEach((i) => selectedIndexes.delete(i));
    }
    syncAllCheckboxes();
  });

  tbody?.addEventListener("change", (e) => {
    const cb = e.target.closest(".row-chk-pdf");
    if (!cb) return;
    const idx = Number(cb.dataset.index);
    if (cb.checked) selectedIndexes.add(idx);
    else selectedIndexes.delete(idx);
    syncAllCheckboxes();
  });

  tbody?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".preview-btn");
    if (!btn || !tbody.contains(btn)) return;
    const idx = Number(btn.dataset.previewIndex);
    const nv = danhSachNhanVien[idx];
    if (!nv) return;
    try {
      btn.disabled = true;
      btn.textContent = "Đang mở…";
      await window.api.xemTruocPdf({
        nhanVien: nv,
        tenCongTy: $("tenCongTy").value,
        thangNam: $("thangNam").value,
      });
    } catch (err) {
      showToast(`Không thể xem trước PDF: ${err.message || err}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Xem thử";
    }
  });

  searchInput?.addEventListener("input", (e) => {
    searchPdfQuery = e.target.value.trim();
    renderPdfEmployeeTable();
    syncAllCheckboxes();
  });

  locBoPhan?.addEventListener("change", (e) => {
    pdfBoPhanFilter = e.target.value;
    renderPdfEmployeeTable();
    syncAllCheckboxes();
  });

  locTrangThai?.addEventListener("change", (e) => {
    pdfTrangThaiFilter = e.target.value;
    renderPdfEmployeeTable();
    syncAllCheckboxes();
  });

  btnReset?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (locBoPhan) locBoPhan.value = "";
    if (locTrangThai) locTrangThai.value = "all";
    searchPdfQuery = "";
    pdfBoPhanFilter = "";
    pdfTrangThaiFilter = "all";
    pdfSortState.key = "stt";
    pdfSortState.dir = 1;
    renderPdfEmployeeTable();
    syncAllCheckboxes();
  });
}

// ============================================================
// BẢNG NHÂN VIÊN GỬI EMAIL (TRANG 3)
// ============================================================
const trangThaiGuiEmailLabel = {
  sending: "Đang gửi...",
  sent: "✓ Đã gửi",
  error: "✕ Lỗi",
};

let searchEmailQuery = "";
let emailBoPhanFilter = "";
let emailTrangThaiFilter = "all"; // 'all', 'sent', 'pending', 'error', 'has_email', 'no_email'
const emailSortState = { key: "maNV", dir: 1 };

function getFilteredEmailIndexes() {
  if (!danhSachNhanVien.length) return [];
  let indexes = danhSachNhanVien.map((_, i) => i);

  if (searchEmailQuery) {
    const q = boDauTiengViet(searchEmailQuery.toLowerCase());
    indexes = indexes.filter((i) => {
      const nv = danhSachNhanVien[i];
      const text = `${searchableEmployeeTexts[i] || ""} ${boDauTiengViet(nv.email || "")}`.toLowerCase();
      return text.includes(q);
    });
  }
  if (emailBoPhanFilter) {
    indexes = indexes.filter((i) => danhSachNhanVien[i].boPhan === emailBoPhanFilter);
  }
  if (emailTrangThaiFilter !== "all") {
    indexes = indexes.filter((i) => {
      const nv = danhSachNhanVien[i];
      const su = emailHistory.get(i);
      const st = su ? su.status : "pending";
      if (emailTrangThaiFilter === "has_email") return Boolean(nv.email);
      if (emailTrangThaiFilter === "no_email") return !nv.email;
      return st === emailTrangThaiFilter;
    });
  }

  // Sắp xếp
  if (emailSortState.key) {
    const { key, dir } = emailSortState;
    indexes.sort((a, b) => {
      const nva = danhSachNhanVien[a];
      const nvb = danhSachNhanVien[b];
      if (key === "time") {
        const ta = emailHistory.get(a)?.time ? new Date(emailHistory.get(a).time).getTime() : 0;
        const tb = emailHistory.get(b)?.time ? new Date(emailHistory.get(b).time).getTime() : 0;
        return (ta - tb) * dir;
      }
      if (key === "trangThai") {
        const sa = emailHistory.get(a)?.status || "pending";
        const sb = emailHistory.get(b)?.status || "pending";
        return sa.localeCompare(sb) * dir;
      }
      const va = String(nva[key] || "");
      const vb = String(nvb[key] || "");
      return va.localeCompare(vb, "vi") * dir;
    });
  }

  return indexes;
}

function renderEmailHistoryTable() {
  const tbody = $("bangDaChonBody");
  if (!tbody) return;

  const indexes = getFilteredEmailIndexes();

  // Cập nhật mũi tên sắp xếp trên thead
  const thead = $("bangEmailTable")?.querySelector("thead");
  if (thead) {
    thead.querySelectorAll("th.sortable").forEach((th) => {
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) {
        arrow.textContent = emailSortState.key === th.dataset.sortKey ? (emailSortState.dir === 1 ? "▲" : "▼") : "";
      }
    });
  }

  if (!indexes.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Không tìm thấy nhân viên phù hợp bộ lọc.</td></tr>`;
    if ($("emailHistoryPagination")) $("emailHistoryPagination").hidden = true;
    return;
  }

  const rows = indexes.map((index) => {
    const nv = danhSachNhanVien[index];
    const isChecked = selectedIndexes.has(index);
    const su = emailHistory.get(index);
    const trangThai = su
      ? `<span class="badge ${su.status === "error" ? "error" : su.status === "sending" ? "warning" : "ok"}">${trangThaiGuiEmailLabel[su.status] || ""}</span>${su.status === "error" && su.error ? `<div class="muted small">${su.error}</div>` : ""}`
      : `<span class="badge" style="background:var(--card-bg);border:1px solid var(--border)">Chưa gửi</span>`;
    const thoiGian = su && su.time ? (su.time instanceof Date ? su.time.toLocaleTimeString("vi-VN") : String(su.time)) : "—";
    const coEmail = Boolean(nv.email);

    return `<tr>
      <td class="chk-col"><input type="checkbox" class="row-chk-email" data-index="${index}" ${isChecked ? "checked" : ""}></td>
      <td><span class="code-pill">${formatMaNV(nv.maNV) || "—"}</span></td>
      <td><strong>${nv.hoTen || "—"}</strong></td>
      <td>${nv.boPhan || "—"}</td>
      <td>${nv.email || '<span class="muted">(chưa có email)</span>'}</td>
      <td style="text-align:center">${trangThai}</td>
      <td style="font-size:12px;color:var(--text-muted)">${thoiGian}</td>
      <td style="text-align:center">
        <button class="row-action-btn tertiary" data-gui-lai-index="${index}" ${coEmail ? "" : "disabled"} type="button">
          ${su && su.status === "sent" ? "Gửi lại" : "Gửi lẻ"}
        </button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = rows.join("");
  if ($("emailHistoryPagination")) $("emailHistoryPagination").hidden = true;
}

function wireEmailHistoryEvents() {
  const tbody = $("bangDaChonBody");
  const chkAll = $("chkAllEmail");
  const searchInput = $("oTimKiemEmail");
  const locBoPhan = $("locBoPhanEmail");
  const locTrangThai = $("locTrangThaiEmail");
  const btnReset = $("btnResetLocEmail");

  // Sắp xếp khi click tiêu đề cột
  $("bangEmailTable")?.querySelector("thead")?.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.sortKey;
    if (emailSortState.key === key) {
      emailSortState.dir *= -1;
    } else {
      emailSortState.key = key;
      emailSortState.dir = 1;
    }
    renderEmailHistoryTable();
  });

  chkAll?.addEventListener("change", (e) => {
    const filtered = getFilteredEmailIndexes();
    if (e.target.checked) {
      filtered.forEach((i) => selectedIndexes.add(i));
    } else {
      filtered.forEach((i) => selectedIndexes.delete(i));
    }
    syncAllCheckboxes();
  });

  tbody?.addEventListener("change", (e) => {
    const cb = e.target.closest(".row-chk-email");
    if (!cb) return;
    const idx = Number(cb.dataset.index);
    if (cb.checked) selectedIndexes.add(idx);
    else selectedIndexes.delete(idx);
    syncAllCheckboxes();
  });

  tbody?.addEventListener("click", async (event) => {
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

  searchInput?.addEventListener("input", (e) => {
    searchEmailQuery = e.target.value.trim();
    renderEmailHistoryTable();
    syncAllCheckboxes();
  });

  locBoPhan?.addEventListener("change", (e) => {
    emailBoPhanFilter = e.target.value;
    renderEmailHistoryTable();
    syncAllCheckboxes();
  });

  locTrangThai?.addEventListener("change", (e) => {
    emailTrangThaiFilter = e.target.value;
    renderEmailHistoryTable();
    syncAllCheckboxes();
  });

  btnReset?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (locBoPhan) locBoPhan.value = "";
    if (locTrangThai) locTrangThai.value = "all";
    searchEmailQuery = "";
    emailBoPhanFilter = "";
    emailTrangThaiFilter = "all";
    emailSortState.key = "maNV";
    emailSortState.dir = 1;
    renderEmailHistoryTable();
    syncAllCheckboxes();
  });
}

// ============================================================
// BẢNG NHÂN VIÊN UPLOAD PORTAL (TRANG 4)
// ============================================================
const portalTrangThaiLabel = {
  uploading: "Đang upload...",
  uploaded: "✓ Đã upload",
  error: "✕ Lỗi",
};

const portalHistory = new Map();
let searchPortalQuery = "";
let portalBoPhanFilter = "";
let portalTrangThaiFilter = "all"; // 'all', 'uploaded', 'pending', 'error'
const portalSortState = { key: "stt", dir: 1 };

function getFilteredPortalIndexes() {
  if (!danhSachNhanVien.length) return [];
  let indexes = danhSachNhanVien.map((_, i) => i);

  if (searchPortalQuery) {
    const q = boDauTiengViet(searchPortalQuery.toLowerCase());
    indexes = indexes.filter((i) => {
      const nv = danhSachNhanVien[i];
      const portalAccount = `${(nv.maNV || "").trim().toLowerCase()}@hehehr.internal`;
      const text = `${searchableEmployeeTexts[i] || ""} ${boDauTiengViet(portalAccount)}`.toLowerCase();
      return text.includes(q);
    });
  }

  if (portalBoPhanFilter) {
    indexes = indexes.filter((i) => danhSachNhanVien[i].boPhan === portalBoPhanFilter);
  }

  if (portalTrangThaiFilter !== "all") {
    indexes = indexes.filter((i) => {
      const hist = portalHistory.get(i);
      const st = hist ? hist.status : "pending";
      return st === portalTrangThaiFilter;
    });
  }

  if (portalSortState.key) {
    const { key, dir } = portalSortState;
    indexes.sort((a, b) => {
      if (key === "stt") {
        return (a - b) * dir;
      }
      if (key === "trangThai") {
        const sa = portalHistory.get(a)?.status || "pending";
        const sb = portalHistory.get(b)?.status || "pending";
        return sa.localeCompare(sb) * dir;
      }
      if (key === "portalAccount") {
        const pa = `${(danhSachNhanVien[a].maNV || "").trim().toLowerCase()}@hehehr.internal`;
        const pb = `${(danhSachNhanVien[b].maNV || "").trim().toLowerCase()}@hehehr.internal`;
        return pa.localeCompare(pb) * dir;
      }
      const va = String(danhSachNhanVien[a][key] || "");
      const vb = String(danhSachNhanVien[b][key] || "");
      return va.localeCompare(vb, "vi") * dir;
    });
  }

  return indexes;
}

function renderPortalEmployeeTable() {
  const tbody = $("bangNhanVienPortalBody");
  if (!tbody) return;

  const indexes = getFilteredPortalIndexes();

  // Cập nhật mũi tên sắp xếp trên thead
  const thead = $("bangPortalTable")?.querySelector("thead");
  if (thead) {
    thead.querySelectorAll("th.sortable").forEach((th) => {
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) {
        arrow.textContent = portalSortState.key === th.dataset.sortKey ? (portalSortState.dir === 1 ? "▲" : "▼") : "";
      }
    });
  }

  const lblSub = $("soLuongLocPortalLabel");
  if (lblSub) {
    if (danhSachNhanVien.length) {
      lblSub.textContent = `Hiển thị ${indexes.length}/${danhSachNhanVien.length} nhân viên`;
    } else {
      lblSub.textContent = "Tích chọn nhân viên cần upload lên web";
    }
  }

  if (!indexes.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Không tìm thấy nhân viên phù hợp bộ lọc.</td></tr>`;
    return;
  }

  const rows = indexes.map((index, stt) => {
    const nv = danhSachNhanVien[index];
    const isChecked = selectedIndexes.has(index);
    const portalAccount = `${(nv.maNV || "").trim().toLowerCase()}@hehehr.internal`;
    const hist = portalHistory.get(index);
    const trangThai = hist
      ? `<span class="badge ${hist.status === "error" ? "error" : hist.status === "uploading" ? "warning" : "ok"}">${portalTrangThaiLabel[hist.status] || ""}</span>${hist.status === "error" && hist.error ? `<div class="muted small">${hist.error}</div>` : ""}`
      : `<span class="badge" style="background:var(--card-bg);border:1px solid var(--border)">Chưa upload</span>`;

    return `<tr>
      <td class="chk-col"><input type="checkbox" class="row-chk-portal" data-index="${index}" ${isChecked ? "checked" : ""}></td>
      <td style="text-align:center;color:var(--text-muted)">${stt + 1}</td>
      <td><span class="code-pill">${formatMaNV(nv.maNV) || "—"}</span></td>
      <td><strong>${nv.hoTen || "—"}</strong></td>
      <td>${nv.boPhan || "—"}</td>
      <td><code class="code-pill">${portalAccount}</code></td>
      <td style="text-align:center">${trangThai}</td>
      <td style="text-align:center">
        <button class="row-action-btn tertiary upload-portal-one-btn" data-upload-portal-index="${index}" type="button">
          ${hist && hist.status === "uploaded" ? "Upload lại" : "Upload lẻ"}
        </button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = rows.join("");
}

function wirePortalTableEvents() {
  const tbody = $("bangNhanVienPortalBody");
  const chkAll = $("chkAllPortal");
  const searchInput = $("oTimKiemPortal");
  const locBoPhan = $("locBoPhanPortal");
  const locTrangThai = $("locTrangThaiPortal");
  const btnReset = $("btnResetLocPortal");

  // Sắp xếp khi click tiêu đề cột
  $("bangPortalTable")?.querySelector("thead")?.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.sortKey;
    if (portalSortState.key === key) {
      portalSortState.dir *= -1;
    } else {
      portalSortState.key = key;
      portalSortState.dir = 1;
    }
    renderPortalEmployeeTable();
  });

  chkAll?.addEventListener("change", (e) => {
    const filtered = getFilteredPortalIndexes();
    if (e.target.checked) {
      filtered.forEach((i) => selectedIndexes.add(i));
    } else {
      filtered.forEach((i) => selectedIndexes.delete(i));
    }
    syncAllCheckboxes();
  });

  tbody?.addEventListener("change", (e) => {
    const cb = e.target.closest(".row-chk-portal");
    if (!cb) return;
    const idx = Number(cb.dataset.index);
    if (cb.checked) selectedIndexes.add(idx);
    else selectedIndexes.delete(idx);
    syncAllCheckboxes();
  });

  tbody?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".upload-portal-one-btn");
    if (!btn || !tbody.contains(btn)) return;
    const idx = Number(btn.dataset.uploadPortalIndex);
    const nv = danhSachNhanVien[idx];
    if (!nv) return;

    const xacNhan = await showConfirmModal({
      title: "Xác nhận Upload Portal",
      message: `Upload phiếu lương của "${nv.hoTen || nv.maNV}" lên Web Portal?`,
      confirmLabel: "Upload",
    });
    if (!xacNhan) return;
    await uploadPortalChoDanhSach([idx]);
  });

  searchInput?.addEventListener("input", (e) => {
    searchPortalQuery = e.target.value.trim();
    renderPortalEmployeeTable();
    syncAllCheckboxes();
  });

  locBoPhan?.addEventListener("change", (e) => {
    portalBoPhanFilter = e.target.value;
    renderPortalEmployeeTable();
    syncAllCheckboxes();
  });

  locTrangThai?.addEventListener("change", (e) => {
    portalTrangThaiFilter = e.target.value;
    renderPortalEmployeeTable();
    syncAllCheckboxes();
  });

  btnReset?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (locBoPhan) locBoPhan.value = "";
    if (locTrangThai) locTrangThai.value = "all";
    searchPortalQuery = "";
    portalBoPhanFilter = "";
    portalTrangThaiFilter = "all";
    portalSortState.key = "stt";
    portalSortState.dir = 1;
    renderPortalEmployeeTable();
    syncAllCheckboxes();
  });
}

// ============================================================
// ĐỒNG BỘ TRẠNG THÁI CHECKBOX TRÊN TẤT CẢ CÁC TRANG & HEADER
// ============================================================
function syncAllCheckboxes() {
  renderSelectionSummary();
  capNhatTrangThaiNutXuat();

  // Đồng bộ tất cả checkbox nhân viên
  document
    .querySelectorAll(".row-chk, .row-chk-pdf, .row-chk-email, .row-chk-portal")
    .forEach((cb) => {
      const idx = Number(cb.dataset.index);
      cb.checked = selectedIndexes.has(idx);
    });

  // Đồng bộ header checkbox Xem trước
  updateHeadCheckboxState(visiblePreviewIndexes);

  // Đồng bộ header checkbox PDF
  const chkAllPdf = $("chkAllPdf");
  if (chkAllPdf) {
    const filteredPdf = getFilteredPdfIndexes();
    if (!filteredPdf.length) {
      chkAllPdf.checked = false;
      chkAllPdf.indeterminate = false;
    } else {
      const allChecked = filteredPdf.every((i) => selectedIndexes.has(i));
      const someChecked = filteredPdf.some((i) => selectedIndexes.has(i));
      chkAllPdf.checked = allChecked;
      chkAllPdf.indeterminate = !allChecked && someChecked;
    }
  }

  // Đồng bộ header checkbox Email
  const chkAllEmail = $("chkAllEmail");
  if (chkAllEmail) {
    const filteredEmail = getFilteredEmailIndexes();
    if (!filteredEmail.length) {
      chkAllEmail.checked = false;
      chkAllEmail.indeterminate = false;
    } else {
      const allChecked = filteredEmail.every((i) => selectedIndexes.has(i));
      const someChecked = filteredEmail.some((i) => selectedIndexes.has(i));
      chkAllEmail.checked = allChecked;
      chkAllEmail.indeterminate = !allChecked && someChecked;
    }
  }

  // Đồng bộ header checkbox Portal
  const chkAllPortal = $("chkAllPortal");
  if (chkAllPortal) {
    const filteredPortal = getFilteredPortalIndexes();
    if (!filteredPortal.length) {
      chkAllPortal.checked = false;
      chkAllPortal.indeterminate = false;
    } else {
      const allChecked = filteredPortal.every((i) => selectedIndexes.has(i));
      const someChecked = filteredPortal.some((i) => selectedIndexes.has(i));
      chkAllPortal.checked = allChecked;
      chkAllPortal.indeterminate = !allChecked && someChecked;
    }
  }
}

// ============================================================
// DASHBOARD TỔNG QUAN (EMAIL & THỐNG KÊ)
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

  if ($("dbTongNhanVien")) $("dbTongNhanVien").textContent = tong.toString();
  if ($("dbDaGui")) $("dbDaGui").textContent = daGui.toString();
  if ($("dbChuaGui")) $("dbChuaGui").textContent = chuaGui.toString();
  if ($("dbLoi")) $("dbLoi").textContent = loi.toString();
  if ($("dbPdfDaTao")) $("dbPdfDaTao").textContent = pdfExportedIndexes.size.toString();
  if ($("dbPhanTram")) $("dbPhanTram").textContent = `${phanTram}%`;
  if ($("dashboardBarFill")) $("dashboardBarFill").style.width = `${phanTram}%`;
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
    pdfJobInFlight || emailJobInFlight || portalJobInFlight || !(danhSachNhanVien.length > 0 && thuMucLuu);
  $("btnXuatChon").disabled =
    pdfJobInFlight || emailJobInFlight || portalJobInFlight || !(selectedIndexes.size > 0 && thuMucLuu);
  capNhatTrangThaiNutGuiEmail();
  capNhatTrangThaiNutPortal();
}

function capNhatTrangThaiNutPortal() {
  const btnChon = $("btnUploadPortalChon");
  const btnTatCa = $("btnUploadPortalTatCa");
  if (!btnChon || !btnTatCa) return;

  const url = $("portalSupabaseUrl")?.value.trim();
  const key = $("portalServiceRoleKey")?.value.trim();
  const coThongTin = Boolean(url && key);

  btnTatCa.disabled =
    portalJobInFlight || pdfJobInFlight || emailJobInFlight || !danhSachNhanVien.length || !coThongTin;
  btnChon.disabled =
    portalJobInFlight || pdfJobInFlight || emailJobInFlight || !selectedIndexes.size || !coThongTin;
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
    renderPdfEmployeeTable();
    syncAllCheckboxes();
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
      "Vui lòng nhập Email người gửi và Mật khẩu ứng dụng trong Cài đặt (⚙️).",
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
// UPLOAD LÊN PORTAL (SUPABASE)
// ============================================================

function hienThanhTienDoPortal(tongSo) {
  const wrap = $("progressWrapPortal");
  if (!wrap) return;
  wrap.hidden = false;
  $("progressBarFillPortal").style.width = "0%";
  $("progressLabelPortal").textContent = `0 / ${tongSo} (0%)`;
  $("portalUploadStatus").textContent = "Đang chuẩn bị upload...";
}

function capNhatThanhTienDoPortal({ daXong, tongSo, maNV, trangThai }) {
  const phanTram = tongSo ? Math.round((daXong / tongSo) * 100) : 0;
  if ($("progressBarFillPortal")) $("progressBarFillPortal").style.width = `${phanTram}%`;
  if ($("progressLabelPortal")) $("progressLabelPortal").textContent = `${daXong} / ${tongSo} (${phanTram}%)`;
  if (maNV && $("portalUploadStatus")) {
    $("portalUploadStatus").textContent =
      trangThai === "uploading"
        ? `Đang đồng bộ phiếu lương cho ${maNV}...`
        : `Đã xử lý: ${maNV}`;
  }
}

function anThanhTienDoPortal() {
  const wrap = $("progressWrapPortal");
  if (!wrap) return;
  wrap.hidden = true;
}

if (window.api && window.api.onUploadPortalTienDo) {
  window.api.onUploadPortalTienDo((data) => {
    capNhatThanhTienDoPortal(data);
  });
}

async function uploadPortalChoDanhSach(indexes) {
  if (!indexes.length || portalJobInFlight || pdfJobInFlight || emailJobInFlight) return;

  const supabaseUrl = $("portalSupabaseUrl")?.value.trim();
  const serviceRoleKey = $("portalServiceRoleKey")?.value.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    showToast("Vui lòng nhập đầy đủ Supabase URL và Service Role Key.", "warning");
    return;
  }

  portalJobInFlight = true;
  capNhatTrangThaiNutXuat();
  indexes.forEach((i) => {
    portalHistory.set(i, { status: "uploading" });
  });
  renderPortalEmployeeTable();
  hienThanhTienDoPortal(indexes.length);

  try {
    const ketQua = await window.api.uploadToPortal({
      supabaseUrl,
      serviceRoleKey,
      selectedIndexes: indexes,
      tenCongTy: $("tenCongTy").value,
      thangNam: $("thangNam").value,
      danhSachNhanVien,
    });

    if (ketQua && ketQua.ok) {
      const results = ketQua.results || [];
      const resMap = new Map();
      results.forEach((r) => {
        if (r.maNV) resMap.set(String(r.maNV).trim().toUpperCase(), r);
      });
      indexes.forEach((i) => {
        const nv = danhSachNhanVien[i];
        const maNV = String(nv.maNV || nv.maNhanVien || "").trim().toUpperCase();
        const r = resMap.get(maNV);
        if (r) {
          portalHistory.set(i, {
            status: r.success ? "uploaded" : "error",
            error: r.error || "",
            time: new Date(),
          });
        }
      });

      const thanhCong = results.filter((r) => r.success).length;
      const thatBai = results.filter((r) => !r.success).length;

      if (thatBai === 0) {
        showToast(`✓ Đã upload thành công ${thanhCong} phiếu lương lên Portal!`, "success");
        if ($("portalUploadStatus")) $("portalUploadStatus").textContent = `✓ Upload hoàn tất: ${thanhCong} thành công.`;
        setTimeout(anThanhTienDoPortal, 3000);
      } else {
        const errorList = results.filter((r) => !r.success);
        const firstErr = errorList[0]?.error || "Lỗi không xác định";
        const fullErr = errorList.map((r) => `${r.maNV || "NV"}: ${r.error}`).join("; ");
        showToast(`Upload: ${thanhCong} thành công, ${thatBai} lỗi. Lỗi: ${firstErr}`, "error", 8000);
        if ($("portalUploadStatus")) $("portalUploadStatus").textContent = `❌ Hoàn tất: ${thanhCong} thành công, ${thatBai} lỗi.\nChi tiết: ${fullErr}`;
      }
    } else {
      const errMsg = (ketQua && (ketQua.error || ketQua.message)) || "Lỗi không xác định";
      indexes.forEach((i) => {
        if (portalHistory.get(i)?.status === "uploading") {
          portalHistory.set(i, {
            status: "error",
            error: errMsg,
            time: new Date(),
          });
        }
      });
      showToast(`Upload thất bại: ${errMsg}`, "error", 8000);
      if ($("portalUploadStatus")) $("portalUploadStatus").textContent = `❌ Lỗi: ${errMsg}`;
    }
  } catch (err) {
    indexes.forEach((i) => {
      if (portalHistory.get(i)?.status === "uploading") {
        portalHistory.set(i, {
          status: "error",
          error: err.message || String(err),
          time: new Date(),
        });
      }
    });
    showToast(`Lỗi upload: ${err.message || err}`, "error", 8000);
    if ($("portalUploadStatus")) $("portalUploadStatus").textContent = `❌ Lỗi: ${err.message || err}`;
  } finally {
    portalJobInFlight = false;
    capNhatTrangThaiNutXuat();
    renderPortalEmployeeTable();
  }
}

$("btnUploadPortalChon")?.addEventListener("click", async () => {
  const indexes = [...selectedIndexes].sort((a, b) => a - b);
  if (!indexes.length) return;
  const xacNhan = await showConfirmModal({
    title: "Xác nhận Upload Portal",
    message: `Upload phiếu lương của ${indexes.length} nhân viên đã chọn lên Portal?`,
    confirmLabel: "Upload",
  });
  if (!xacNhan) return;
  await uploadPortalChoDanhSach(indexes);
});

$("btnUploadPortalTatCa")?.addEventListener("click", async () => {
  if (!danhSachNhanVien.length) return;
  const indexes = danhSachNhanVien.map((_, i) => i);
  const xacNhan = await showConfirmModal({
    title: "Xác nhận Upload Portal",
    message: `Upload phiếu lương của toàn bộ ${indexes.length} nhân viên lên Portal?`,
    confirmLabel: "Upload tất cả",
  });
  if (!xacNhan) return;
  await uploadPortalChoDanhSach(indexes);
});

// ============================================================
// QUẢN LÝ PHIẾU LƯƠNG TRÊN PORTAL (SUPABASE)
// ============================================================
let managePayslips = [];
const selectedManageIds = new Set();
let manageSearchQuery = "";
let manageMonthFilter = "all";
let manageBoPhanFilter = "";
let manageStatusFilter = "all";
let isLoadingManage = false;
const manageSortState = { key: "uploaded_at", dir: -1 };

function layThongTinSupabase() {
  const url = ($("portalSupabaseUrl")?.value || "").trim();
  const key = ($("portalServiceRoleKey")?.value || "").trim();
  return { supabaseUrl: url, serviceRoleKey: key };
}

async function taiDanhSachManage(thangNam = null) {
  const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
  const noConfigBox = $("manageNoConfigWarning");

  if (!supabaseUrl || !serviceRoleKey) {
    if (noConfigBox) {
      noConfigBox.hidden = false;
      noConfigBox.style.display = "block";
    }
    managePayslips = [];
    renderManageTable();
    return;
  }

  if (noConfigBox) {
    noConfigBox.hidden = true;
    noConfigBox.style.display = "none";
  }

  const loadingEl = $("manageLoading");
  const emptyEl = $("manageEmpty");
  if (loadingEl) loadingEl.style.display = "block";
  if (emptyEl) emptyEl.style.display = "none";
  isLoadingManage = true;

  try {
    const ketQua = await window.api.layDanhSachPhieuLuongPortal({
      supabaseUrl,
      serviceRoleKey,
      thangNam: thangNam && thangNam !== "all" ? thangNam : null,
    });

    if (ketQua && ketQua.ok) {
      managePayslips = ketQua.data || [];
      capNhatDropdownThangManage();
      capNhatDropdownBoPhanManage();
      renderManageTable();
    } else {
      showToast(`Không thể tải dữ liệu: ${(ketQua && ketQua.error) || "Lỗi không xác định"}`, "error");
      managePayslips = [];
      renderManageTable();
    }
  } catch (err) {
    showToast(`Lỗi kết nối Supabase: ${err.message || err}`, "error");
    managePayslips = [];
    renderManageTable();
  } finally {
    isLoadingManage = false;
    if (loadingEl) loadingEl.style.display = "none";
  }
}

function capNhatDropdownThangManage() {
  const select = $("locThangManage");
  if (!select) return;
  const currentVal = select.value || "all";
  const months = [...new Set(managePayslips.map((p) => p.thang_nam).filter(Boolean))].sort().reverse();

  let html = '<option value="all">Tất cả các kỳ lương</option>';
  months.forEach((m) => {
    html += `<option value="${m}">Tháng ${m}</option>`;
  });
  select.innerHTML = html;
  if (months.includes(currentVal) || currentVal === "all") {
    select.value = currentVal;
    manageMonthFilter = currentVal;
  } else {
    select.value = "all";
    manageMonthFilter = "all";
  }
}

function capNhatDropdownBoPhanManage() {
  const select = $("locBoPhanManage");
  if (!select) return;
  const currentVal = select.value || "";
  const boPhans = [...new Set(managePayslips.map((p) => p.bo_phan).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));

  let html = '<option value="">Tất cả bộ phận</option>';
  boPhans.forEach((bp) => {
    html += `<option value="${bp}">${bp}</option>`;
  });
  select.innerHTML = html;
  if (boPhans.includes(currentVal) || currentVal === "") {
    select.value = currentVal;
    manageBoPhanFilter = currentVal;
  } else {
    select.value = "";
    manageBoPhanFilter = "";
  }
}

function getFilteredManagePayslips() {
  let list = managePayslips.filter((p) => {
    if (manageMonthFilter !== "all" && p.thang_nam !== manageMonthFilter) return false;
    if (manageBoPhanFilter && p.bo_phan !== manageBoPhanFilter) return false;
    if (manageStatusFilter !== "all") {
      const isRevoked = p.status === "revoked";
      if (manageStatusFilter === "revoked" && !isRevoked) return false;
      if (manageStatusFilter === "active" && isRevoked) return false;
    }
    if (manageSearchQuery) {
      const q = boDauTiengViet(manageSearchQuery.toLowerCase());
      const text = boDauTiengViet(`${p.ma_nv || ""} ${p.ho_ten || ""} ${p.bo_phan || ""} ${p.khoi || ""} ${p.co_so || ""}`).toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  if (manageSortState.key) {
    const { key, dir } = manageSortState;
    list.sort((a, b) => {
      if (key === "stt") {
        return 0;
      }
      if (key === "uploaded_at") {
        const ta = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
        const tb = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
        return (ta - tb) * dir;
      }
      if (key === "status") {
        const sa = a.status || "active";
        const sb = b.status || "active";
        return sa.localeCompare(sb) * dir;
      }
      const va = String(a[key] || "");
      const vb = String(b[key] || "");
      return va.localeCompare(vb, "vi") * dir;
    });
  }

  return list;
}

function formatNgayGioVi(isoStr) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoStr;
  }
}

function renderManageTable() {
  const tbody = $("bangManageBody");
  const emptyEl = $("manageEmpty");
  const totalTong = $("soLuongManageTong");
  const totalTongLabel = $("soLuongManageTongLabel");
  const totalActive = $("soLuongManageActive");
  const totalRevoked = $("soLuongManageRevoked");
  const totalSelected = $("soLuongManageSelected");
  const lblSelected = $("lblSoLuongManageChon");

  const filtered = getFilteredManagePayslips();

  // Cập nhật mũi tên sắp xếp trên thead
  const thead = $("bangManageTable")?.querySelector("thead");
  if (thead) {
    thead.querySelectorAll("th.sortable").forEach((th) => {
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) {
        arrow.textContent = manageSortState.key === th.dataset.sortKey ? (manageSortState.dir === 1 ? "▲" : "▼") : "";
      }
    });
  }

  // Đồng bộ giá trị dropdown sắp xếp nhanh
  const selectSort = $("locSapXepManage");
  if (selectSort) {
    const curVal = `${manageSortState.key}_${manageSortState.dir === 1 ? "asc" : "desc"}`;
    if ([...selectSort.options].some((opt) => opt.value === curVal)) {
      selectSort.value = curVal;
    }
  }

  // Cập nhật số liệu KPI
  const countActive = managePayslips.filter((p) => p.status !== "revoked").length;
  const countRevoked = managePayslips.filter((p) => p.status === "revoked").length;

  if (totalTong) totalTong.textContent = managePayslips.length;
  if (totalTongLabel) totalTongLabel.textContent = `${managePayslips.length} phiếu`;
  if (totalActive) totalActive.textContent = countActive;
  if (totalRevoked) totalRevoked.textContent = countRevoked;
  if (totalSelected) totalSelected.textContent = selectedManageIds.size;
  if (lblSelected) lblSelected.textContent = selectedManageIds.size;

  const btnThuHoi = $("btnThuHoiChon");
  const btnKhoiPhuc = $("btnKhoiPhucChon");
  const btnXoa = $("btnXoaChonManage");
  const hasSelected = selectedManageIds.size > 0;
  if (btnThuHoi) btnThuHoi.disabled = !hasSelected;
  if (btnKhoiPhuc) btnKhoiPhuc.disabled = !hasSelected;
  if (btnXoa) btnXoa.disabled = !hasSelected;

  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = "";
    if (emptyEl && !isLoadingManage) {
      emptyEl.style.display = "block";
      const emptyMsg = $("manageEmptyMsg");
      if (emptyMsg) {
        emptyMsg.textContent = managePayslips.length === 0
          ? "Chưa có phiếu lương nào trên Supabase. Hãy upload phiếu lương từ tab 'Upload lên Web'."
          : "Không có phiếu lương nào khớp với bộ lọc tìm kiếm hiện tại.";
      }
    }
    const chkAll = $("chkManageChonTatCa");
    if (chkAll) {
      chkAll.checked = false;
      chkAll.indeterminate = false;
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  let html = "";
  filtered.forEach((p, idx) => {
    const isChecked = selectedManageIds.has(p.id);
    const isRevoked = p.status === "revoked";
    const statusBadge = isRevoked
      ? '<span class="badge error">🔴 Đã thu hồi</span>'
      : '<span class="badge ok">🟢 Đang phát hành</span>';

    const actionButtons = `
      <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
        <button type="button" class="table-btn-mini primary btn-xem-pdf-manage" data-path="${p.pdf_path || ""}" data-manv="${p.ma_nv}" title="Xem trước file PDF online">
          👁️ Xem PDF
        </button>
        ${
          isRevoked
            ? `<button type="button" class="table-btn-mini primary btn-khoi-phuc-mot" data-id="${p.id}" data-manv="${p.ma_nv}" title="Phát hành lại phiếu này để nhân viên xem được trên Web">
                🔄 Phát hành
              </button>`
            : `<button type="button" class="table-btn-mini warning btn-thu-hoi-mot" data-id="${p.id}" data-manv="${p.ma_nv}" title="Thu hồi phiếu (tạm ẩn khỏi Portal nhân viên)">
                🚫 Thu hồi
              </button>`
        }
        <button type="button" class="table-btn-mini danger btn-xoa-mot" data-id="${p.id}" data-path="${p.pdf_path || ""}" data-manv="${p.ma_nv}" title="Xóa vĩnh viễn phiếu lương này">
          🗑️ Xóa
        </button>
      </div>
    `;

    html += `
      <tr class="${isChecked ? "row-selected" : ""} ${isRevoked ? "row-revoked" : ""}">
        <td style="text-align:center;">
          <input type="checkbox" class="chk-manage-item" data-id="${p.id}" ${isChecked ? "checked" : ""} />
        </td>
        <td style="text-align:center;color:var(--text-muted);font-weight:600">${idx + 1}</td>
        <td><strong style="color:var(--primary-dark)">${p.ma_nv}</strong></td>
        <td><strong>${p.ho_ten || p.ma_nv}</strong></td>
        <td>${p.bo_phan || "-"}</td>
        <td style="text-align:center;"><span class="code-pill">${p.thang_nam}</span></td>
        <td style="font-size:12px;color:var(--text-muted)">${formatNgayGioVi(p.uploaded_at)}</td>
        <td style="text-align:center;">${statusBadge}</td>
        <td style="text-align:center;">${actionButtons}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  // Cập nhật trạng thái checkbox chọn tất cả
  const chkAll = $("chkManageChonTatCa");
  if (chkAll) {
    const allFilteredChecked = filtered.every((p) => selectedManageIds.has(p.id));
    const someFilteredChecked = filtered.some((p) => selectedManageIds.has(p.id));
    chkAll.checked = allFilteredChecked;
    chkAll.indeterminate = !allFilteredChecked && someFilteredChecked;
  }
}

const SQL_MIGRATION_TEXT = `ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS data jsonb;
ALTER TABLE public.payslips ALTER COLUMN pdf_path DROP NOT NULL;`;

function hienModalSqlMigration() {
  const modal = $("sqlMigrationModal");
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = "flex";
}

function anModalSqlMigration() {
  const modal = $("sqlMigrationModal");
  if (!modal) return;
  modal.hidden = true;
  modal.style.display = "none";
}

function wireManageEvents() {
  // Nút mở hướng dẫn SQL Migration
  $("btnHuongDanSqlSupabase")?.addEventListener("click", () => {
    hienModalSqlMigration();
  });

  $("btnDongSqlModal")?.addEventListener("click", () => {
    anModalSqlMigration();
  });

  $("btnCopySqlMigration")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(SQL_MIGRATION_TEXT);
      showToast("✓ Đã copy câu lệnh SQL vào clipboard!", "success");
    } catch {
      showToast("Vui lòng bôi đen và copy đoạn mã SQL trong khung.", "warning");
    }
  });

  $("btnMoSupabaseSqlEditor")?.addEventListener("click", async () => {
    const { supabaseUrl } = layThongTinSupabase();
    let sqlEditorUrl = "https://supabase.com/dashboard";
    if (supabaseUrl) {
      const match = supabaseUrl.match(/https:\/\/([a-z0-9_-]+)\.supabase\.co/i);
      if (match && match[1]) {
        sqlEditorUrl = `https://supabase.com/dashboard/project/${match[1]}/sql/new`;
      }
    }
    await window.api.moLinkNgoai(sqlEditorUrl);
  });

  // Nút Làm mới
  $("btnLamMoiManage")?.addEventListener("click", () => {
    taiDanhSachManage($("locThangManage")?.value);
  });

  // Sắp xếp khi click tiêu đề cột bảng Manage
  $("bangManageTable")?.querySelector("thead")?.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.sortKey;
    if (manageSortState.key === key) {
      manageSortState.dir *= -1;
    } else {
      manageSortState.key = key;
      manageSortState.dir = (key === "uploaded_at" || key === "thang_nam") ? -1 : 1;
    }
    renderManageTable();
  });

  // Nút Đi đến cài đặt nếu chưa có keys
  $("btnManageDiDenCaiDat")?.addEventListener("click", () => {
    switchTab("settings");
  });

  // Tìm kiếm
  let searchTimer = null;
  $("oTimKiemManage")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      manageSearchQuery = e.target.value.trim();
      renderManageTable();
    }, 200);
  });

  // Lọc theo kỳ tháng
  $("locThangManage")?.addEventListener("change", (e) => {
    manageMonthFilter = e.target.value;
    renderManageTable();
  });

  // Lọc theo bộ phận
  $("locBoPhanManage")?.addEventListener("change", (e) => {
    manageBoPhanFilter = e.target.value;
    renderManageTable();
  });

  // Lọc theo trạng thái
  $("locTrangThaiManage")?.addEventListener("change", (e) => {
    manageStatusFilter = e.target.value;
    renderManageTable();
  });

  // Dropdown sắp xếp nhanh
  $("locSapXepManage")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const parts = val.split("_");
    const dirStr = parts.pop();
    const key = parts.join("_");
    manageSortState.key = key;
    manageSortState.dir = dirStr === "desc" ? -1 : 1;
    renderManageTable();
  });

  // Nút Xóa lọc
  $("btnResetLocManage")?.addEventListener("click", () => {
    if ($("oTimKiemManage")) $("oTimKiemManage").value = "";
    if ($("locThangManage")) $("locThangManage").value = "all";
    if ($("locBoPhanManage")) $("locBoPhanManage").value = "";
    if ($("locTrangThaiManage")) $("locTrangThaiManage").value = "all";
    if ($("locSapXepManage")) $("locSapXepManage").value = "uploaded_at_desc";
    manageSearchQuery = "";
    manageMonthFilter = "all";
    manageBoPhanFilter = "";
    manageStatusFilter = "all";
    manageSortState.key = "uploaded_at";
    manageSortState.dir = -1;
    renderManageTable();
  });

  // Chọn tất cả
  $("chkManageChonTatCa")?.addEventListener("change", (e) => {
    const checked = e.target.checked;
    const filtered = getFilteredManagePayslips();
    filtered.forEach((p) => {
      if (checked) selectedManageIds.add(p.id);
      else selectedManageIds.delete(p.id);
    });
    renderManageTable();
  });

  // Thao tác trên bảng (event delegation)
  $("bangManageBody")?.addEventListener("click", async (e) => {
    const target = e.target;

    // Tick chọn checkbox dòng
    if (target.matches(".chk-manage-item")) {
      const id = target.dataset.id;
      if (target.checked) selectedManageIds.add(id);
      else selectedManageIds.delete(id);
      renderManageTable();
      return;
    }

    // Xem PDF online
    const btnXem = target.closest(".btn-xem-pdf-manage");
    if (btnXem) {
      const path = btnXem.dataset.path;
      if (!path) {
        showToast("Phiếu này không có đường dẫn file PDF.", "warning");
        return;
      }
      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
      try {
        btnXem.disabled = true;
        const res = await window.api.laySignedUrlPhieuLuong({ supabaseUrl, serviceRoleKey, pdfPath: path });
        if (res && res.ok && res.signedUrl) {
          await window.api.moLinkNgoai(res.signedUrl);
        } else {
          showToast(`Không lấy được liên kết PDF: ${(res && res.error) || "Lỗi không xác định"}`, "error");
        }
      } catch (err) {
        showToast(`Lỗi: ${err.message || err}`, "error");
      } finally {
        btnXem.disabled = false;
      }
      return;
    }

    // Thu hồi 1 phiếu
    const btnThuHoi = target.closest(".btn-thu-hoi-mot");
    if (btnThuHoi) {
      const id = btnThuHoi.dataset.id;
      const maNV = btnThuHoi.dataset.manv;
      const xacNhan = await showConfirmModal({
        title: "Xác nhận thu hồi phiếu lương",
        message: `Thu hồi phiếu lương của nhân viên "${maNV}"?\n\nSau khi thu hồi, nhân viên sẽ không thể xem hoặc tải phiếu lương này trên Web Portal cho đến khi bạn phát hành lại.`,
        confirmLabel: "Thu hồi phiếu",
      });
      if (!xacNhan) return;

      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
      try {
        btnThuHoi.disabled = true;
        const res = await window.api.thuHoiPhieuLuongPortal({ supabaseUrl, serviceRoleKey, ids: [id] });
        if (res && res.ok) {
          const item = managePayslips.find((p) => p.id === id);
          if (item) {
            item.status = "revoked";
            item.revoked_at = new Date().toISOString();
          }
          showToast(`✓ Đã thu hồi phiếu lương của "${maNV}".`, "success");
          renderManageTable();
        } else {
          const errMsg = (res && res.error) || "Lỗi không rõ";
          showToast(`Thu hồi thất bại: ${errMsg}`, "error", 8000);
          if (errMsg.includes("status") || errMsg.includes("revoked_at") || errMsg.includes("PGRST204") || errMsg.includes("SQL")) {
            hienModalSqlMigration();
          }
        }
      } catch (err) {
        const errMsg = err.message || String(err);
        showToast(`Lỗi: ${errMsg}`, "error", 8000);
        if (errMsg.includes("status") || errMsg.includes("revoked_at") || errMsg.includes("PGRST204") || errMsg.includes("SQL")) {
          hienModalSqlMigration();
        }
      } finally {
        btnThuHoi.disabled = false;
      }
      return;
    }

    // Phát hành lại 1 phiếu
    const btnKhoiPhuc = target.closest(".btn-khoi-phuc-mot");
    if (btnKhoiPhuc) {
      const id = btnKhoiPhuc.dataset.id;
      const maNV = btnKhoiPhuc.dataset.manv;
      const xacNhan = await showConfirmModal({
        title: "Xác nhận phát hành lại",
        message: `Phát hành lại phiếu lương của nhân viên "${maNV}" trên Web Portal?`,
        confirmLabel: "Phát hành lại",
      });
      if (!xacNhan) return;

      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
      try {
        btnKhoiPhuc.disabled = true;
        const res = await window.api.khoiPhucPhieuLuongPortal({ supabaseUrl, serviceRoleKey, ids: [id] });
        if (res && res.ok) {
          const item = managePayslips.find((p) => p.id === id);
          if (item) {
            item.status = "active";
            item.revoked_at = null;
          }
          showToast(`✓ Đã phát hành lại phiếu lương của "${maNV}".`, "success");
          renderManageTable();
        } else {
          showToast(`Phát hành lại thất bại: ${(res && res.error) || "Lỗi không rõ"}`, "error");
        }
      } catch (err) {
        showToast(`Lỗi: ${err.message || err}`, "error");
      } finally {
        btnKhoiPhuc.disabled = false;
      }
      return;
    }

    // Xóa 1 phiếu
    const btnXoa = target.closest(".btn-xoa-mot");
    if (btnXoa) {
      const id = btnXoa.dataset.id;
      const maNV = btnXoa.dataset.manv;
      const pdfPath = btnXoa.dataset.path;
      const xacNhan = await showConfirmModal({
        title: "⚠️ Xác nhận xóa vĩnh viễn",
        message: `Bạn có chắc chắn muốn xóa vĩnh viễn phiếu lương của nhân viên "${maNV}" khỏi Supabase Database và Storage?\n\nHành động này KHÔNG THỂ HOÀN TÁC.`,
        confirmLabel: "Xóa vĩnh viễn",
      });
      if (!xacNhan) return;

      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
      try {
        btnXoa.disabled = true;
        const res = await window.api.xoaPhieuLuongPortal({
          supabaseUrl,
          serviceRoleKey,
          items: [{ id, pdf_path: pdfPath }],
        });
        if (res && res.ok) {
          managePayslips = managePayslips.filter((p) => p.id !== id);
          selectedManageIds.delete(id);
          showToast(`✓ Đã xóa vĩnh viễn phiếu lương của "${maNV}".`, "success");
          renderManageTable();
        } else {
          showToast(`Xóa thất bại: ${(res && res.error) || "Lỗi không rõ"}`, "error");
        }
      } catch (err) {
        showToast(`Lỗi: ${err.message || err}`, "error");
      } finally {
        btnXoa.disabled = false;
      }
      return;
    }
  });

  // Tác vụ hàng loạt: Thu hồi các phiếu đã chọn
  $("btnThuHoiChon")?.addEventListener("click", async () => {
    const ids = Array.from(selectedManageIds);
    if (!ids.length) return;
    const xacNhan = await showConfirmModal({
      title: "Xác nhận thu hồi hàng loạt",
      message: `Thu hồi ${ids.length} phiếu lương đã chọn?\n\nNhân viên sẽ không xem được các phiếu này trên portal cho đến khi phát hành lại.`,
      confirmLabel: "Thu hồi đã chọn",
    });
    if (!xacNhan) return;

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnThuHoiChon").disabled = true;
      const res = await window.api.thuHoiPhieuLuongPortal({ supabaseUrl, serviceRoleKey, ids });
      if (res && res.ok) {
        managePayslips.forEach((p) => {
          if (selectedManageIds.has(p.id)) {
            p.status = "revoked";
            p.revoked_at = new Date().toISOString();
          }
        });
        selectedManageIds.clear();
        showToast(`✓ Đã thu hồi ${ids.length} phiếu lương thành công.`, "success");
        renderManageTable();
      } else {
        const errMsg = (res && res.error) || "Lỗi";
        showToast(`Thu hồi thất bại: ${errMsg}`, "error", 8000);
        if (errMsg.includes("status") || errMsg.includes("revoked_at") || errMsg.includes("PGRST204") || errMsg.includes("SQL")) {
          hienModalSqlMigration();
        }
      }
    } catch (err) {
      const errMsg = err.message || String(err);
      showToast(`Lỗi: ${errMsg}`, "error", 8000);
      if (errMsg.includes("status") || errMsg.includes("revoked_at") || errMsg.includes("PGRST204") || errMsg.includes("SQL")) {
        hienModalSqlMigration();
      }
    } finally {
      if ($("btnThuHoiChon")) $("btnThuHoiChon").disabled = false;
    }
  });

  // Tác vụ hàng loạt: Phát hành lại các phiếu đã chọn
  $("btnKhoiPhucChon")?.addEventListener("click", async () => {
    const ids = Array.from(selectedManageIds);
    if (!ids.length) return;
    const xacNhan = await showConfirmModal({
      title: "Xác nhận phát hành lại hàng loạt",
      message: `Phát hành lại ${ids.length} phiếu lương đã chọn lên Web Portal?`,
      confirmLabel: "Phát hành lại",
    });
    if (!xacNhan) return;

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnKhoiPhucChon").disabled = true;
      const res = await window.api.khoiPhucPhieuLuongPortal({ supabaseUrl, serviceRoleKey, ids });
      if (res && res.ok) {
        managePayslips.forEach((p) => {
          if (selectedManageIds.has(p.id)) {
            p.status = "active";
            p.revoked_at = null;
          }
        });
        selectedManageIds.clear();
        showToast(`✓ Đã phát hành lại ${ids.length} phiếu lương thành công.`, "success");
        renderManageTable();
      } else {
        showToast(`Phát hành lại thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      if ($("btnKhoiPhucChon")) $("btnKhoiPhucChon").disabled = false;
    }
  });

  // Tác vụ hàng loạt: Xóa vĩnh viễn các phiếu đã chọn
  $("btnXoaChonManage")?.addEventListener("click", async () => {
    const ids = Array.from(selectedManageIds);
    if (!ids.length) return;
    const xacNhan = await showConfirmModal({
      title: "⚠️ Xác nhận xóa vĩnh viễn hàng loạt",
      message: `Bạn có chắc chắn muốn xóa vĩnh viễn ${ids.length} phiếu lương đã chọn khỏi Supabase Database và Storage?\n\nHành động này KHÔNG THỂ HOÀN TÁC.`,
      confirmLabel: "Xóa vĩnh viễn",
    });
    if (!xacNhan) return;

    const items = managePayslips
      .filter((p) => selectedManageIds.has(p.id))
      .map((p) => ({ id: p.id, pdf_path: p.pdf_path }));

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnXoaChonManage").disabled = true;
      const res = await window.api.xoaPhieuLuongPortal({ supabaseUrl, serviceRoleKey, items });
      if (res && res.ok) {
        const deletedSet = new Set(ids);
        managePayslips = managePayslips.filter((p) => !deletedSet.has(p.id));
        selectedManageIds.clear();
        showToast(`✓ Đã xóa vĩnh viễn ${ids.length} phiếu lương thành công.`, "success");
        renderManageTable();
      } else {
        showToast(`Xóa thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      if ($("btnXoaChonManage")) $("btnXoaChonManage").disabled = false;
    }
  });

  // Nút mở quản lý từ Topbar
  $("btnMoQuanLy")?.addEventListener("click", () => {
    switchTab("manage");
  });

  // Nút mở quản lý từ Home
  $("btnHomeGoManage")?.addEventListener("click", () => {
    switchTab("manage");
  });
}

// ============================================================
// QUẢN LÝ TÀI KHOẢN NHÂN VIÊN TRÊN WEB PORTAL (SUPABASE)
// ============================================================
let manageAccounts = [];
const selectedAccountIds = new Set();
let accountsSearchQuery = "";
let accountsBoPhanFilter = "";
let accountsStatusFilter = "all";
let isLoadingAccounts = false;
const accountsSortState = { key: "ma_nv", dir: 1 };

let currentResetTarget = null;
let currentUpsertTarget = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function taiDanhSachAccounts() {
  const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
  const noConfigBox = $("accountsNoConfigWarning");

  if (!supabaseUrl || !serviceRoleKey) {
    if (noConfigBox) {
      noConfigBox.hidden = false;
      noConfigBox.style.display = "block";
    }
    manageAccounts = [];
    renderAccountsTable();
    return;
  }

  if (noConfigBox) {
    noConfigBox.hidden = true;
    noConfigBox.style.display = "none";
  }

  const loadingEl = $("accountsLoading");
  const emptyEl = $("accountsEmpty");
  if (loadingEl) loadingEl.style.display = "block";
  if (emptyEl) emptyEl.style.display = "none";
  isLoadingAccounts = true;

  try {
    const ketQua = await window.api.layDanhSachTaiKhoanPortal({
      supabaseUrl,
      serviceRoleKey,
    });

    if (ketQua && ketQua.ok) {
      manageAccounts = ketQua.data || [];
      capNhatDropdownBoPhanAccounts();
      renderAccountsTable();
    } else {
      showToast(`Không thể tải danh sách tài khoản: ${(ketQua && ketQua.error) || "Lỗi không xác định"}`, "error");
      manageAccounts = [];
      renderAccountsTable();
    }
  } catch (err) {
    showToast(`Lỗi kết nối Supabase: ${err.message || err}`, "error");
    manageAccounts = [];
    renderAccountsTable();
  } finally {
    isLoadingAccounts = false;
    if (loadingEl) loadingEl.style.display = "none";
  }
}

function capNhatDropdownBoPhanAccounts() {
  const select = $("locBoPhanAccounts");
  if (!select) return;
  const currentVal = select.value || "";
  const boPhans = [...new Set(manageAccounts.map((a) => a.bo_phan).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));

  let html = '<option value="">Tất cả bộ phận</option>';
  boPhans.forEach((bp) => {
    html += `<option value="${escapeHtml(bp)}">${escapeHtml(bp)}</option>`;
  });
  select.innerHTML = html;
  if (boPhans.includes(currentVal) || currentVal === "") {
    select.value = currentVal;
    accountsBoPhanFilter = currentVal;
  } else {
    select.value = "";
    accountsBoPhanFilter = "";
  }
}

function getFilteredAccounts() {
  let list = manageAccounts.filter((a) => {
    if (accountsBoPhanFilter && a.bo_phan !== accountsBoPhanFilter) return false;
    if (accountsStatusFilter !== "all") {
      if (accountsStatusFilter === "has_account" && !a.has_account) return false;
      if (accountsStatusFilter === "password_changed" && (!a.has_account || !a.password_changed || a.is_banned)) return false;
      if (accountsStatusFilter === "default_pass" && (!a.has_account || a.password_changed || a.is_banned)) return false;
      if (accountsStatusFilter === "no_account" && a.has_account) return false;
      if (accountsStatusFilter === "banned" && !a.is_banned) return false;
    }
    if (accountsSearchQuery) {
      const q = boDauTiengViet(accountsSearchQuery.toLowerCase());
      const text = boDauTiengViet(`${a.ma_nv || ""} ${a.ho_ten || ""} ${a.email || ""} ${a.bo_phan || ""} ${a.khoi || ""} ${a.co_so || ""}`).toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  if (accountsSortState.key) {
    const { key, dir } = accountsSortState;
    list.sort((a, b) => {
      if (key === "stt") return 0;
      if (key === "last_sign_in_at" || key === "last_sign_in_desc") {
        const ta = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0;
        const tb = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0;
        return (ta - tb) * dir;
      }
      if (key === "payslip_count" || key === "payslip_count_desc") {
        return ((a.payslip_count || 0) - (b.payslip_count || 0)) * dir;
      }
      if (key === "status") {
        const sa = a.is_banned ? "4" : a.password_changed ? "1" : a.has_account ? "2" : "3";
        const sb = b.is_banned ? "4" : b.password_changed ? "1" : b.has_account ? "2" : "3";
        return sa.localeCompare(sb) * dir;
      }
      const va = String(a[key] || "");
      const vb = String(b[key] || "");
      return va.localeCompare(vb, "vi") * dir;
    });
  }

  return list;
}

function renderAccountsTable() {
  const tbody = $("bangAccountsBody");
  if (!tbody) return;

  const filtered = getFilteredAccounts();

  // Thống kê thẻ KPI
  const tong = manageAccounts.length;
  const passChanged = manageAccounts.filter((a) => a.has_account && a.password_changed && !a.is_banned).length;
  const defaultPass = manageAccounts.filter((a) => a.has_account && !a.password_changed && !a.is_banned).length;
  const noAccount = manageAccounts.filter((a) => !a.has_account).length;
  const banned = manageAccounts.filter((a) => a.is_banned).length;

  if ($("soLuongAccountsTong")) $("soLuongAccountsTong").textContent = tong;
  if ($("soLuongAccountsPasswordChanged")) $("soLuongAccountsPasswordChanged").textContent = passChanged;
  if ($("soLuongAccountsDefaultPass")) $("soLuongAccountsDefaultPass").textContent = defaultPass;
  if ($("soLuongAccountsNoAccount")) $("soLuongAccountsNoAccount").textContent = noAccount;
  if ($("soLuongAccountsBanned")) $("soLuongAccountsBanned").textContent = banned;
  if ($("soLuongAccountsTongLabel")) $("soLuongAccountsTongLabel").textContent = `${filtered.length} / ${tong} tài khoản`;

  // Cập nhật thanh hành động hàng loạt
  const selectedCount = selectedAccountIds.size;
  if ($("lblSoLuongAccountsChon")) $("lblSoLuongAccountsChon").textContent = selectedCount;
  if ($("btnCapTaiKhoanChon")) $("btnCapTaiKhoanChon").disabled = selectedCount === 0;
  if ($("btnResetPassChon")) $("btnResetPassChon").disabled = selectedCount === 0;
  if ($("btnKhoaChonAccounts")) $("btnKhoaChonAccounts").disabled = selectedCount === 0;
  if ($("btnXoaChonAccounts")) $("btnXoaChonAccounts").disabled = selectedCount === 0;

  // Cập nhật checkbox chọn tất cả
  const chkAll = $("chkAccountsChonTatCa");
  if (chkAll) {
    if (filtered.length === 0) {
      chkAll.checked = false;
      chkAll.indeterminate = false;
    } else {
      const allSelected = filtered.every((a) => selectedAccountIds.has(a.ma_nv));
      const someSelected = filtered.some((a) => selectedAccountIds.has(a.ma_nv));
      chkAll.checked = allSelected;
      chkAll.indeterminate = !allSelected && someSelected;
    }
  }

  // Cập nhật mũi tên sắp xếp trên header
  document.querySelectorAll("#bangAccountsTable th.sortable").forEach((th) => {
    const key = th.dataset.sortKey;
    const arrow = th.querySelector(".sort-arrow");
    if (arrow) {
      if (key === accountsSortState.key) {
        arrow.textContent = accountsSortState.dir === 1 ? " ▲" : " ▼";
        th.classList.add("active-sort");
      } else {
        arrow.textContent = "";
        th.classList.remove("active-sort");
      }
    }
  });

  // Empty state
  const emptyEl = $("accountsEmpty");
  if (filtered.length === 0 && !isLoadingAccounts) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.style.display = "block";
      const emptyMsg = $("accountsEmptyMsg");
      if (emptyMsg) {
        emptyMsg.textContent = manageAccounts.length === 0
          ? "Chưa có nhân viên nào trong cơ sở dữ liệu Supabase."
          : "Không tìm thấy tài khoản nào khớp với bộ lọc.";
      }
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  let html = "";
  filtered.forEach((acc, index) => {
    const isSelected = selectedAccountIds.has(acc.ma_nv);
    const maNV = escapeHtml(formatMaNV(acc.ma_nv));
    const hoTen = escapeHtml(acc.ho_ten || acc.ma_nv);
    const boPhan = escapeHtml(acc.bo_phan || "-");
    const email = escapeHtml(acc.email);
    const defaultPass = escapeHtml(acc.default_password || "");
    const payslipCount = acc.payslip_count || 0;
    const lastSignIn = formatNgayGioVi(acc.last_sign_in_at);

    // Trạng thái badge
    let statusBadge = "";
    if (acc.is_banned) {
      statusBadge = '<span class="badge error" title="Tài khoản đang bị khóa tạm thời">🔒 Bị khóa</span>';
    } else if (acc.has_account && acc.password_changed) {
      statusBadge = '<span class="badge ok" title="Đã đổi mật khẩu cá nhân, tài khoản đang hoạt động tốt">🟢 Đã đổi pass</span>';
    } else if (acc.has_account && !acc.password_changed) {
      statusBadge = `<span class="badge warning" title="Đang sử dụng mật khẩu mặc định: ${defaultPass}">🟡 Pass mặc định</span>`;
    } else {
      statusBadge = '<span class="badge" style="background:rgba(156,163,175,0.2);color:#4b5563" title="Chưa được tạo tài khoản Supabase Auth">⚪ Chưa cấp</span>';
    }

    // Các nút thao tác
    let actionButtons = "";
    if (acc.has_account) {
      actionButtons += `
        <button type="button" class="btn-action-mini btn-reset-pass" data-manv="${maNV}" data-hoten="${hoTen}" data-userid="${acc.user_id || ""}" data-defaultpass="${defaultPass}" title="Đặt lại mật khẩu cho nhân viên này">
          🔑 Reset
        </button>
        <button type="button" class="btn-action-mini btn-copy-account" data-manv="${maNV}" data-hoten="${hoTen}" data-email="${email}" data-defaultpass="${defaultPass}" title="Copy thông tin đăng nhập để gửi Zalo/Email cho nhân viên">
          📋 Copy
        </button>
        <button type="button" class="btn-action-mini btn-toggle-ban" data-userid="${acc.user_id || ""}" data-manv="${maNV}" data-ban="${acc.is_banned ? "false" : "true"}" title="${acc.is_banned ? "Mở khóa tài khoản" : "Khóa tài khoản"}">
          ${acc.is_banned ? "🔓 Mở" : "🔒 Khóa"}
        </button>
      `;
    } else {
      actionButtons += `
        <button type="button" class="btn-action-mini btn-primary btn-create-single-account" data-manv="${maNV}" data-hoten="${hoTen}" data-bophan="${escapeHtml(acc.bo_phan || "")}" data-khoi="${escapeHtml(acc.khoi || "")}" data-coso="${escapeHtml(acc.co_so || "")}" title="Cấp ngay tài khoản Portal cho nhân viên này">
          ⚡ Cấp TK
        </button>
      `;
    }

    actionButtons += `
      <button type="button" class="btn-action-mini btn-edit-account" data-manv="${maNV}" data-hoten="${hoTen}" data-bophan="${escapeHtml(acc.bo_phan || "")}" data-khoi="${escapeHtml(acc.khoi || "")}" data-coso="${escapeHtml(acc.co_so || "")}" title="Chỉnh sửa thông tin nhân viên">
        ✏️ Sửa
      </button>
      <button type="button" class="btn-action-mini btn-danger btn-delete-account" data-manv="${maNV}" data-userid="${acc.user_id || ""}" title="Xóa tài khoản / nhân viên">
        🗑️
      </button>
    `;

    html += `
      <tr class="${isSelected ? "row-selected" : ""}" data-manv="${maNV}">
        <td style="text-align: center;">
          <input type="checkbox" class="chk-account-row" data-manv="${maNV}" ${isSelected ? "checked" : ""} />
        </td>
        <td style="text-align: center; color: var(--text-muted); font-size: 11.5px;">${index + 1}</td>
        <td><strong style="color: var(--primary);">${maNV}</strong></td>
        <td><span style="font-weight: 600;">${hoTen}</span></td>
        <td style="color: var(--text-muted); font-size: 12px;">${boPhan}</td>
        <td><code style="font-size: 11.5px; background: var(--bg-hover); padding: 2px 5px; border-radius: 4px;">${email}</code></td>
        <td style="text-align: center;">${statusBadge}</td>
        <td style="text-align: center;">
          <span class="badge" style="background:rgba(99,102,241,0.15);color:#4338ca;font-weight:700">${payslipCount}</span>
        </td>
        <td style="font-size: 11.5px; color: var(--text-muted);">${lastSignIn}</td>
        <td style="text-align: center; white-space: nowrap;">
          <div style="display: inline-flex; gap: 4px;">${actionButtons}</div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function wireAccountEvents() {
  // Nút mở Quản lý tài khoản từ Topbar
  $("btnMoQuanLyTaiKhoan")?.addEventListener("click", () => {
    switchTab("accounts");
  });

  // Chuyển đổi giữa 2 tab phụ
  $("btnSubnavManagePayslips")?.addEventListener("click", () => switchTab("manage"));
  $("btnSubnavManageAccounts")?.addEventListener("click", () => switchTab("accounts"));
  $("btnSubnavAccountsPayslips")?.addEventListener("click", () => switchTab("manage"));
  $("btnSubnavAccountsAccounts")?.addEventListener("click", () => switchTab("accounts"));

  // Nút Đi đến Cài đặt từ thông báo thiếu config
  $("btnAccountsDiDenCaiDat")?.addEventListener("click", () => {
    switchTab("settings");
  });

  // Nút Làm mới danh sách tài khoản
  $("btnLamMoiAccounts")?.addEventListener("click", () => {
    taiDanhSachAccounts();
  });

  // Sắp xếp bảng tài khoản
  document.querySelectorAll("#bangAccountsTable th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (!key) return;
      if (accountsSortState.key === key) {
        accountsSortState.dir = -accountsSortState.dir;
      } else {
        accountsSortState.key = key;
        accountsSortState.dir = 1;
      }
      renderAccountsTable();
    });
  });

  // Lọc theo bộ phận
  $("locBoPhanAccounts")?.addEventListener("change", (e) => {
    accountsBoPhanFilter = e.target.value;
    renderAccountsTable();
  });

  // Lọc theo trạng thái
  $("locTrangThaiAccounts")?.addEventListener("change", (e) => {
    accountsStatusFilter = e.target.value;
    renderAccountsTable();
  });

  // Sắp xếp qua dropdown
  $("locSapXepAccounts")?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "ma_nv_asc") { accountsSortState.key = "ma_nv"; accountsSortState.dir = 1; }
    else if (val === "ma_nv_desc") { accountsSortState.key = "ma_nv"; accountsSortState.dir = -1; }
    else if (val === "ho_ten_asc") { accountsSortState.key = "ho_ten"; accountsSortState.dir = 1; }
    else if (val === "ho_ten_desc") { accountsSortState.key = "ho_ten"; accountsSortState.dir = -1; }
    else if (val === "bo_phan_asc") { accountsSortState.key = "bo_phan"; accountsSortState.dir = 1; }
    else if (val === "last_sign_in_desc") { accountsSortState.key = "last_sign_in_at"; accountsSortState.dir = -1; }
    else if (val === "payslip_count_desc") { accountsSortState.key = "payslip_count"; accountsSortState.dir = -1; }
    renderAccountsTable();
  });

  // Ô tìm kiếm tài khoản
  $("oTimKiemAccounts")?.addEventListener("input", (e) => {
    accountsSearchQuery = e.target.value.trim();
    renderAccountsTable();
  });

  // Nút Xóa lọc
  $("btnResetLocAccounts")?.addEventListener("click", () => {
    accountsSearchQuery = "";
    accountsBoPhanFilter = "";
    accountsStatusFilter = "all";
    accountsSortState.key = "ma_nv";
    accountsSortState.dir = 1;
    if ($("oTimKiemAccounts")) $("oTimKiemAccounts").value = "";
    if ($("locBoPhanAccounts")) $("locBoPhanAccounts").value = "";
    if ($("locTrangThaiAccounts")) $("locTrangThaiAccounts").value = "all";
    if ($("locSapXepAccounts")) $("locSapXepAccounts").value = "ma_nv_asc";
    renderAccountsTable();
  });

  // Checkbox chọn tất cả
  $("chkAccountsChonTatCa")?.addEventListener("change", (e) => {
    const filtered = getFilteredAccounts();
    if (e.target.checked) {
      filtered.forEach((a) => selectedAccountIds.add(a.ma_nv));
    } else {
      filtered.forEach((a) => selectedAccountIds.delete(a.ma_nv));
    }
    renderAccountsTable();
  });

  // Checkbox từng hàng & Các nút thao tác trên từng hàng
  $("bangAccountsBody")?.addEventListener("click", async (e) => {
    const rowChk = e.target.closest(".chk-account-row");
    if (rowChk) {
      const maNV = rowChk.dataset.manv;
      if (rowChk.checked) selectedAccountIds.add(maNV);
      else selectedAccountIds.delete(maNV);
      renderAccountsTable();
      return;
    }

    // Nút Copy thông tin tài khoản
    const btnCopy = e.target.closest(".btn-copy-account");
    if (btnCopy) {
      const maNV = btnCopy.dataset.manv;
      const hoTen = btnCopy.dataset.hoten || maNV;
      const email = btnCopy.dataset.email;
      const defaultPass = btnCopy.dataset.defaultpass;
      const copyText = `Thông tin tài khoản Portal tra cứu phiếu lương:\n` +
        `- Họ và tên: ${hoTen}\n` +
        `- Mã nhân viên: ${maNV}\n` +
        `- Tài khoản đăng nhập: ${email}\n` +
        `- Mật khẩu ban đầu: ${defaultPass}\n` +
        `\n* Lưu ý: Vui lòng đổi mật khẩu mới trong lần đầu tiên đăng nhập để bảo mật thông tin.`;
      try {
        await navigator.clipboard.writeText(copyText);
        showToast(`✓ Đã copy thông tin đăng nhập của ${maNV} vào clipboard!`, "success");
      } catch {
        showToast("Không thể copy vào clipboard.", "warning");
      }
      return;
    }

    // Nút Reset Password từng người
    const btnReset = e.target.closest(".btn-reset-pass");
    if (btnReset) {
      const maNV = btnReset.dataset.manv;
      const hoTen = btnReset.dataset.hoten;
      const userId = btnReset.dataset.userid;
      const defaultPass = btnReset.dataset.defaultpass;
      moModalResetPassword({ maNV, hoTen, userId, defaultPass });
      return;
    }

    // Nút Cấp tài khoản đơn lẻ
    const btnCreateSingle = e.target.closest(".btn-create-single-account");
    if (btnCreateSingle) {
      const maNV = btnCreateSingle.dataset.manv;
      const hoTen = btnCreateSingle.dataset.hoten;
      const boPhan = btnCreateSingle.dataset.bophan;
      const khoi = btnCreateSingle.dataset.khoi;
      const coSo = btnCreateSingle.dataset.coso;
      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();

      try {
        btnCreateSingle.disabled = true;
        btnCreateSingle.textContent = "Đang tạo…";
        const res = await window.api.taoTaiKhoanPortal({
          supabaseUrl,
          serviceRoleKey,
          employee: { ma_nv: maNV, ho_ten: hoTen, bo_phan: boPhan, khoi, co_so: coSo },
        });
        if (res && res.ok) {
          showToast(`✓ Đã cấp tài khoản thành công cho "${maNV}" (Mật khẩu: ${res.password}).`, "success", 6000);
          await taiDanhSachAccounts();
        } else {
          showToast(`Cấp tài khoản thất bại: ${(res && res.error) || "Lỗi"}`, "error");
        }
      } catch (err) {
        showToast(`Lỗi: ${err.message || err}`, "error");
      } finally {
        if (btnCreateSingle) {
          btnCreateSingle.disabled = false;
          btnCreateSingle.textContent = "⚡ Cấp TK";
        }
      }
      return;
    }

    // Nút Khóa / Mở khóa tài khoản
    const btnBan = e.target.closest(".btn-toggle-ban");
    if (btnBan) {
      const userId = btnBan.dataset.userid;
      const maNV = btnBan.dataset.manv;
      const shouldBan = btnBan.dataset.ban === "true";
      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();

      const xacNhan = await showConfirmModal({
        title: shouldBan ? "Xác nhận khóa tài khoản" : "Xác nhận mở khóa tài khoản",
        message: shouldBan
          ? `Khóa tài khoản của "${maNV}"?\nNhân viên này sẽ tạm thời không thể đăng nhập vào Portal tra cứu phiếu lương.`
          : `Mở khóa tài khoản cho "${maNV}"?\nNhân viên sẽ có thể đăng nhập bình thường.`,
        confirmLabel: shouldBan ? "Khóa tài khoản" : "Mở khóa",
      });
      if (!xacNhan) return;

      try {
        const res = await window.api.khoaTaiKhoanPortal({
          supabaseUrl,
          serviceRoleKey,
          userId,
          ban: shouldBan,
        });
        if (res && res.ok) {
          showToast(shouldBan ? `✓ Đã khóa tài khoản của "${maNV}".` : `✓ Đã mở khóa tài khoản cho "${maNV}".`, "success");
          await taiDanhSachAccounts();
        } else {
          showToast(`Thao tác thất bại: ${(res && res.error) || "Lỗi"}`, "error");
        }
      } catch (err) {
        showToast(`Lỗi: ${err.message || err}`, "error");
      }
      return;
    }

    // Nút Chỉnh sửa thông tin nhân viên
    const btnEdit = e.target.closest(".btn-edit-account");
    if (btnEdit) {
      const maNV = btnEdit.dataset.manv;
      const acc = manageAccounts.find((a) => a.ma_nv === maNV);
      if (acc) {
        moModalUpsertEmployee(acc);
      }
      return;
    }

    // Nút Xóa tài khoản / nhân viên
    const btnDelete = e.target.closest(".btn-delete-account");
    if (btnDelete) {
      const maNV = btnDelete.dataset.manv;
      const userId = btnDelete.dataset.userid;
      const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();

      const xacNhan = await showConfirmModal({
        title: "Xác nhận xóa tài khoản",
        message: `Xóa tài khoản của "${maNV}" khỏi hệ thống?\n\nNhân viên sẽ không thể đăng nhập portal nữa. Bạn có thể cấp lại tài khoản sau nếu cần.`,
        confirmLabel: "Xóa tài khoản",
      });
      if (!xacNhan) return;

      try {
        const res = await window.api.xoaTaiKhoanPortal({
          supabaseUrl,
          serviceRoleKey,
          maNV,
          userId,
          deleteEmployeeRecord: false,
        });
        if (res && res.ok) {
          selectedAccountIds.delete(maNV);
          showToast(`✓ Đã xóa tài khoản của "${maNV}".`, "success");
          await taiDanhSachAccounts();
        } else {
          showToast(`Xóa thất bại: ${(res && res.error) || "Lỗi"}`, "error");
        }
      } catch (err) {
        showToast(`Lỗi: ${err.message || err}`, "error");
      }
      return;
    }
  });

  // Tác vụ hàng loạt: Cấp tài khoản cho các NV đã chọn
  $("btnCapTaiKhoanChon")?.addEventListener("click", async () => {
    const selectedList = manageAccounts.filter((a) => selectedAccountIds.has(a.ma_nv) && !a.has_account);
    if (!selectedList.length) {
      showToast("Tất cả các nhân viên đã chọn đều đã có tài khoản.", "info");
      return;
    }

    const xacNhan = await showConfirmModal({
      title: "Cấp tài khoản hàng loạt",
      message: `Tạo tài khoản Portal cho ${selectedList.length} nhân viên chưa có tài khoản?\nMật khẩu ban đầu sẽ được gán mặc định theo mã NV.`,
      confirmLabel: "Cấp tài khoản",
    });
    if (!xacNhan) return;

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnCapTaiKhoanChon").disabled = true;
      const res = await window.api.taoTaiKhoanHangLoatPortal({
        supabaseUrl,
        serviceRoleKey,
        employees: selectedList,
      });
      if (res && res.ok) {
        showToast(`✓ Đã cấp thành công ${res.successCount} tài khoản!${res.failCount > 0 ? ` (${res.failCount} lỗi)` : ""}`, "success");
        await taiDanhSachAccounts();
      } else {
        showToast(`Cấp tài khoản thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      if ($("btnCapTaiKhoanChon")) $("btnCapTaiKhoanChon").disabled = false;
    }
  });

  // Tác vụ hàng loạt: Reset pass mặc định
  $("btnResetPassChon")?.addEventListener("click", async () => {
    const selectedList = manageAccounts.filter((a) => selectedAccountIds.has(a.ma_nv) && a.has_account);
    if (!selectedList.length) {
      showToast("Không có tài khoản nào được chọn để đặt lại mật khẩu.", "info");
      return;
    }

    const xacNhan = await showConfirmModal({
      title: "Đặt lại mật khẩu hàng loạt",
      message: `Khôi phục mật khẩu mặc định (theo mã NV) cho ${selectedList.length} tài khoản đã chọn?\n\nNhân viên sẽ được yêu cầu đổi mật khẩu mới trong lần đăng nhập tiếp theo.`,
      confirmLabel: "Đặt lại mật khẩu",
    });
    if (!xacNhan) return;

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnResetPassChon").disabled = true;
      const res = await window.api.datLaiMatKhauHangLoatPortal({
        supabaseUrl,
        serviceRoleKey,
        accounts: selectedList,
      });
      if (res && res.ok) {
        showToast(`✓ Đã đặt lại mật khẩu mặc định cho ${res.count} tài khoản thành công!`, "success");
        await taiDanhSachAccounts();
      } else {
        showToast(`Đặt lại mật khẩu thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      if ($("btnResetPassChon")) $("btnResetPassChon").disabled = false;
    }
  });

  // Tác vụ hàng loạt: Khóa các tài khoản đã chọn
  $("btnKhoaChonAccounts")?.addEventListener("click", async () => {
    const selectedList = manageAccounts.filter((a) => selectedAccountIds.has(a.ma_nv) && a.has_account && a.user_id);
    if (!selectedList.length) return;

    const xacNhan = await showConfirmModal({
      title: "Khóa tài khoản hàng loạt",
      message: `Khóa ${selectedList.length} tài khoản đã chọn?\nCác nhân viên này sẽ không thể đăng nhập Portal cho đến khi được mở khóa.`,
      confirmLabel: "Khóa đã chọn",
    });
    if (!xacNhan) return;

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnKhoaChonAccounts").disabled = true;
      let count = 0;
      for (const acc of selectedList) {
        try {
          await window.api.khoaTaiKhoanPortal({
            supabaseUrl,
            serviceRoleKey,
            userId: acc.user_id,
            ban: true,
          });
          count++;
        } catch { /* tiếp tục */ }
      }
      showToast(`✓ Đã khóa thành công ${count} tài khoản.`, "success");
      await taiDanhSachAccounts();
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      if ($("btnKhoaChonAccounts")) $("btnKhoaChonAccounts").disabled = false;
    }
  });

  // Tác vụ hàng loạt: Xóa tài khoản đã chọn
  $("btnXoaChonAccounts")?.addEventListener("click", async () => {
    const selectedList = manageAccounts.filter((a) => selectedAccountIds.has(a.ma_nv));
    if (!selectedList.length) return;

    const xacNhan = await showConfirmModal({
      title: "Xác nhận xóa tài khoản hàng loạt",
      message: `Xóa tài khoản của ${selectedList.length} nhân viên đã chọn?\nNhân viên sẽ không thể đăng nhập Portal nữa.`,
      confirmLabel: "Xóa tài khoản",
    });
    if (!xacNhan) return;

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      $("btnXoaChonAccounts").disabled = true;
      const res = await window.api.xoaTaiKhoanHangLoatPortal({
        supabaseUrl,
        serviceRoleKey,
        items: selectedList,
        deleteEmployeeRecord: false,
      });
      if (res && res.ok) {
        selectedAccountIds.clear();
        showToast(`✓ Đã xóa thành công ${res.count} tài khoản.`, "success");
        await taiDanhSachAccounts();
      } else {
        showToast(`Xóa thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      if ($("btnXoaChonAccounts")) $("btnXoaChonAccounts").disabled = false;
    }
  });

  // Xuất file CSV danh sách tài khoản
  $("btnXuatCsvAccounts")?.addEventListener("click", () => {
    const list = getFilteredAccounts();
    if (!list.length) {
      showToast("Không có dữ liệu tài khoản để xuất.", "warning");
      return;
    }

    const headers = [
      "Mã NV",
      "Họ và tên",
      "Bộ phận",
      "Khối",
      "Cơ sở",
      "Tài khoản Portal",
      "Mật khẩu mặc định",
      "Trạng thái tài khoản",
      "Số phiếu lương",
      "Đăng nhập lần cuối",
    ];

    const escapeCsv = (val) => {
      const str = String(val ?? "").replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = list.map((a) => {
      let statusStr = "Chưa cấp tài khoản";
      if (a.is_banned) statusStr = "Đang bị khóa";
      else if (a.has_account && a.password_changed) statusStr = "Đã đổi mật khẩu cá nhân (Đang hoạt động)";
      else if (a.has_account && !a.password_changed) statusStr = "Đang dùng mật khẩu mặc định";

      return [
        escapeCsv(a.ma_nv),
        escapeCsv(a.ho_ten || a.ma_nv),
        escapeCsv(a.bo_phan || ""),
        escapeCsv(a.khoi || ""),
        escapeCsv(a.co_so || ""),
        escapeCsv(a.email),
        escapeCsv(a.default_password || ""),
        escapeCsv(statusStr),
        escapeCsv(a.payslip_count || 0),
        escapeCsv(formatNgayGioVi(a.last_sign_in_at)),
      ].join(",");
    });

    const csvContent = "\uFEFF" + headers.map(escapeCsv).join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Danh_sach_tai_khoan_Portal_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✓ Đã xuất danh sách ${list.length} tài khoản ra file CSV!`, "success");
  });

  // Modal Reset Password Logic
  function moModalResetPassword({ maNV, hoTen, userId, defaultPass }) {
    currentResetTarget = { maNV, hoTen, userId, defaultPass };
    const modal = $("modalResetPassword");
    if (!modal) return;
    if ($("resetPassEmpName")) $("resetPassEmpName").textContent = hoTen;
    if ($("resetPassEmpCode")) $("resetPassEmpCode").textContent = maNV;
    if ($("resetPassDefaultVal")) $("resetPassDefaultVal").textContent = defaultPass;
    const radDefault = document.querySelector('input[name="radResetPassType"][value="default"]');
    if (radDefault) radDefault.checked = true;
    const inputCustom = $("resetPassCustomInput");
    if (inputCustom) {
      inputCustom.value = "";
      inputCustom.disabled = true;
    }
    modal.hidden = false;
    modal.style.display = "flex";
  }

  function dongModalResetPassword() {
    const modal = $("modalResetPassword");
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = "none";
    currentResetTarget = null;
  }

  document.querySelectorAll('input[name="radResetPassType"]').forEach((rad) => {
    rad.addEventListener("change", (e) => {
      const isCustom = e.target.value === "custom";
      const input = $("resetPassCustomInput");
      if (input) {
        input.disabled = !isCustom;
        if (isCustom) input.focus();
      }
    });
  });

  $("modalResetPassCancelBtn")?.addEventListener("click", dongModalResetPassword);

  $("modalResetPassConfirmBtn")?.addEventListener("click", async () => {
    if (!currentResetTarget) return;
    const radCustom = document.querySelector('input[name="radResetPassType"][value="custom"]');
    const isCustom = radCustom && radCustom.checked;
    const customPass = $("resetPassCustomInput")?.value?.trim() || "";

    if (isCustom && customPass.length < 6) {
      showToast("Mật khẩu mới tùy chọn phải có ít nhất 6 ký tự.", "warning");
      $("resetPassCustomInput")?.focus();
      return;
    }

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      const btn = $("modalResetPassConfirmBtn");
      btn.disabled = true;
      btn.textContent = "Đang xử lý…";

      const res = await window.api.datLaiMatKhauPortal({
        supabaseUrl,
        serviceRoleKey,
        userId: currentResetTarget.userId,
        maNV: currentResetTarget.maNV,
        newPassword: isCustom ? customPass : null,
      });

      if (res && res.ok) {
        dongModalResetPassword();
        showToast(`✓ Đã đặt lại mật khẩu cho "${currentResetTarget.maNV}" thành công (Mật khẩu mới: ${res.newPassword}).`, "success", 6000);
        await taiDanhSachAccounts();
      } else {
        showToast(`Đặt lại mật khẩu thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      const btn = $("modalResetPassConfirmBtn");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Đặt lại mật khẩu";
      }
    }
  });

  // Modal Thêm / Sửa nhân viên Logic
  function moModalUpsertEmployee(employee = null) {
    currentUpsertTarget = employee;
    const modal = $("modalUpsertEmployee");
    if (!modal) return;

    const isEdit = !!employee;
    if ($("modalUpsertTitle")) $("modalUpsertTitle").textContent = isEdit ? `✏️ Chỉnh sửa thông tin (${employee.ma_nv})` : "➕ Thêm nhân viên mới";
    if ($("upsertMaNV")) {
      $("upsertMaNV").value = isEdit ? employee.ma_nv : "";
      $("upsertMaNV").disabled = isEdit;
    }
    if ($("upsertHoTen")) $("upsertHoTen").value = isEdit ? employee.ho_ten : "";
    if ($("upsertBoPhan")) $("upsertBoPhan").value = isEdit ? employee.bo_phan : "";
    if ($("upsertKhoi")) $("upsertKhoi").value = isEdit ? employee.khoi : "";
    if ($("upsertCoSo")) $("upsertCoSo").value = isEdit ? employee.co_so : "";

    const authSection = $("upsertAuthSection");
    if (authSection) {
      authSection.style.display = isEdit && employee.has_account ? "none" : "block";
    }
    capNhatUpsertPreviewEmail();

    modal.hidden = false;
    modal.style.display = "flex";
  }

  function dongModalUpsertEmployee() {
    const modal = $("modalUpsertEmployee");
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = "none";
    currentUpsertTarget = null;
  }

  function capNhatUpsertPreviewEmail() {
    const maNV = $("upsertMaNV")?.value?.trim() || "";
    const previewEl = $("upsertPreviewEmail");
    if (previewEl) {
      previewEl.textContent = maNV ? `${maNV.toLowerCase()}@hehehr.internal` : "chưa nhập mã NV";
    }
  }

  $("upsertMaNV")?.addEventListener("input", capNhatUpsertPreviewEmail);
  $("modalUpsertCancelBtn")?.addEventListener("click", dongModalUpsertEmployee);

  $("btnThemNhanVienAccount")?.addEventListener("click", () => {
    moModalUpsertEmployee(null);
  });

  $("modalUpsertConfirmBtn")?.addEventListener("click", async () => {
    const maNV = $("upsertMaNV")?.value?.trim();
    const hoTen = $("upsertHoTen")?.value?.trim();
    const boPhan = $("upsertBoPhan")?.value?.trim() || "";
    const khoi = $("upsertKhoi")?.value?.trim() || "";
    const coSo = $("upsertCoSo")?.value?.trim() || "";
    const createAuth = $("upsertChkCreateAccount")?.checked ?? true;

    if (!maNV) {
      showToast("Vui lòng nhập Mã nhân viên.", "warning");
      $("upsertMaNV")?.focus();
      return;
    }
    if (!hoTen) {
      showToast("Vui lòng nhập Họ và tên nhân viên.", "warning");
      $("upsertHoTen")?.focus();
      return;
    }

    const { supabaseUrl, serviceRoleKey } = layThongTinSupabase();
    try {
      const btn = $("modalUpsertConfirmBtn");
      btn.disabled = true;
      btn.textContent = "Đang lưu…";

      const res = await window.api.luuNhanVienPortal({
        supabaseUrl,
        serviceRoleKey,
        employee: { ma_nv: maNV, ho_ten: hoTen, bo_phan: boPhan, khoi, co_so: coSo },
        createAuthAccount: createAuth,
      });

      if (res && res.ok) {
        dongModalUpsertEmployee();
        showToast(`✓ Đã lưu thông tin nhân viên "${maNV}" thành công!`, "success");
        await taiDanhSachAccounts();
      } else {
        showToast(`Lưu thất bại: ${(res && res.error) || "Lỗi"}`, "error");
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message || err}`, "error");
    } finally {
      const btn = $("modalUpsertConfirmBtn");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Lưu thông tin";
      }
    }
  });
}

// ============================================================
// ĐIỀU HƯỚNG TABS NAVBAR (4 CHỨC NĂNG CHÍNH + CÀI ĐẶT)
// ============================================================
let currentTab = "home";
let previousTab = "preview";

function switchTab(tabId) {
  if (!tabId) return;

  // Bắt buộc kiểm tra đồng thời: Phải nhập Tháng lương và nạp file Excel trước khi vào các tab làm việc của kỳ lương
  if (tabId !== "home" && tabId !== "settings" && tabId !== "manage" && tabId !== "accounts") {
    const thangNamVal = $("thangNam")?.value?.trim();
    if (!thangNamVal) {
      showToast("⚠ Vui lòng nhập Tháng lương trước!", "warning");
      switchTab("home");
      const thangNamInput = $("thangNam");
      thangNamInput?.focus();
      thangNamInput?.classList.add("input-error");
      return;
    }
    if (!danhSachNhanVien || danhSachNhanVien.length === 0) {
      showToast("⚠ Vui lòng nạp file Excel bảng lương để tiếp tục!", "warning");
      switchTab("home");
      return;
    }
  }

  if (currentTab !== "settings" && currentTab !== "manage" && currentTab !== "accounts") previousTab = currentTab;
  currentTab = tabId;

  // Cập nhật trạng thái active trên các nút Navbar
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });

  // Hiển thị trang được chọn, ẩn các trang khác
  document.querySelectorAll(".tab-page").forEach((page) => {
    page.hidden = page.dataset.page !== tabId;
  });

  // Kích hoạt render bổ sung theo từng trang
  if (tabId === "preview") {
    renderPreviewTable();
  } else if (tabId === "validation") {
    renderValidationPanel();
  } else if (tabId === "pdf") {
    renderPdfEmployeeTable();
    syncAllCheckboxes();
    capNhatTrangThaiNutXuat();
  } else if (tabId === "email") {
    renderDashboard();
    renderEmailHistoryTable();
    syncAllCheckboxes();
    capNhatTrangThaiNutGuiEmail();
  } else if (tabId === "portal") {
    renderPortalEmployeeTable();
    syncAllCheckboxes();
    capNhatTrangThaiNutPortal();
  } else if (tabId === "manage") {
    taiDanhSachManage();
  } else if (tabId === "accounts") {
    taiDanhSachAccounts();
  } else if (tabId === "settings") {
    capNhatTrangThaiNutPortal();
  }
}

// Lắng nghe sự kiện click trên thanh Navbar
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// Nút Đổi file Excel
$("btnDoiFileExcel")?.addEventListener("click", () => {
  switchTab("home");
});

// Nút Mở cài đặt từ Topbar
$("btnMoCaiDat")?.addEventListener("click", () => {
  switchTab("settings");
});

// Nút Đóng cài đặt quay lại trang trước
$("btnDongCaiDat")?.addEventListener("click", () => {
  if (previousTab && previousTab !== "settings") {
    switchTab(previousTab);
  } else if (danhSachNhanVien.length > 0) {
    switchTab("preview");
  } else {
    switchTab("home");
  }
});

// Nút Lưu cấu hình thủ công trong tab Cài đặt
$("btnLuuCauHinhThuCong")?.addEventListener("click", async () => {
  if ($("chkGhiNhoCauHinh")) $("chkGhiNhoCauHinh").checked = true;
  luuCauHinhNeuBat();
  showToast("✓ Đã lưu cấu hình bảo mật thành công!", "success");
});

// Hàm tương thích ngược nếu còn lời gọi cũ
function goToStep(step) {
  const map = { 1: "home", 2: "preview", 3: "preview", 4: "email", 5: "portal" };
  switchTab(map[step] || "home");
}

function updateStepsNav() {
  // Tabs luôn mở tự do cho người dùng điều hướng
}

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
wireValidationEvents();
wirePdfTableEvents();
wireEmailHistoryEvents();
wirePortalTableEvents();
wireManageEvents();
wireAccountEvents();
capNhatTrangThaiNutXuat();
renderEmailHistoryTable();
renderDashboard();
switchTab("home");
if ($("mainNavbar")) $("mainNavbar").hidden = true;
if ($("heroQuickStats")) $("heroQuickStats").hidden = true;
khoiTaoCauHinhDaLuu();
capNhatNutCuonTrang();

// Sự kiện cho ô nhập Tháng lương bắt buộc
const thangNamInput = $("thangNam");
if (thangNamInput) {
  thangNamInput.addEventListener("input", () => {
    if (thangNamInput.value.trim()) {
      thangNamInput.classList.remove("input-error");
    }
  });
  thangNamInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (thangNamInput.value.trim()) {
        xuLyDocFileExcel();
      } else {
        thangNamInput.classList.add("input-error");
        showToast("⚠ Vui lòng nhập Tháng lương trước!", "warning");
      }
    }
  });
}

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
            if (res.isDev) {
              showToast(res.error, "warning", 5000);
            } else {
              showToast("Chưa thể kiểm tra cập nhật lúc này.", "warning", 3000);
            }
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
