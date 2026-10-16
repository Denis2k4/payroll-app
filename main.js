const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const { autoUpdater } = require("electron-updater");

const EXCEL_EXTENSIONS = new Set([".xlsx", ".xls"]);
const LOGO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const MAX_LOGO_SIZE_BYTES = 4 * 1024 * 1024; // 4MB
const moneyFormatter = new Intl.NumberFormat("vi-VN");

let nodemailer;

function getNodemailer() {
  if (!nodemailer) nodemailer = require("nodemailer");
  return nodemailer;
}

// File lưu cấu hình "ghi nhớ" (Tên công ty, Logo, Tiêu đề/Nội dung email,
// Email Gmail người gửi...) — nằm trong thư mục userData của Electron,
// KHÔNG nằm trong thư mục cài đặt app (tránh lỗi không có quyền ghi).
const CONFIG_PATH = () => path.join(app.getPath("userData"), "cau-hinh.json");

let mainWindow;
let customLogoDataUri = null; // logo do người dùng chọn (ưu tiên hơn logo mặc định)
let customLogoFileName = null;
const PAYSLIP_TEMPLATE_PATH = path.join(
  __dirname,
  "template",
  "payslip-template.html",
);
const DEFAULT_LOGO_PATH = path.join(__dirname, "template", "Logo_PHG_1.png");
let payslipTemplateCache = null;
let defaultLogoCache = null;
let configWriteQueue = Promise.resolve();
let activePdfJob = false;
let activeEmailJob = false;
let previewPdfServer = null;
let previewPdfServerStarting = null;
const browserPreviewPdfs = new Map();
const BROWSER_PREVIEW_TTL_MS = 15 * 60 * 1000;

function getPayslipTemplateHtml() {
  const stat = fs.statSync(PAYSLIP_TEMPLATE_PATH);
  if (
    !payslipTemplateCache ||
    payslipTemplateCache.mtimeMs !== stat.mtimeMs ||
    payslipTemplateCache.size !== stat.size
  ) {
    payslipTemplateCache = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      html: fs.readFileSync(PAYSLIP_TEMPLATE_PATH, "utf8"),
    };
  }
  return payslipTemplateCache.html;
}

