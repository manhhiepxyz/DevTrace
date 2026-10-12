# Chạy DevTrace như một ứng dụng

Thư mục này biến DevTrace từ "gõ localhost trên trình duyệt" thành "nhấp đúp
là mở". Không cài thêm gì cả — chỉ dùng những thứ Windows đã có.

## Mở DevTrace

Nhấp đúp **`DevTrace.vbs`**.

Nó sẽ: bật máy chủ ở chế độ nền (không hiện cửa sổ dòng lệnh), chờ máy chủ
sẵn sàng, rồi mở một **cửa sổ ứng dụng** — Chrome hoặc Edge chạy ở chế độ
`--app`, tức là không có thanh địa chỉ, không có tab, trông như phần mềm thật.

Muốn có biểu tượng ngoài màn hình cho tiện thì nhấp đúp
**`install-shortcut.cmd`** một lần. Muốn nó tự mở cùng Windows thì thêm tham
số `--startup`:

```powershell
node desktop/shortcut.js install --startup
```

Gỡ lối tắt: nhấp đúp `uninstall-shortcut.cmd`.

### Vì sao lối tắt phải đi vòng qua `%LOCALAPPDATA%\DevTrace`

Đây là chỗ dễ tưởng là thừa, nhưng không thừa chút nào.

Tệp `.lnk` của Windows được tạo qua đối tượng COM `WScript.Shell`, và đối
tượng đó chuyển mọi đường dẫn qua **bảng mã ANSI cũ**. Ký tự nào không có
trong bảng mã ấy bị thay bằng dấu `?`. Dự án này nằm ở `D:\Dự án ma`, nên nếu
nhét thẳng đường dẫn vào lối tắt thì lối tắt sẽ trỏ tới `D:\D? án ma` và
**không bao giờ chạy được**. Đệ đã thử và soi từng byte để xác nhận, chứ
không phải đoán.

Cách xử lý: mọi thứ nhét vào tệp `.lnk` đều phải là ASCII. Nên DevTrace đặt
một **tệp chuyển tiếp** ở `%LOCALAPPDATA%\DevTrace\` — nơi đường dẫn thường
toàn ASCII — rồi lối tắt chỉ trỏ tới đó:

```
  Lối tắt ngoài màn hình          Thư mục trung gian                Dự án thật
  ──────────────────────          ──────────────────                ──────────
  DevTrace.lnk            ──►     %LOCALAPPDATA%\DevTrace\DevTrace.vbs ──► D:\Dự án ma\desktop\DevTrace.vbs
  (toàn ASCII)                    (tệp văn bản, giữ được tiếng Việt)
                                  devtrace.ico (bản sao của biểu tượng)
