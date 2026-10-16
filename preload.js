const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chonFileExcel: () => ipcRenderer.invoke("chon-file-excel"),
  taiFileMau: () => ipcRenderer.invoke("tai-file-mau"),
  chonLogo: () => ipcRenderer.invoke("chon-logo"),
  xoaLogo: () => ipcRenderer.invoke("xoa-logo"),
  chonThuMucLuu: () => ipcRenderer.invoke("chon-thu-muc-luu"),
  xuatPdf: (payload) => ipcRenderer.invoke("xuat-pdf", payload),
  xemTruocPdf: (payload) => ipcRenderer.invoke("xem-truoc-pdf", payload),
  onXuatPdfTienDo: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("xuat-pdf-tien-do", listener);
    return () => ipcRenderer.removeListener("xuat-pdf-tien-do", listener);
  },
  guiEmail: (payload) => ipcRenderer.invoke("gui-email", payload),
  guiEmailHangLoat: (payload) =>
    ipcRenderer.invoke("gui-email-hang-loat", payload),
  onGuiEmailTienDo: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("gui-email-tien-do", listener);
    return () => ipcRenderer.removeListener("gui-email-tien-do", listener);
  },
  luuCauHinh: (payload) => ipcRenderer.invoke("luu-cau-hinh", payload),
  taiCauHinh: () => ipcRenderer.invoke("tai-cau-hinh"),
  xoaCauHinh: () => ipcRenderer.invoke("xoa-cau-hinh"),
  kiemTraGiayPhep: () => ipcRenderer.invoke("kiem-tra-giay-phep"),
  kichHoatMa: (maNhap) => ipcRenderer.invoke("kich-hoat-ma", maNhap),

  // ---------- Auto-update ----------
  onCapNhatTrangThai: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("cap-nhat-trang-thai", listener);
    return () => ipcRenderer.removeListener("cap-nhat-trang-thai", listener);
  },
  caiDatCapNhat: () => ipcRenderer.invoke("cai-dat-cap-nhat"),
  kiemTraCapNhat: () => ipcRenderer.invoke("kiem-tra-cap-nhat"),
});