function buildPayslipHtml(nv, tenCongTy, thangNam) {
  return applyTemplate(
    getPayslipTemplateHtml(),
    buildTemplateData(nv, tenCongTy, thangNam),
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (previewPdfServer) previewPdfServer.close();
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function processExcelInWorker(filePath) {
  const workerPath = path.join(__dirname, "lib", "excelWorker.js");
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { filePath } });
    let settled = false;

    worker.once("message", (message) => {
      settled = true;
      if (message?.ok) resolve(message.value);
      else reject(new Error(message?.error || "Không thể xử lý file Excel."));
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Tiến trình đọc Excel dừng trước khi trả kết quả (mã ${code}).`));
      }
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  return moneyFormatter.format(Math.round(num(value)));
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, "");
}

function mimeTypeForExt(ext) {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}

function getLogoDataUri() {
  // Ưu tiên logo do người dùng chọn ở Bước "Thiết lập"
  if (customLogoDataUri) return customLogoDataUri;

  if (!fs.existsSync(DEFAULT_LOGO_PATH)) return "";

  const stat = fs.statSync(DEFAULT_LOGO_PATH);
  if (
    !defaultLogoCache ||
    defaultLogoCache.mtimeMs !== stat.mtimeMs ||
    defaultLogoCache.size !== stat.size
  ) {
    const ext = path.extname(DEFAULT_LOGO_PATH).toLowerCase();
    const base64 = fs.readFileSync(DEFAULT_LOGO_PATH).toString("base64");
    defaultLogoCache = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      dataUri: `data:${mimeTypeForExt(ext)};base64,${base64}`,
    };
  }
  return defaultLogoCache.dataUri;
}

function sanitizeFileComponent(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function renderAmountRows(entries) {
  return entries
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td class="amount">${formatMoney(value)}</td></tr>`,
    )
    .join("");
}

function buildTemplateData(nv, tenCongTy, thangNam) {
  const ngayXuat = new Date().toLocaleDateString("vi-VN");
  const cacKhoanNhan = Object.entries(nv.cacKhoanNhan || {});
  const cacKhoanKhauTru = Object.entries(nv.cacKhoanKhauTru || {});

  return {
    tenCongTy: escapeHtml(tenCongTy || "CÔNG TY"),
    ngayXuat: escapeHtml(ngayXuat),
    logoSrc: getLogoDataUri(),
    soPhieuLuong: escapeHtml(nv.maNhanVien || nv.maNV || `NV-${nv.stt || 0}`),
    thangNam: escapeHtml(thangNam || ""),
    hoTen: escapeHtml(nv.hoTen || ""),
    maNhanVien: escapeHtml(nv.maNhanVien || nv.maNV || ""),
    khoi: escapeHtml(nv.khoi || ""),
    boPhan: escapeHtml(nv.boPhan || ""),
    coSo: escapeHtml(nv.coSo || ""),
    chucVu: escapeHtml(nv.chucVu || ""),
    luongChinhThuc: formatMoney(nv.luongChinhThuc),
    luongThuViec: formatMoney(nv.luongThuViec),
    tongThuNhap: formatMoney(nv.tongThuNhap),
    tongKhauTru: formatMoney(nv.tongKhauTru),
    thucNhan: formatMoney(nv.thucNhan),
    tongThuNhapExcel: formatMoney(nv.tongThuNhapExcel),
    tongKhauTruExcel: formatMoney(nv.tongKhauTruExcel),
    thucNhanExcel: formatMoney(nv.thucNhanExcel),
    bangKhoanNhan: renderAmountRows(cacKhoanNhan),
    bangKhoanKhauTru: renderAmountRows(cacKhoanKhauTru),
    khoanKhacRow: nv.khoanKhac
      ? `<tr><td>Các khoản khác</td><td class="amount">${formatMoney(nv.khoanKhac)}</td></tr>`
      : "",
    congChuan: formatNumber(nv.congChuan),
    congDiLamThucTe: formatNumber(nv.ngayCongThucTe ?? nv.congDiLamThucTe),
    ngayCongThucTe: formatNumber(nv.ngayCongThucTe),
    congAl: formatNumber(nv.congAl),
    congClph: formatNumber(nv.congClph),
    congRr: formatNumber(nv.congRr),
    congPh: formatNumber(nv.congPh),
    suDungAlClphRr: formatNumber(
      (Number(nv.congAl) || 0) +
        (Number(nv.congClph) || 0) +
        (Number(nv.congRr) || 0) +
        (Number(nv.congPh) || 0),
    ),
    congLe: formatNumber(nv.congLe),
    congNghiBuCLPH: formatNumber(nv.congNghiBuCLPH),
    congNghiPhep: formatNumber(nv.congNghiPhep),
    tongCong: formatNumber(nv.tongCong),
    congThuViec: formatNumber(nv.congThuViec),
    congChinhThuc: formatNumber(nv.congChinhThuc),
    congPhepTon: formatNumber(nv.congPhepTon),
    congNghiBuLeTon: formatNumber(nv.congNghiBuLeTon),
    soGioNghiBuTangCaTon: formatNumber(nv.soGioNghiBuTangCaTon),
    luongTheoNgayCongThucTe: formatMoney(
      nv.cacKhoanNhan?.["Lương theo ngày công thực tế"],
    ),
    phuCapTrachNhiem: formatMoney(nv.cacKhoanNhan?.["Phụ cấp trách nhiệm"]),
    luongLamThemGio: formatMoney(nv.cacKhoanNhan?.["Lương làm thêm giờ (OT)"]),
    luongNgayLe: formatMoney(nv.cacKhoanNhan?.["Lương ngày lễ"]),
    phuCapCaDem: formatMoney(nv.cacKhoanNhan?.["Phụ cấp ca đêm"]),
    phuCapCaDemLe: formatMoney(nv.cacKhoanNhan?.["Phụ cấp ca đêm Lễ"]),
    tienAnCa: formatMoney(nv.cacKhoanNhan?.["Tiền ăn ca"]),
    tienGuiXe: formatMoney(nv.cacKhoanNhan?.["Tiền gửi xe"]),
    hoTroDienThoai: formatMoney(nv.cacKhoanNhan?.["Hỗ trợ điện thoại"]),
    hoTroDiLai: formatMoney(nv.cacKhoanNhan?.["Hỗ trợ đi lại"]),
    tienSinhNhat: formatMoney(nv.cacKhoanNhan?.["Tiền sinh nhật"]),
    hoTroKhac: formatMoney(nv.cacKhoanNhan?.["Hỗ trợ khác"]),
    thuongLe: formatMoney(nv.cacKhoanNhan?.["Thưởng 30/4 & 1/5"]),
    thuongSvc: formatMoney(
      nv.cacKhoanNhan?.["Thưởng dịch vụ hàng tháng (Service charge)"],
    ),
    thuongSpa: formatMoney(nv.cacKhoanNhan?.["Thưởng hoa hồng Spa"]),
    hoTroNangNong: formatMoney(
      nv.cacKhoanNhan?.["Hỗ trợ nắng nóng Sky Bar (05-09)"],
    ),
    khoanKhac: formatMoney(nv.cacKhoanNhan?.["Khoản khác"]),
    bhxh: formatMoney(nv.cacKhoanKhauTru?.["Bảo hiểm xã hội"]),
    khauTruDiMuonVeSom: formatMoney(
      nv.cacKhoanKhauTru?.["Khấu trừ đi muộn về sớm"],
    ),
    thueTNCN: formatMoney(nv.cacKhoanKhauTru?.["Thuế TNCN"]),
    truyThuTamUng: formatMoney(
      nv.cacKhoanKhauTru?.["Truy thu/Các khoản tạm ứng"],
    ),
    ghiChu: escapeHtml(nv.ghiChu || ""),
    // Chỉ hiển thị khối ghi chú khi có nội dung; nằm ngay dưới dòng
    // "TỔNG THU NHẬP THỰC NHẬN (A - B)" trong phiếu lương.
    ghiChuBlock: nv.ghiChu
      ? `<div class="note-row"><span class="note-label">Ghi chú:</span> ${escapeHtml(nv.ghiChu)}</div>`
      : "",
  };
}

function applyTemplate(templateHtml, data) {
  let html = templateHtml;
  for (const [key, value] of Object.entries(data)) {
    html = html.split(`{{${key}}}`).join(String(value));
  }
  return html;
}

// Tạo buffer PDF cho 1 phiếu lương (dùng chung cho xuất PDF ra file
// và đính kèm PDF khi gửi email — PDF được tạo ngay tại thời điểm dùng,
// không đọc lại từ đĩa).
function createPdfWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });
}