```

Tệp `.vbs` là **tệp văn bản**, nên nó giữ được tiếng Việt đầy đủ — đó là lý do
đường dẫn thật nằm ở đó chứ không nằm trong `.lnk`.

Thư mục trung gian chỉ chứa đường dẫn tới dự án và một bản biểu tượng, **không
chứa dữ liệu của huynh**. Gỡ lối tắt là nó tự dọn luôn.

### Các tham số của `shortcut.js`

| Tham số | Việc nó làm |
| --- | --- |
| `install` / `uninstall` | Tạo hoặc gỡ lối tắt. Mặc định là `install`. |
| `--startup` | Thêm cả lối tắt vào Startup, để DevTrace mở cùng Windows. |
| `--dest <thư mục>` | Đặt lối tắt ở thư mục khác thay vì màn hình. |
| `--stage <thư mục>` | Đổi thư mục trung gian, khi `%LOCALAPPDATA%` có ký tự ngoài ASCII. |

Nếu `%LOCALAPPDATA%` của huynh chứa ký tự ngoài ASCII (ví dụ tên người dùng có
dấu), công cụ sẽ **từ chối tạo** và chỉ đúng cách sửa:

```powershell
node desktop/shortcut.js install --stage C:\DevTrace
```

## Tắt DevTrace

Nhấp đúp **`stop-devtrace.cmd`**. Tệp này tìm đúng tiến trình máy chủ — trước
hết qua `data/server.pid`, không thấy thì hỏi `netstat` — và chỉ tắt nếu đó
đúng là node. Nếu cổng đang bị phần mềm khác giữ, nó **từ chối tắt** và nói
rõ ai đang giữ, chứ không tắt bừa.

Đóng cửa sổ ứng dụng **không** tắt máy chủ. Đó là chủ ý: lần sau mở lại là có
ngay, không phải chờ khởi động.

## Các tệp ở đây

| Tệp | Việc nó làm |
| --- | --- |
| `DevTrace.vbs` | Cửa vào chính. Nhấp đúp là mở. Chỉ là cầu nối mỏng. |
| `launch.js` | Phần suy nghĩ: kiểm cổng, bật máy chủ, mở cửa sổ, thu thập. |
| `stop.js` | Tắt máy chủ, có kiểm tra danh tính trước khi tắt. |
| `shortcut.js` | Tạo/gỡ lối tắt qua PowerShell COM. |
| `make-icon.js` | Tự vẽ và tự nén `devtrace.ico`. Không tải gì từ mạng. |
| `devtrace.ico` | Biểu tượng, 7 cỡ từ 16 tới 256 px. Cũng là biểu tượng cửa sổ ứng dụng, phục vụ ở đường dẫn `/favicon.ico`. |
| `start-devtrace.cmd` | Cách vào thay thế, cho ai thích tệp `.cmd`. |
| `stop-devtrace.cmd` | Tắt máy chủ, hiện kết quả rồi dừng chờ đọc. |
| `install-shortcut.cmd` | Tạo lối tắt trên màn hình. |
| `uninstall-shortcut.cmd` | Gỡ lối tắt. |

## Chỉnh trong `devtrace.config.json`

```json
"desktop": {
  "port": 5173,
  "openBrowser": true,
  "separateProfile": true,
  "collectOnLaunch": true,
  "windowSize": "1360,900",
  "waitMs": 25000
}
```

- `port` — đổi khi cổng 5173 vướng chương trình khác.
- `separateProfile` — `true` thì DevTrace dùng hồ sơ trình duyệt riêng
  (ở `data/browser-profile`), không lẫn vào phiên lướt web thường ngày.
  Đổi thành `false` nếu huynh muốn dùng chung hồ sơ cho nhẹ máy.
- `collectOnLaunch` — `true` thì mở lên là tự thu thập một lượt ở hậu trường.
- `windowSize` — cỡ cửa sổ, dạng `"rộng,cao"`.

## Khi có trục trặc

| Hiện tượng | Xem ở đâu |
| --- | --- |
| Hộp thoại báo lỗi khi mở | Nội dung lấy từ `desktop/.launch-out.log` |
| Máy chủ không lên | `data/server.log` — nhật ký của máy chủ |
| Cổng bị chiếm | Đổi `desktop.port` trong `devtrace.config.json` |
| Không tìm thấy Node.js | Cài Node 22 trở lên từ https://nodejs.org |
| Không tạo được lối tắt | Công cụ in rõ lý do; thường là thư mục trung gian có ký tự ngoài ASCII — xem `--stage` ở trên |
| Muốn lối tắt mà không dùng công cụ | Chuột phải `desktop\DevTrace.vbs` → **Gửi tới** → **Màn hình nền (tạo lối tắt)**, rồi vào Thuộc tính đổi biểu tượng sang `desktop\devtrace.ico` |

## Giới hạn — nói thẳng

Đây **không phải** ứng dụng native. Không tải được Electron (máy đang chặn
mạng ra ngoài), nên DevTrace dùng trình duyệt ở chế độ `--app` để có cảm giác
như một ứng dụng thật. Hệ quả:

- Vẫn cần Chrome/Edge (hoặc trình duyệt họ Chromium) trên máy.
- Cửa sổ vẫn là tiến trình trình duyệt, chỉ khác là không thanh địa chỉ.
- Biểu tượng trên thanh tác vụ vẫn có thể là biểu tượng Chrome.

Khi nào có mạng trở lại, muốn nâng thành app thật thì chỉ cần thêm Electron
và trỏ nó tới `http://127.0.0.1:5173` — phần máy chủ và giao diện giữ nguyên.
