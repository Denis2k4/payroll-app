# HeheHR — Xuất phiếu lương nhân viên

HeheHR là ứng dụng desktop dành cho Windows, dùng để nhập danh sách nhân viên từ Excel, kiểm tra dữ liệu, xem trước phiếu lương, xuất PDF và gửi phiếu lương qua Gmail.

Việc đọc Excel, kiểm tra dữ liệu, xem trước và xuất PDF đều chạy cục bộ, không cần máy chủ. Chỉ chức năng gửi email cần kết nối Internet.

## Tính năng chính

- Đọc file `.xlsx` hoặc `.xls` theo mẫu 44 cột cố định.
- Kiểm tra tiêu đề, số lượng cột, trường bắt buộc, định dạng số, mã nhân viên trùng và giá trị âm.
- Tìm kiếm, lọc, sắp xếp và chọn nhân viên ngay trên bảng xem trước.
- Xem trước phiếu lương của từng nhân viên trước khi xuất.
- Xuất PDF cho một người, nhóm đã chọn hoặc toàn bộ danh sách, kèm tiến độ xử lý.
- Dùng logo mặc định hoặc logo riêng của công ty.
- Gửi Gmail cho một người, nhóm đã chọn hoặc toàn bộ danh sách; PDF được tạo và đính kèm tự động.
- Ghi nhớ tên công ty, logo và cấu hình email trên máy đang sử dụng.

## Yêu cầu hệ thống

- Windows 10/11.
- Node.js từ phiên bản 20 trở lên nếu chạy từ mã nguồn.
- Kết nối Internet khi cài thư viện, đóng gói ứng dụng hoặc gửi email.

Người dùng cài ứng dụng bằng file `.exe` đã đóng gói không cần cài Node.js.

## Cài đặt và chạy từ mã nguồn

```bash
npm install
npm start
```

Nếu PowerShell chặn file `npm.ps1`, dùng các lệnh tương ứng sau hoặc chạy lệnh trong Command Prompt:

```powershell
npm.cmd install
npm.cmd start
```

## Chuẩn bị file Excel

Tải file mẫu bằng liên kết **Tải file Excel cấu trúc mẫu** trong ứng dụng hoặc dùng file:

```text
template/mau-danh-sach-nhan-vien.xlsx
```

Khi nhập dữ liệu, cần lưu ý:

- Ứng dụng chỉ đọc worksheet đầu tiên.
- Mẫu hiện có 44 cột, từ `TT` đến `Email`.
- Phải giữ nguyên tên và thứ tự các cột. Dữ liệu được ánh xạ theo vị trí cột, không chỉ theo tên hiển thị.
- Nên đặt dòng tiêu đề trong 10 dòng đầu của worksheet.
- Các trường bắt buộc trên mỗi dòng gồm `Mã NV`, `Khối`, `Cơ sở`, `Bộ phận`, `Họ tên` và `Chức vụ`.
- Cột `Email` cần có địa chỉ hợp lệ nếu gửi phiếu lương qua Gmail.
- Nên nhập các khoản tiền và ngày công bằng ô số trong Excel.

Ứng dụng sẽ hiển thị lỗi hoặc cảnh báo ở bước **Kiểm tra dữ liệu**. Các cảnh báo này không tự khóa chức năng xuất/gửi, vì vậy hãy kiểm tra và sửa dữ liệu trước khi tiếp tục.

### Nguyên tắc lấy số liệu lương

Ứng dụng không tự tính BHXH, thuế TNCN, tổng thu nhập, tổng khấu trừ hoặc thực nhận. Các giá trị sau được lấy trực tiếp từ file Excel:

- `Tổng thu nhập` → Tổng thu nhập (A).
- `Tổng các khoản khấu trừ` → Tổng khấu trừ (B).
- `Các khoản khác` → dòng riêng sau tổng khấu trừ.
- `Thực nhận` → Tổng thu nhập thực nhận.