function destroyWindow(window) {
  try {
    if (window && !window.isDestroyed()) window.destroy();
  } catch {
    // Cửa sổ có thể vừa crash/đóng trong lúc cleanup; không giữ tác vụ bị khóa.
  }
}

function clearWindowHistory(window) {
  try {
    if (window && !window.isDestroyed()) window.webContents.clearHistory();
  } catch {
    // Renderer có thể vừa crash/đóng sau khi in xong.
  }
}

async function generatePdfBuffer(nv, tenCongTy, thangNam, sharedPdfWindow) {
  const html = buildPayslipHtml(nv, tenCongTy, thangNam);
  const pdfWindow = sharedPdfWindow || createPdfWindow();
  const ownsWindow = !sharedPdfWindow;

  try {
    if (pdfWindow.isDestroyed()) {
      throw new Error("Cửa sổ tạo PDF đã bị đóng ngoài dự kiến.");
    }
    await pdfWindow.loadURL(
      "data:text/html;charset=UTF-8," + encodeURIComponent(html),
    );
    return await pdfWindow.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { marginType: "none" },
    });
  } finally {
    if (ownsWindow) {
      destroyWindow(pdfWindow);
    } else {
      clearWindowHistory(pdfWindow);
    }
  }
}

function removeExpiredBrowserPreviews() {
  const now = Date.now();
  for (const [token, preview] of browserPreviewPdfs) {
    if (preview.expiresAt <= now) browserPreviewPdfs.delete(token);
  }
}

