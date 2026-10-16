// ============================================================
// LOGIC TÍNH PHIẾU LƯƠNG - DỰA TRÊN FILE EXCEL "mau-danh-sach-nhan-vien.xlsx"
// Nguyên tắc: KHÔNG tự tính BHXH/BHYT/BHTN hay thuế TNCN theo công thức.
// Toàn bộ các khoản (bảo hiểm, thuế, khấu trừ...) đã được nhập sẵn theo
// từng cột trong Excel. Ba dòng tổng "Tổng thu nhập (A)", "Tổng khấu trừ (B)"
// và "TỔNG THU NHẬP THỰC NHẬN" đều KHÔNG tự cộng/tính lại mà lấy trực tiếp
// từ các cột tổng đã có sẵn trong file Excel. Chi tiết từng khoản mục vẫn
// được đọc riêng để hiển thị các dòng trong bảng lương.
//
// Mẫu Excel hiện tại chỉ còn 40 cột (0-39), không còn cột trùng tên như
// trước. Vẫn giữ cách đọc theo VỊ TRÍ CỘT (mảng, header:1) để không phụ
// thuộc vào tên cột hiển thị (có thể xuống dòng/khoảng trắng khác nhau).
// ============================================================

// Chỉ số cột (0-based) theo đúng thứ tự trong file Excel (45 cột: 0-44):
const COL = {
  TT: 0,
  MA_NV: 1,
  KHOI: 2,
  CO_SO: 3,
  BO_PHAN: 4,
  HO_TEN: 5,
  CHUC_VU: 6,

  // ---- LƯƠNG CƠ BẢN ----
  LUONG_CHINH_THUC: 7, // Lương chính thức
  LUONG_THU_VIEC: 8, // Lương thử việc

  // ---- CHẤM CÔNG ----
  CONG_TIEU_CHUAN: 9, // Công tiêu chuẩn
  CONG_THU_VIEC: 10, // Công Thử việc
  CONG_CHINH_THUC: 11, // Công Chính thức
  SO_CONG_AL: 12, // Số công ngày nghỉ phép (AL)
  SO_CONG_CLPH: 13, // Số công ngày nghỉ bù (CLPH)
  SO_CONG_RR: 14, // Số công ngày nghỉ bù (RR)
  SO_CONG_PH: 15, // Số công ngày nghĩ lễ (PH)
  NGAY_CONG_THUC_TE: 16, // Ngày công thực tế đi làm
  TONG_CONG: 17, // Tổng công

  // ---- CÁC KHOẢN ĐƯỢC NHẬN (A) ----
  LUONG_THEO_NGAY_CONG_THUC_TE: 18, // Lương theo ngày công đi làm thực tế
  PHU_CAP_TRACH_NHIEM: 19, // Phụ cấp trách nhiệm
  THUONG_KPI: 20, // Thưởng KPI
  PHU_CAP_CA_DEM: 21, // Phụ cấp ca đêm
  PHU_CAP_CA_DEM_LE: 22, // Phụ cấp ca đêm lễ
  LUONG_LAM_THEM_GIO: 23, // Lương làm thêm giờ (OT)
  LUONG_NGAY_LE: 24, // Lương ngày lễ
  TIEN_AN_CA: 25, // Tiền ăn ca
  TIEN_GUI_XE: 26, // Tiền gửi xe
  HO_TRO_DIEN_THOAI: 27, // Hỗ trợ điện thoại
  HO_TRO_DI_LAI: 28, // Hỗ trợ đi lại
  HO_TRO_KHAC: 29, // Hỗ trợ khác
  HO_TRO_NANG_NONG: 30, // Hỗ trợ nắng nóng (05-09)
  TIEN_SINH_NHAT: 31, // Tiền sinh nhật
  THUONG_DICH_VU_SVC: 32, // Thưởng dịch vụ hằng tháng (SVC)
  THUONG_HOA_HONG_SPA: 33, // Thưởng Hoa hồng Spa
  THUONG_LE: 34, // Thưởng nghỉ lễ

  // Cột tổng có sẵn trong Excel, lấy trực tiếp làm Tổng thu nhập (A)
  TONG_THU_NHAP_EXCEL: 35,

  // ---- CÁC KHOẢN KHẤU TRỪ (B) ----
  KHAU_TRU_DI_MUON_VE_SOM: 36, // Khấu trừ đi muộn về sớm
  BHXH_NLD: 37, // Bảo hiểm xã hội
  THUE_TNCN: 38, // Thuế TNCN (đã tính sẵn, không tự tính lại)
  TRUY_THU_TAM_UNG: 39, // Truy thu lương/Các khoản tạm ứng

  // Cột tổng có sẵn trong Excel, lấy trực tiếp làm Tổng khấu trừ (B)
  TONG_KHAU_TRU_EXCEL: 40,

  KHOAN_KHAC: 41, // Các khoản khác (nằm sau Tổng khấu trừ, trước Thực nhận)

  THUC_NHAN_EXCEL: 42,

  // ---- CÁC CỘT BỔ SUNG ----
  GHI_CHU: 43, // Ghi chú, hiển thị bên dưới dòng "Tổng thu nhập thực nhận (A-B)" trong phiếu lương
  EMAIL: 44, // Email nhân viên, dùng để gửi phiếu lương
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tính phiếu lương cho 1 nhân viên (dạng đơn giản A - B như mẫu ảnh).
 * @param {Array} row - 1 dòng dữ liệu Excel dạng mảng (đọc bằng header:1)
 */
function tinhPhieuLuong(row) {
  // ---------- A. CÁC KHOẢN ĐƯỢC NHẬN ----------
  const cacKhoanNhan = {
    "Lương theo ngày công thực tế": num(row[COL.LUONG_THEO_NGAY_CONG_THUC_TE]),
    "Phụ cấp trách nhiệm": num(row[COL.PHU_CAP_TRACH_NHIEM]),
    "Lương làm thêm giờ (OT)": num(row[COL.LUONG_LAM_THEM_GIO]),
    "Lương ngày lễ": num(row[COL.LUONG_NGAY_LE]),
    "Phụ cấp ca đêm": num(row[COL.PHU_CAP_CA_DEM]),
    "Phụ cấp ca đêm Lễ": num(row[COL.PHU_CAP_CA_DEM_LE]),
    "Tiền ăn ca": num(row[COL.TIEN_AN_CA]),
    "Tiền gửi xe": num(row[COL.TIEN_GUI_XE]),
    "Hỗ trợ điện thoại": num(row[COL.HO_TRO_DIEN_THOAI]),
    "Hỗ trợ đi lại": num(row[COL.HO_TRO_DI_LAI]),
    "Tiền sinh nhật": num(row[COL.TIEN_SINH_NHAT]),
    "Hỗ trợ khác": num(row[COL.HO_TRO_KHAC]),
    "Thưởng nghỉ lễ": num(row[COL.THUONG_LE]),
    "Thưởng dịch vụ hàng tháng (Service charge)": num(
      row[COL.THUONG_DICH_VU_SVC],
    ),
    "Thưởng hoa hồng Spa": num(row[COL.THUONG_HOA_HONG_SPA]),
    "Hỗ trợ nắng nóng (05-09)": num(row[COL.HO_TRO_NANG_NONG]),
    "Thưởng KPI": num(row[COL.THUONG_KPI]),
  };

  const tongThuNhap = num(row[COL.TONG_THU_NHAP_EXCEL]);

  // ---------- B. CÁC KHOẢN KHẤU TRỪ ----------
  const cacKhoanKhauTru = {
    "Khấu trừ đi muộn về sớm": num(row[COL.KHAU_TRU_DI_MUON_VE_SOM]),
    "Bảo hiểm xã hội": num(row[COL.BHXH_NLD]),
    "Thuế TNCN": num(row[COL.THUE_TNCN]),
    "Truy thu/Các khoản tạm ứng": num(row[COL.TRUY_THU_TAM_UNG]),
  };

  const tongKhauTru = num(row[COL.TONG_KHAU_TRU_EXCEL]);

  // "Các khoản khác" nằm SAU dòng Tổng khấu trừ (B), trước Thực nhận
  const khoanKhac = num(row[COL.KHOAN_KHAC]);

  // ---------- C. THỰC NHẬN: lấy trực tiếp từ cột Excel, KHÔNG tự tính A - B ----------
  const thucNhan = num(row[COL.THUC_NHAN_EXCEL]);

  return {
    maNV: row[COL.MA_NV] || "",
    khoi: row[COL.KHOI] || "",
    coSo: row[COL.CO_SO] || "",
    boPhan: row[COL.BO_PHAN] || "",
    hoTen: row[COL.HO_TEN] || "",
    chucVu: row[COL.CHUC_VU] || "",
    tinhTrang: "",

    luongChinhThuc: num(row[COL.LUONG_CHINH_THUC]),
    luongThuViec: num(row[COL.LUONG_THU_VIEC]),

    congChuan: num(row[COL.CONG_TIEU_CHUAN]),
    congThuViec: num(row[COL.CONG_THU_VIEC]),
    congChinhThuc: num(row[COL.CONG_CHINH_THUC]),
    congAl: num(row[COL.SO_CONG_AL]),
    congClph: num(row[COL.SO_CONG_CLPH]),
    congRr: num(row[COL.SO_CONG_RR]),
    congPh: num(row[COL.SO_CONG_PH]),
    ngayCongThucTe: num(row[COL.NGAY_CONG_THUC_TE]),
    tongCong: num(row[COL.TONG_CONG]),

    cacKhoanNhan, // chi tiết từng dòng bên trái bảng
    tongThuNhap, // A

    cacKhoanKhauTru, // chi tiết từng dòng bên phải bảng
    tongKhauTru, // B
    khoanKhac, // nằm sau Tổng khấu trừ (B), trước Thực nhận

    thucNhan, // lấy trực tiếp từ Excel => "TỔNG THU NHẬP THỰC NHẬN"

    ghiChu: String(row[COL.GHI_CHU] ?? "").trim(),
    email: String(row[COL.EMAIL] ?? "").trim(),
  };
}

module.exports = { tinhPhieuLuong };