Các cột chi tiết vẫn được đọc riêng để hiển thị trên phiếu lương. Vì vậy, cần bảo đảm các cột tổng trong Excel đã chứa kết quả cuối cùng chính xác.

## Cách sử dụng

1. Nhập **Tên công ty**, **Tháng lương** và chọn logo nếu cần.
2. Bấm **Chọn file Excel** rồi chọn file theo đúng cấu trúc mẫu.
3. Mở bước **Xem trước dữ liệu** để tìm kiếm, lọc, sắp xếp, chọn nhân viên hoặc xem trước PDF từng người.
4. Mở bước **Kiểm tra dữ liệu** và xử lý các lỗi/cảnh báo được phát hiện.
5. Bấm **Chọn thư mục lưu**, sau đó xuất PDF cho từng người, nhóm đã chọn hoặc toàn bộ danh sách.

Tên file PDF có dạng:

```text
PL_<MaNV>_<HoTen>.pdf
```

Nếu thư mục đích đã có file trùng tên, file cũ sẽ bị ghi đè. Nên dùng thư mục riêng cho từng kỳ lương.

## Gửi phiếu lương qua Gmail

Để gửi email, cần chuẩn bị:

- Tài khoản Gmail người gửi.
- Mật khẩu ứng dụng Gmail, không phải mật khẩu đăng nhập thông thường.
- Địa chỉ người nhận trong cột `Email` của file Excel.
- Kết nối Internet ổn định.

Nhập tài khoản, mật khẩu ứng dụng, tiêu đề và nội dung email ở mục **Gửi Email (Gmail)**. Có thể gửi cho từng người, nhóm đã chọn hoặc toàn bộ danh sách. Không cần xuất PDF trước; ứng dụng tạo PDF mới tại thời điểm gửi và đính kèm trực tiếp vào email.

Tiêu đề và nội dung email hỗ trợ các placeholder:

```text
{{hoTen}}
{{maNhanVien}}
{{boPhan}}
{{chucVu}}
{{tenCongTy}}
{{thangNam}}
```

Ví dụ:

```text
Phiếu lương tháng {{thangNam}} - {{hoTen}}
```

Nội dung email được gửi dưới dạng HTML. Bước **Gửi Email & Lịch sử gửi** hiển thị trạng thái thành công hoặc lỗi của từng nhân viên trong phiên làm việc hiện tại.

## Ghi nhớ cấu hình và bảo mật

Khi bật **Ghi nhớ cấu hình**, ứng dụng lưu tên công ty, logo, tài khoản người gửi, tiêu đề và nội dung email trong thư mục dữ liệu người dùng của Electron.

Mật khẩu ứng dụng Gmail chỉ được lưu khi hệ điều hành hỗ trợ `safeStorage`; mật khẩu được mã hóa và gắn với máy/tài khoản hệ điều hành hiện tại. Nếu không thể mã hóa, ứng dụng không lưu mật khẩu và sẽ yêu cầu nhập lại ở lần chạy sau. Tắt **Ghi nhớ cấu hình** sẽ xóa cấu hình đã lưu.

Dữ liệu Excel và phiếu lương không được tải lên máy chủ của ứng dụng. Khi sử dụng chức năng email, nội dung gửi và file PDF đính kèm được chuyển qua Gmail SMTP.

## Tùy chỉnh logo và mẫu phiếu lương

Logo tùy chỉnh hỗ trợ `.png`, `.jpg`, `.jpeg` và `.svg`, dung lượng tối đa 4 MB. Nếu xóa logo tùy chỉnh, ứng dụng quay lại logo mặc định tại `template/Logo_PHG_1.png`.

Mẫu phiếu lương nằm tại:

```text
template/payslip-template.html
```

Đây là HTML/CSS dùng để xem trước và tạo PDF. Có thể thay đổi màu sắc, bố cục và nội dung tĩnh, nhưng không nên đổi tên hoặc xóa các placeholder đang được sử dụng:

```text
{{tenCongTy}}        {{ngayXuat}}          {{logoSrc}}
{{soPhieuLuong}}     {{thangNam}}          {{hoTen}}
{{maNhanVien}}       {{khoi}}              {{boPhan}}
{{coSo}}             {{chucVu}}            {{luongChinhThuc}}
{{luongThuViec}}     {{congChuan}}         {{congThuViec}}
{{congChinhThuc}}    {{congAl}}            {{congClph}}
{{congRr}}           {{congPh}}            {{ngayCongThucTe}}
{{tongCong}}         {{bangKhoanNhan}}     {{tongThuNhap}}
{{bangKhoanKhauTru}} {{tongKhauTru}}       {{khoanKhacRow}}
{{thucNhan}}         {{ghiChuBlock}}
```

Dữ liệu cho các placeholder được tạo trong hàm `buildTemplateData()` của `main.js`.

## Thay đổi cấu trúc Excel

Nếu thêm, bớt hoặc đổi vị trí cột trong file Excel, cần cập nhật đồng bộ:

1. `COL` trong `lib/taxCalc.js` để ánh xạ dữ liệu phiếu lương.
2. `FULL_HEADER_COLUMNS` trong `lib/validate.js` để kiểm tra tiêu đề và từng dòng.
3. `template/mau-danh-sach-nhan-vien.xlsx` để người dùng có file mẫu mới.
4. Các kỳ vọng trong `test/payroll-regression.test.js`.

Sau khi thay đổi, luôn chạy kiểm thử trước khi sử dụng với dữ liệu thật.

## Kiểm thử

```bash
npm test
```

Bộ kiểm thử hồi quy hiện kiểm tra việc đọc file mẫu, ánh xạ các cột tổng, pipeline xử lý Excel và tính toàn vẹn của mẫu phiếu lương.

## Đóng gói ứng dụng Windows

```bash
npm run build-win
```

Trình cài đặt NSIS của HeheHR sẽ được tạo trong thư mục `dist/`. Máy cài từ file này không cần Node.js; chức năng gửi Gmail vẫn cần Internet.

## Cấu trúc dự án

```text
payroll-app/
├── main.js                               # Cửa sổ Electron, PDF, Gmail và cấu hình
├── preload.js                            # Cầu nối IPC an toàn cho giao diện
├── index.html                            # Cấu trúc giao diện
├── renderer.js                           # Luồng thao tác, bảng xem trước và tiến độ
├── styles.css                            # Giao diện ứng dụng
├── lib/
│   ├── excelWorker.js                    # Đọc và xử lý Excel trong worker
│   ├── taxCalc.js                        # Ánh xạ 44 cột sang dữ liệu phiếu lương
│   └── validate.js                       # Kiểm tra tiêu đề và dữ liệu từng dòng
├── template/
│   ├── mau-danh-sach-nhan-vien.xlsx      # File Excel mẫu
│   ├── payslip-template.html             # Mẫu HTML/CSS của phiếu lương
│   └── Logo_PHG_1.png                    # Logo mặc định
├── test/
│   └── payroll-regression.test.js        # Kiểm thử hồi quy
├── build/
│   └── icon.ico                          # Biểu tượng trình cài đặt Windows
└── package.json                          # Lệnh chạy, kiểm thử và đóng gói
```

## Xử lý sự cố thường gặp

- **Báo sai hoặc thiếu cột:** tải lại file mẫu, sao chép dữ liệu vào đúng cột và không đổi thứ tự tiêu đề.
- **Dữ liệu số hiển thị thành 0:** kiểm tra ô Excel có phải là giá trị số hợp lệ hay không.
- **Nút xuất PDF bị khóa:** cần đọc file Excel và chọn thư mục lưu; để xuất nhóm, cần tích chọn ít nhất một nhân viên.
- **Không gửi được email:** kiểm tra kết nối Internet, Gmail người gửi, mật khẩu ứng dụng và cột `Email` của nhân viên.
- **Không chạy được `npm` trong PowerShell:** dùng `npm.cmd` hoặc mở Command Prompt.