async function getBrowserPreviewServer() {
  if (previewPdfServer) return previewPdfServer;
  if (previewPdfServerStarting) return previewPdfServerStarting;

  previewPdfServerStarting = new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      removeExpiredBrowserPreviews();
      const match = /^\/preview\/([a-f0-9]+)\.pdf$/.exec(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
      const preview = match && browserPreviewPdfs.get(match[1]);
      if (!preview) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${preview.fileName}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(preview.pdfBuffer);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      previewPdfServer = server;
      previewPdfServerStarting = null;
      resolve(server);
    });
  });

  try {
    return await previewPdfServerStarting;
  } catch (error) {
    previewPdfServerStarting = null;
    throw error;
  }
}

async function openPdfInDefaultBrowser(pdfBuffer, employee) {
  const server = await getBrowserPreviewServer();
  const token = crypto.randomBytes(32).toString("hex");
  const employeeName = String(employee.hoTen || employee.maNhanVien || employee.maNV || "phieu-luong")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  browserPreviewPdfs.set(token, {
    pdfBuffer,
    fileName: `phieu-luong-${employeeName}.pdf`,
    expiresAt: Date.now() + BROWSER_PREVIEW_TTL_MS,
  });
  const { port } = server.address();
  await shell.openExternal(`http://127.0.0.1:${port}/preview/${token}.pdf`);
}

// ---------- Chọn file Excel & đọc dữ liệu ----------
ipcMain.handle("chon-file-excel", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Chọn file Excel danh sách nhân viên",
    filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    properties: ["openFile"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];

  // ---------- 1a. Kiểm tra định dạng file ----------
  const ext = path.extname(filePath).toLowerCase();
  if (!EXCEL_EXTENSIONS.has(ext)) {
    return {
      error: `Định dạng file không hợp lệ ("${ext || "không rõ"}"). Vui lòng chọn file .xlsx hoặc .xls.`,
    };
  }

  let processed;
  try {
    processed = await processExcelInWorker(filePath);
  } catch (err) {
    return {
      error: `Không thể đọc file Excel. File có thể bị hỏng hoặc không đúng định dạng bảng tính. (${err.message})`,
    };
  }

  if (processed.rowCount === 0) {
    return {
      error: "Không tìm thấy dòng dữ liệu hợp lệ nào trong file Excel.",
    };
  }

  return {
    filePath,
    data: processed.data,
    validation: processed.validation,
    formatWarning: processed.formatWarning,
  };
});

// ---------- Tải file Excel mẫu về máy ----------
ipcMain.handle("tai-file-mau", async () => {
  const templatePath = path.join(
    __dirname,
    "template",
    "mau-danh-sach-nhan-vien.xlsx",
  );

  if (!fs.existsSync(templatePath)) {
    return { error: "Không tìm thấy file Excel mẫu trong ứng dụng." };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Lưu file Excel mẫu",
    defaultPath: "mau-danh-sach-nhan-vien.xlsx",
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });

  if (result.canceled || !result.filePath) return null;

  try {
    await fs.promises.copyFile(templatePath, result.filePath);
  } catch (err) {
    return { error: `Không thể lưu file mẫu. (${err.message})` };
  }

  return { savedPath: result.filePath };
});

// ---------- Chọn logo công ty (dùng cho phiếu lương PDF) ----------
ipcMain.handle("chon-logo", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Chọn ảnh logo công ty",
    filters: [{ name: "Ảnh", extensions: ["png", "jpg", "jpeg", "svg"] }],
    properties: ["openFile"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();

  if (!LOGO_EXTENSIONS.has(ext)) {
    return {
      error: `Định dạng ảnh không hợp lệ ("${ext || "không rõ"}"). Vui lòng chọn file .png, .jpg hoặc .svg.`,
    };
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    return { error: `Không thể đọc file ảnh. (${err.message})` };
  }

  if (stat.size > MAX_LOGO_SIZE_BYTES) {
    return {
      error: "File ảnh quá lớn (tối đa 4MB). Vui lòng chọn ảnh nhỏ hơn.",
    };
  }

  let base64;
  try {
    base64 = (await fs.promises.readFile(filePath)).toString("base64");
  } catch (err) {
    return { error: `Không thể đọc file ảnh. (${err.message})` };
  }

  const dataUri = `data:${mimeTypeForExt(ext)};base64,${base64}`;
  customLogoDataUri = dataUri;
  customLogoFileName = path.basename(filePath);

  return { filePath, fileName: customLogoFileName, dataUri };
});

