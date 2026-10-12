# Tu Luyện Ký

Web quản lý, theo dõi và đánh giá quá trình học lập trình — dựng theo đúng tinh thần bức thư:
**Understand → Build → Verify → Accelerate**, bảy giới luật chống nhập ma và lộ trình năm cảnh giới trên dự án Nexus.

Điểm cốt lõi: web này **không đo tiến bộ bằng số dòng code**. Nó đo bằng số vấn đề huynh tự giải quyết,
số khái niệm huynh giải thích được, và khả năng debug khi không có AI.

Giao diện theo phong cách **cổ trang** (giấy dó / mực đêm), mực đỏ chu sa, chữ Hán làm dấu mục.

## Cách chạy

**Cách 1 — mở thẳng file (nhanh nhất)**

Nhấp đúp vào `index.html`. Web chạy hoàn toàn trong trình duyệt, không cần cài gì.

**Cách 2 — chạy qua máy chủ nhỏ (khuyến nghị, dữ liệu ổn định hơn)**

```powershell
node server.js
```

Rồi mở http://localhost:5173

Máy chủ này viết bằng Node thuần, không cần `npm install`.

## Chín màn hình

Xếp theo bốn nhóm trên thanh bên.

**Tu thân**

| Màn hình | Việc nó làm |
| --- | --- |
| Hôm nay | Bảng điều khiển: ba việc mỗi ngày, chuỗi ngày, chỉ số tự lực, lịch tu luyện, tiến độ cảnh giới, việc nhóm cần làm |
| Nhật ký | Ghi mỗi buổi học: thời gian, chế độ AI, tự đánh giá và **5 câu hỏi nhật ký**; nút "nhân bản buổi trước" |
| Giới luật | Điểm danh 7 giới luật mỗi ngày, xem mức giữ giới luật 14 ngày |
| Lộ trình | Năm cảnh giới: nhiệm vụ, điều kiện qua ải, mức tự tin |
| Tái tạo | Ghi lại mỗi lần tự viết lại tính năng **không nhìn lời giải** |

**Tri thức**

| Màn hình | Việc nó làm |
| --- | --- |
| Việc đọc | Kệ sách: tiến độ trang/chương, nhịp đọc mỗi ngày, dự kiến ngày xong, nhật ký đọc và điều đọng lại |

**Đồng đội**

| Màn hình | Việc nó làm |
| --- | --- |
| Nhóm Scrum | Bảng việc 4 cột (kéo-thả), sprint có mục tiêu, burndown, vận tốc (velocity), phân bổ theo người |

**Tổng kết**

| Màn hình | Việc nó làm |
| --- | --- |
| Đánh giá | Biểu đồ chỉ số tự lực, phân bổ thời gian, chế độ dùng AI, thống kê đọc và nhóm |
| Cài đặt | Hồ sơ, đổi giao diện sáng/tối, xuất/nhập dữ liệu, xoá dữ liệu |

## Đồng hồ nén hương

Một nén hương cháy ngắn dần theo thời gian, kèm chuông báo khi hết giờ. Đồng hồ **đếm tiếp sau khi tải lại trang**,
và đổi cả tiêu đề tab để huynh liếc là biết còn bao lâu. Dùng để vào guồng: đặt 45 phút đọc, 90 phút tự xây, v.v.

## Chỉ số tự lực (0–100)

| Thành phần | Điểm tối đa |
| --- | --- |
| Chế độ dùng AI (A=25, B=18, C=10, D=2) | 25 |
| Số vấn đề tự giải quyết (× 10) | 30 |
| Số khái niệm giải thích được (× 8) | 25 |
| Debug độc lập, không cần AI | 20 |

Điểm càng cao nghĩa là buổi học đó càng ít phụ thuộc vào AI.

## Lịch tu luyện mặc định

30 phút ôn tập · 45 phút đọc tài liệu · 90 phút tự xây · 30 phút debug và test · 15 phút ghi nhật ký.
Tổng 210 phút, đổi được trong **Cài đặt**.