// ---------- Xóa logo tùy chỉnh, quay về logo mặc định ----------
ipcMain.handle("xoa-logo", async () => {
  customLogoDataUri = null;
  customLogoFileName = null;
  return true;
});

// ---------- Chọn thư mục lưu PDF ----------
ipcMain.handle("chon-thu-muc-luu", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Chọn thư mục lưu phiếu lương PDF",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---------- Xuất PDF cho toàn bộ nhân viên (có báo tiến độ) ----------
ipcMain.handle(
  "xuat-pdf",
  async (event, { danhSach, thuMucLuu, tenCongTy, thangNam }) => {
    if (activePdfJob) {
      return {
        thanhCong: [],
        loi: [],
        tongSo: danhSach.length,
        busy: true,
        message: "Một tác vụ xuất PDF khác đang chạy. Vui lòng đợi tác vụ hiện tại hoàn tất.",
      };
    }
    activePdfJob = true;
    const tongSo = danhSach.length;
    const thanhCong = [];
    const loi = [];
    let pdfWindow = null;

    try {
      for (let i = 0; i < danhSach.length; i++) {
        const nv = danhSach[i];
        const maNhanVien = sanitizeFileComponent(
          nv.maNhanVien || nv.maNV || "NV",
        );
        const hoTen = sanitizeFileComponent(nv.hoTen || "Nhan vien");

        try {
          if (!pdfWindow || pdfWindow.isDestroyed()) {
            pdfWindow = createPdfWindow();
          }
          const pdfBuffer = await generatePdfBuffer(
            nv,
            tenCongTy,
            thangNam,
            pdfWindow,
          );
          const outputPath = path.join(
            thuMucLuu,
            `PL_${maNhanVien}_${hoTen}.pdf`,
          );
          await fs.promises.writeFile(outputPath, pdfBuffer);
          thanhCong.push(outputPath);
        } catch (err) {
          // Một phiếu lỗi không làm dừng cả lô — ghi nhận lại và xuất tiếp các phiếu còn lại.
          loi.push({
            maNV: nv.maNhanVien || nv.maNV || "",
            hoTen: nv.hoTen || "",
            message: err.message || String(err),
          });
          // Tạo lại renderer sau lỗi để phiếu sau không kế thừa trạng thái hỏng.
          destroyWindow(pdfWindow);
          pdfWindow = null;
        }

        if (!event.sender.isDestroyed()) {
          event.sender.send("xuat-pdf-tien-do", {
            daXong: i + 1,
            tongSo,
            maNV: nv.maNhanVien || nv.maNV || "",
            hoTen: nv.hoTen || "",
          });
        }
      }

      return { thanhCong, loi, tongSo };
    } finally {
      destroyWindow(pdfWindow);
      activePdfJob = false;
    }
  },
);

// ============================================================
// LƯU / TẢI CẤU HÌNH (Ghi nhớ cấu hình) — dùng chung cho các trường:
// Tên công ty, Logo, Tiêu đề Email, Nội dung HTML, Email Gmail người gửi.
// Mật khẩu ứng dụng Gmail được mã hoá bằng Electron safeStorage (gắn với
// máy/tài khoản hệ điều hành hiện tại) trước khi ghi ra đĩa; nếu máy không
// hỗ trợ mã hoá, mật khẩu sẽ KHÔNG được lưu để tránh lộ thông tin.
// ============================================================

ipcMain.handle("luu-cau-hinh", async (event, cauHinh) => {
  try {
    const data = {
      tenCongTy: cauHinh?.tenCongTy || "",
      emailTieuDe: cauHinh?.emailTieuDe || "",
      emailNoiDung: cauHinh?.emailNoiDung || "",
      emailNguoiGui: cauHinh?.emailNguoiGui || "",
      logoDataUri: customLogoDataUri || "",
      logoFileName: customLogoFileName || "",
      matKhauMaHoa: null,
      matKhauKhaDung: false,
    };

    const matKhau = cauHinh?.emailMatKhauUngDung || "";
    if (matKhau) {
      if (safeStorage.isEncryptionAvailable()) {
        data.matKhauMaHoa = safeStorage
          .encryptString(matKhau)
          .toString("base64");
        data.matKhauKhaDung = true;
      }
      // Nếu máy không hỗ trợ mã hoá, cố tình BỎ QUA không lưu mật khẩu.
    }

    const serialized = JSON.stringify(data, null, 2);
    const writeTask = configWriteQueue.catch(() => {}).then(async () => {
      await fs.promises.mkdir(path.dirname(CONFIG_PATH()), { recursive: true });
      await fs.promises.writeFile(CONFIG_PATH(), serialized, "utf8");
    });
    configWriteQueue = writeTask;
    await writeTask;

    return { ok: true, daLuuMatKhau: data.matKhauKhaDung };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle("tai-cau-hinh", async () => {
  try {
    const readTask = configWriteQueue.catch(() => {}).then(async () => {
      try {
        return await fs.promises.readFile(CONFIG_PATH(), "utf8");
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    });
    configWriteQueue = readTask.then(() => undefined);
    const raw = await readTask;
    if (raw === null) return null;
    const data = JSON.parse(raw);

    // Khôi phục logo tuỳ chỉnh vào bộ nhớ tiến trình chính để PDF/preview
    // dùng đúng logo đã lưu, không cần người dùng chọn lại.
    customLogoDataUri = data.logoDataUri || null;
    customLogoFileName = data.logoDataUri ? data.logoFileName || null : null;

    let matKhauUngDung = "";
    if (data.matKhauMaHoa && safeStorage.isEncryptionAvailable()) {
      try {
        matKhauUngDung = safeStorage.decryptString(
          Buffer.from(data.matKhauMaHoa, "base64"),
        );
      } catch {
        matKhauUngDung = ""; // không giải mã được (đổi máy/tài khoản...) — bỏ qua
      }
    }

    return {
      tenCongTy: data.tenCongTy || "",
      emailTieuDe: data.emailTieuDe || "",
      emailNoiDung: data.emailNoiDung || "",
      emailNguoiGui: data.emailNguoiGui || "",
      emailMatKhauUngDung: matKhauUngDung,
      logoDataUri: data.logoDataUri || "",
      logoFileName: data.logoFileName || "",
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle("xoa-cau-hinh", async () => {
  try {
    const deleteTask = configWriteQueue.catch(() => {}).then(async () => {
      try {
        await fs.promises.unlink(CONFIG_PATH());
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    });
    configWriteQueue = deleteTask;
    await deleteTask;
    return true;
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

// ---------- Xem trước PDF cho 1 nhân viên ----------
ipcMain.handle(
  "xem-truoc-pdf",
  async (event, { nhanVien, tenCongTy, thangNam }) => {
    if (!nhanVien) return null;

    const pdfBuffer = await generatePdfBuffer(nhanVien, tenCongTy, thangNam);
    await openPdfInDefaultBrowser(pdfBuffer, nhanVien);
    return true;
  },
);

// ============================================================
// GỬI EMAIL PHIẾU LƯƠNG (Gmail SMTP qua nodemailer)
// ============================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getValidEmployeeEmail(nv) {
  const email = String(nv.email || "").trim();
  if (!email) {
    throw new Error("Nhân viên chưa có địa chỉ email trong file Excel.");
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`Địa chỉ email không hợp lệ: "${email}".`);
  }
  return email;
}

// Thay thế các placeholder {{...}} trong tiêu đề/nội dung email bằng
// thông tin của nhân viên. Không escape HTML vì nội dung email gửi dạng text.
function applyEmailTemplate(template, nv, tenCongTy, thangNam) {
  const data = {
    hoTen: nv.hoTen || "",
    maNhanVien: nv.maNhanVien || nv.maNV || "",
    boPhan: nv.boPhan || "",
    chucVu: nv.chucVu || "",
    tenCongTy: tenCongTy || "",
    thangNam: thangNam || "",
  };
  let result = String(template ?? "");
  for (const [key, value] of Object.entries(data)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  return result;
}

// Giống applyEmailTemplate nhưng escape HTML các giá trị chèn vào, dùng cho
// nội dung email dạng HTML để tránh vỡ giao diện hoặc lỗi hiển thị khi
// họ tên/bộ phận... có ký tự đặc biệt (&, <, >...).
function applyEmailTemplateHtml(template, nv, tenCongTy, thangNam) {
  const data = {
    hoTen: escapeHtml(nv.hoTen || ""),
    maNhanVien: escapeHtml(nv.maNhanVien || nv.maNV || ""),
    boPhan: escapeHtml(nv.boPhan || ""),
    chucVu: escapeHtml(nv.chucVu || ""),
    tenCongTy: escapeHtml(tenCongTy || ""),
    thangNam: escapeHtml(thangNam || ""),
  };
  let result = String(template ?? "");
  for (const [key, value] of Object.entries(data)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  return result;
}

function taoTransporterGmail(taiKhoanGmail, transportOptions = {}) {
  const { email, matKhauUngDung } = taiKhoanGmail || {};
  if (!email || !matKhauUngDung) {
    throw new Error(
      "Thiếu email Gmail hoặc mật khẩu ứng dụng. Vui lòng nhập ở khung Thiết lập.",
    );
  }
  return getNodemailer().createTransport({
    service: "gmail",
    ...transportOptions,
    auth: { user: email, pass: matKhauUngDung },
  });
}

// Gửi phiếu lương cho 1 nhân viên. PDF được tạo mới ngay lúc gửi
// (không đọc lại file đã xuất trước đó).
async function guiEmailChoNhanVien({
  nv,
  tenCongTy,
  thangNam,
  taiKhoanGmail,
  tieuDe,
  noiDung,
  transporter,
  pdfWindow,
}) {
  const email = getValidEmployeeEmail(nv);

  const mailTransporter = transporter || taoTransporterGmail(taiKhoanGmail);
  const pdfBuffer = await generatePdfBuffer(
    nv,
    tenCongTy,
    thangNam,
    pdfWindow,
  );
  const maNhanVien = sanitizeFileComponent(nv.maNhanVien || nv.maNV || "NV");
  const hoTen = sanitizeFileComponent(nv.hoTen || "Nhan vien");

  const subject = applyEmailTemplate(
    tieuDe || "Phiếu lương tháng {{thangNam}}",
    nv,
    tenCongTy,
    thangNam,
  );
  const text = applyEmailTemplateHtml(
    noiDung ||
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#333;max-width:650px">
        <p>Kính gửi Anh/Chị <strong>{{hoTen}}</strong>,</p>
        <p>Gửi bạn phiếu lương tháng <strong>{{thangNam}}</strong> (đính kèm file PDF).</p>
        <p>Trân trọng.</p>
      </div>`,
    nv,
    tenCongTy,
    thangNam,
  );

  await mailTransporter.sendMail({
    from: taiKhoanGmail.email,
    to: email,
    subject,
    html: text,
    attachments: [
      {
        filename: `PL_${maNhanVien}_${hoTen}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  return { email };
}

// ---------- Gửi email cho 1 nhân viên ----------
ipcMain.handle(
  "gui-email",
  async (
    event,
    { nhanVien, tenCongTy, thangNam, taiKhoanGmail, tieuDe, noiDung },
  ) => {
    try {
      const ketQua = await guiEmailChoNhanVien({
        nv: nhanVien,
        tenCongTy,
        thangNam,
        taiKhoanGmail,
        tieuDe,
        noiDung,
      });
      return { ok: true, email: ketQua.email };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  },
);

// ---------- Gửi email hàng loạt (có báo tiến độ) ----------
ipcMain.handle(
  "gui-email-hang-loat",
  async (
    event,
    { danhSach, tenCongTy, thangNam, taiKhoanGmail, tieuDe, noiDung },
  ) => {
    if (activeEmailJob) {
      return {
        thanhCong: [],
        loi: [],
        tongSo: danhSach.length,
        busy: true,
        message: "Một tác vụ gửi email khác đang chạy. Vui lòng đợi tác vụ hiện tại hoàn tất.",
      };
    }
    activeEmailJob = true;
    const tongSo = danhSach.length;
    const thanhCong = [];
    const loi = [];
    let pdfWindow = null;
    let transporter = null;

    try {
      for (let i = 0; i < danhSach.length; i++) {
        const nv = danhSach[i];
        try {
          getValidEmployeeEmail(nv);
          if (!transporter) {
            transporter = taoTransporterGmail(taiKhoanGmail, {
              pool: true,
              maxConnections: 1,
              maxMessages: 100,
            });
          }
          if (!pdfWindow || pdfWindow.isDestroyed()) {
            pdfWindow = createPdfWindow();
          }
          await guiEmailChoNhanVien({
            nv,
            tenCongTy,
            thangNam,
            taiKhoanGmail,
            tieuDe,
            noiDung,
            transporter,
            pdfWindow,
          });
          thanhCong.push({
            maNV: nv.maNhanVien || nv.maNV || "",
            hoTen: nv.hoTen || "",
            email: nv.email || "",
          });
        } catch (err) {
          loi.push({
            maNV: nv.maNhanVien || nv.maNV || "",
            hoTen: nv.hoTen || "",
            email: nv.email || "",
            message: err.message || String(err),
          });
          // Mọi lỗi đều tái tạo renderer cho nhân viên sau; tránh giữ trạng thái
          // điều hướng/in ấn hỏng, kể cả khi BrowserWindow chưa bị destroy.
          destroyWindow(pdfWindow);
          pdfWindow = null;
        }

        if (!event.sender.isDestroyed()) {
          event.sender.send("gui-email-tien-do", {
            daXong: i + 1,
            tongSo,
            maNV: nv.maNhanVien || nv.maNV || "",
            hoTen: nv.hoTen || "",
          });
        }
      }

      return { thanhCong, loi, tongSo };
    } finally {
      destroyWindow(pdfWindow);
      if (transporter) {
        try {
          transporter.close();
        } catch {
          // Kết quả gửi đã được ghi nhận; lỗi dọn pool không làm đổi kết quả lô.
        }
      }
      activeEmailJob = false;
    }
  },
);

// ============================================================
// AUTO-UPDATER (electron-updater)
// Kiểm tra phiên bản mới trên GitHub Releases khi khởi động.
// Nếu có bản mới → tự tải về → thông báo cho người dùng →
// cài đặt khi người dùng đồng ý (hoặc khi thoát app).
// ============================================================

function sendUpdateStatus(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function setupAutoUpdater() {
  // Cấu hình autoUpdater
  autoUpdater.autoDownload = true;       // Tự tải bản mới về ngầm
  autoUpdater.autoInstallOnAppQuit = true; // Tự cài khi thoát app

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus("cap-nhat-trang-thai", {
      status: "checking",
      message: "Đang kiểm tra phiên bản mới…",
    });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus("cap-nhat-trang-thai", {
      status: "available",
      message: `Phiên bản mới ${info.version} đang được tải về…`,
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus("cap-nhat-trang-thai", {
      status: "up-to-date",
      message: "Ứng dụng đang ở phiên bản mới nhất.",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus("cap-nhat-trang-thai", {
      status: "downloading",
      message: `Đang tải: ${Math.round(progress.percent)}%`,
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus("cap-nhat-trang-thai", {
      status: "ready",
      message: `Phiên bản ${info.version} đã sẵn sàng. Khởi động lại để cập nhật.`,
      version: info.version,
    });
  });

  autoUpdater.on("error", (err) => {
    // Không hiển thị lỗi quá nhiều cho user — chỉ log nếu cần debug.
    sendUpdateStatus("cap-nhat-trang-thai", {
      status: "error",
      message: `Lỗi kiểm tra cập nhật: ${err.message || err}`,
    });
  });

  // Kiểm tra cập nhật sau khi app khởi động (đợi 3 giây để UI load xong)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Không có mạng hoặc chưa cấu hình repo — bỏ qua im lặng.
    });
  }, 3000);
}

// Người dùng bấm nút "Cài đặt & Khởi động lại"
ipcMain.handle("cai-dat-cap-nhat", () => {
  autoUpdater.quitAndInstall(false, true);
});

// Người dùng bấm nút "Kiểm tra cập nhật" thủ công
ipcMain.handle("kiem-tra-cap-nhat", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version || null };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