## Việc đọc — theo dõi để cải tiến

Mỗi tài liệu (sách, khoá học, tài liệu kỹ thuật) có tổng số đơn vị (trang chương, bài, giờ video).
Ghi một lần đọc kèm số đơn vị và số phút, web tự tính:

- **Nhịp đọc** (đơn vị/ngày) từ số liệu thật của huynh, không phải con số lý thuyết.
- **Dự kiến ngày xong** dựa trên nhịp đó.
- **Điều đọng lại** (takeaways) và nhật ký đọc để lần sau đọc tiếp không bị đứt mạch.

## Nhóm theo Scrum

- **Backlog** phân loại theo điểm (1–13) và độ ưu tiên, kéo-thả giữa bốn cột: Cần làm → Đang làm → Chờ xem lại → Xong.
- **Sprint** có mục tiêu và khoảng ngày; việc gắn vào sprint nào thì nằm trong sprint đó.
- **Burndown** vẽ đường còn lại theo ngày để thấy mình đang tụt lại hay bám sát kế hoạch.
- **Vận tốc** tính từ các sprint đã đóng để lần sau giao việc sát sức hơn.
- **Phân bổ theo người** để biết ai đang giữ quá nhiều điểm.
- **Hồi tưởng (retro)** sau mỗi sprint: điều tốt, điều cần cải thiện, hành động cho sprint sau.

## Dữ liệu của huynh

Dữ liệu nằm trong `localStorage` của trình duyệt, không gửi đi đâu cả.
Hãy vào **Cài đặt → Xuất dữ liệu (.json)** để sao lưu định kỳ, và dùng **Nhập từ file** khi đổi máy.

## Bảy giới luật chống nhập ma

| # | Giới luật |
| --- | --- |
| 1 | Không copy code khi chưa hiểu |
| 2 | Tự nghĩ trước khi hỏi AI |
| 3 | Không giao cả một tính năng cho AI |
| 4 | Mỗi lần dùng AI phải có mục đích học tập |
| 5 | Luôn kiểm tra lại code AI viết |
| 6 | Không đo tiến bộ bằng số dòng code |
| 7 | Định kỳ tái tạo lại mà không nhìn lời giải |

Bốn chế độ dùng AI: **A** tự viết · **B** xin gợi ý · **C** nhờ review/phản biện · **D** vibe coding có kiểm soát.

## Cấu trúc mã

```
index.html          Trang chính
styles.css          Toàn bộ giao diện (hai bảng màu giấy dó / mực đêm)
server.js           Máy chủ tĩnh tối giản (Node thuần)
js/seed.js          Nội dung gốc: giới luật, cảnh giới, chế độ AI, lịch, dữ liệu mẫu
js/store.js         Tầng dữ liệu localStorage + các chỉ số đánh giá
js/charts.js        Biểu đồ SVG viết tay, không dùng thư viện
js/timer.js         Đồng hồ nén hương (đếm tiếp sau khi tải lại)
js/views.js         Sinh HTML cho từng màn hình và biểu mẫu
js/app.js           Định tuyến, sự kiện, modal, kéo-thả
tools/smoke-test.js Kiểm tra tự động toàn bộ logic
```

## Kiểm tra tự động

```powershell
node tools/smoke-test.js
```

Bài kiểm tra chạy toàn bộ logic (lưu trữ, chỉ số, đọc, Scrum, dựng giao diện, sao lưu/phục hồi,
nối dây giữa giao diện và bộ điều khiển) mà không cần trình duyệt.

## Gợi ý cho chính huynh

Đây là công cụ, không phải lời giải. Cách học tốt nhất với chính dự án này:

1. Đọc `js/store.js` và tự giải thích `sessionScore` hoạt động thế nào trước khi sửa nó.
2. Thử tự thêm một trường mới (ví dụ "số lần phải tra tài liệu") xuyên suốt từ biểu mẫu đến chỉ số.
3. Mỗi tuần, chọn một hàm trong `js/charts.js` rồi tự viết lại mà không nhìn code cũ.
