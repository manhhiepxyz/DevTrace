# DevTrace — AI Coding Activity Tracker

> Tên tạm thời. Một công cụ chạy trên máy, ghi lại **dấu vết** của quá trình lập trình
> rồi đối chiếu chúng với kết quả thật, để trả lời ba câu hỏi:

1. **Huynh đã làm gì?** — hoạt động trên Codex, VS Code, trình duyệt, terminal.
2. **Huynh đã tạo ra kết quả gì?** — đối chiếu với commit, tệp sửa, tiến độ dự án.
3. **Huynh học được gì, mai làm gì?** — tổng hợp thành nhật ký có ngữ cảnh, các vấn đề
   còn bỏ ngỏ và bước tiếp theo.

Và một câu thứ tư, câu duy nhất **không** dựng từ dấu vết — vì nó là chữ huynh tự viết:

**Hôm nay định làm gì, và thực tế lệch bao nhiêu?** — nó đối chiếu thời khoá biểu tuần với
dấu vết thật, và bên cạnh đó là nhiệm vụ theo bốn tầm nhìn, đợt làm việc, dự án, hộp thư,
và sức khoẻ kho mã.

## Nguyên tắc kiến trúc: thu thập trước, suy luận sau

Đây là điều quan trọng nhất trong thiết kế này.

Nếu chỉ chụp màn hình rồi đưa cho AI tóm tắt cả ngày, hệ thống sẽ **tốn kém, không truy
vết được, và hiểu sai**. DevTrace làm ngược lại:

```
  Nguồn dữ liệu        Kho sự kiện          Đối chiếu             Suy luận
  ─────────────        ────────────         ─────────             ────────
  Codex sessions  ┐                       gom khối làm việc     gói bằng chứng
  Git, GitHub     │    một sự kiện        nối nhân quả          có mã tham chiếu
  Tệp tin         ├──► duy nhất,     ───► ghép dự án       ───► (AI viết lời,
  Trình duyệt     │    bất biến,          phân loại tra cứu     hoặc huynh tự viết)
  Terminal        │    lưu theo ngày      tính nhịp, chuỗi
  VS Code         ┘
```

Mỗi tầng chỉ làm đúng việc của mình. Sự kiện là **bằng chứng thô**, không diễn giải.
Tầng đối chiếu là **máy móc, chắc chắn đúng**. Chỉ tầng cuối mới dùng AI, và AI chỉ
nhận một gói bằng chứng đã nén, mỗi dòng đều có mã tham chiếu, kèm yêu cầu bắt buộc
phải trích dẫn mã đó.

Hệ quả: khi kết luận sai, ta truy được về sự kiện gốc nào đã dẫn tới nó.

## Chạy như một ứng dụng

Cách gọn nhất — không phải gõ địa chỉ web:

1. Nhấp đúp `desktop/install-shortcut.cmd` một lần để tạo biểu tượng **DevTrace** ngoài màn hình.
2. Từ đó về sau, nhấp đúp biểu tượng đó là mở.

Không thích lối tắt thì nhấp đúp thẳng `desktop/DevTrace.vbs`.

DevTrace tự bật máy chủ ở chế độ nền (không hiện cửa sổ dòng lệnh) rồi mở một
**cửa sổ ứng dụng**: Chrome/Edge chạy ở chế độ `--app`, tức là không thanh địa chỉ,
không tab, trông như phần mềm thật. Đóng cửa sổ **không** tắt máy chủ, nên lần sau
mở lại là có ngay.

Lối tắt mang biểu tượng `devtrace.ico`, và cửa sổ ứng dụng lấy cùng biểu tượng đó qua
`/favicon.ico` — Chrome thường dùng nó cho cửa sổ `--app`, tuy đôi khi thanh tác vụ vẫn
hiện biểu tượng Chrome.

### Ứng dụng Windows thật

Có Electron cài sẵn thì chạy:

```powershell
npm run desktop
```

Lối này mở một cửa sổ của **chính DevTrace** — biểu tượng riêng trên taskbar, có khay
hệ thống, chỉ cho một bản chạy (mở lần thứ hai thì đưa cửa sổ cũ lên trước), và đóng
cửa sổ thì thu xuống khay chứ không thoát. Nó dùng lại đúng phần bắt-máy-chủ của
`desktop/launch.js`, nên hai đường không lệch nhau.

Electron là **devDependency duy nhất** của dự án, và chỉ đường này cần tới nó:
`npm test` và `node server.js` chạy được trên máy chưa cài Electron.

Tắt hẳn: nhấp đúp `desktop/stop-devtrace.cmd`.

Chi tiết đầy đủ — các tuỳ chọn trong `devtrace.config.json`, cách xử lý khi trục
trặc, và cả những giới hạn — nằm ở `desktop/README.md`.

> **Hai lối vào, chung một máy chủ.** Lối qua Chrome `--app` vẫn là mặc định cho biểu
> tượng ngoài màn hình vì nó không cần cài gì thêm; lối Electron là để có một cửa sổ
> đúng nghĩa của DevTrace. Cả hai đều mở đúng máy chủ đó, nên dữ liệu và cấu hình
> không phụ thuộc vào việc huynh chọn lối nào.

### Chạy bằng dòng lệnh

Khi cần xem nhật ký trực tiếp, hoặc đang sửa mã nguồn:

```powershell
node server.js
```

Rồi mở http://localhost:5173 và bấm **Thu thập dấu vết**.

Không cần `npm install`. Không cần mạng. Chỉ cần Node 22 trở lên (dùng `node:sqlite`
có sẵn để đọc lịch sử trình duyệt).

> **Khác với bản "Tu Luyện Ký" cũ:** DevTrace **bắt buộc phải chạy qua máy chủ**, vì nó
> đọc tệp trên máy huynh. Mở thẳng `index.html` bằng `file://` sẽ không hoạt động.

```powershell
npm start           # tương đương node server.js
npm desktop         # mở app Electron (cần đã cài electron)
npm stop            # tắt máy chủ ở chế độ nền (thay cho stop-devtrace.cmd)
npm test            # chạy 631 kiểm tra
npm run collect     # thu thập rồi in tóm tắt ra terminal, không cần mở trình duyệt
npm run repos       # dò các kho git trên máy rồi in ra khối dán vào cấu hình
npm run icon        # vẽ lại biểu tượng devtrace.ico
```

## Sáu màn hình

| Màn hình | Việc nó làm |
| --- | --- |
| **Hôm nay** | Bảng tuần ở trên cùng, bảng bốn tầm nhìn nhiệm vụ, ba câu hỏi dựng từ bằng chứng, khung nhật ký, thẻ hộp thư, và một danh sách cảnh báo duy nhất. |
| **Dòng thời gian** | Sự kiện thô, lọc theo nguồn và tìm kiếm. Đây là chỗ kiểm chứng mọi kết luận. |
| **Dự án** | Bảng bằng chứng gộp theo dự án trong 7/14/30/90 ngày, kèm sức khoẻ kho mã. |
| **Lịch sử** | Lưới nhiệt theo ngày để nhìn nhịp làm việc dài hạn. |
| **Nguồn** | Sức khoẻ từng nguồn: lần chạy cuối, số sự kiện, lỗi, ghi chú. |
| **Cài đặt** | Cấu hình nguồn, dữ liệu, AI, bảng màu, dự án khai báo, hộp thư, và các thao tác thu thập/xoá. |

Đúng **sáu** màn hình — mọi thứ mới đều nằm trong màn có sẵn, không thêm màn thứ bảy, vì
một màn mới là một chỗ nữa phải nhớ mà chẳng mang thêm thông tin nào.

Ba bảng màu: **mực đêm**, **giấy dó**, và **trang** (mặc định, nền sáng), dùng chữ Hán làm
dấu mục.

## Kế hoạch: chữ huynh tự viết, nằm cạnh dấu vết máy đọc được

Bốn thứ, tất cả nằm trong `data/plans/` — **ngoài** `data/events/`. Đây là chuyện cơ học
chứ không phải gu: hai chỗ duy nhất trong dự án xoá dữ liệu là `Collect.clearCollected` và
`Collect.prune`, và cả hai chỉ đụng `data/events/` cùng `data/journals/`. Kế hoạch vô hình
với chúng, và **không bao giờ** bị xoá theo hạn lưu trữ, kể cả khi huynh tắt `keepJournals`.

- **Thời khoá biểu tuần** — các buổi trong tuần, mỗi buổi ghi rõ làm gì. Mẫu lặp lại, nên
  sửa một lần là mọi tuần đổi theo. Màn Hôm nay dựng nó thành **bảng tuần**: cột trái là
  mục tiêu dài hạn (việc có tầm nhìn *mục tiêu*), bảy cột là bảy thứ, mỗi hàng là một khung
  giờ, hàng cuối là **Nguyên tắc** — một câu dùng chung cho cả tuần. Bấm một ô để mở dòng
  đối chiếu ngay dưới hàng đó; bấm một **ô trống** để thêm buổi vào đúng thứ và đúng khung
  giờ ấy, và tích được nhiều thứ một lượt.

  Hai chỗ bảng tuần cố ý khác một thời khoá biểu vẽ tay. **Một:** màu *trong ô* là kết quả
  đối chiếu, còn màu *ở cột trái* chỉ để phân biệt mục tiêu — nếu một ô mang cả hai nghĩa
  thì người đọc sẽ tưởng ô xanh là "đã làm". **Hai:** hàng gộp theo **đúng cặp giờ**, nên
  `09:00–11:00` và `09:05–11:00` là hai hàng riêng, vì giấu chuyện đó đi là nói dối về
  chính thời khoá biểu của huynh.
- **Bốn tầm nhìn nhiệm vụ** — việc trong ngày, việc theo tuần, mục tiêu dài hạn, và việc
  cố định. Việc cố định **không đẻ ra một dòng cho mỗi ngày**: nó được tính lại lúc đọc,
  nên một việc lặp cả năm vẫn chỉ là một dòng lưu trữ.
- **Đợt làm việc (sprint)** — theo Scrum nhưng không nghi thức: backlog xếp tay, đếm trung
  thực xong-vs-mang-sang, một dòng mục tiêu. Không burn-down, không họp đứng, và **không
  nói về tốc độ trước khi đã đóng ít nhất hai đợt** — chưa đủ thì nó nói thẳng là chưa đủ.
- **Dự án khai báo** — chọn một thư mục làm gốc, đặt tên hoặc lấy tên theo thư mục. Đổi tên
  chỉ sửa **một trường**: sự kiện lưu đường dẫn, tên được tra lúc đọc, nên bằng chứng cũ
  hiện ngay dưới tên mới mà `data/events/` không đổi một byte. Xoá dự án cũng **không** xoá
  bằng chứng.

### Đối chiếu kế hoạch với thực tế — chỗ dễ nói dối nhất

Mỗi buổi trong thời khoá biểu được ghép với khoảng hoạt động thật, rồi xếp vào một trong
bốn trạng thái: **đã làm đủ** (≥ 80% thời lượng dự kiến), **làm một phần**, **có dấu vết
nhưng là việc khác**, và **chưa có dấu vết**.

Trạng thái cuối là trạng thái quan trọng nhất. Ngày không có dữ liệu thì **mọi** buổi là
*chưa có dấu vết*, không buổi nào là *chưa làm*. DevTrace không bao giờ nói huynh chưa làm
một việc — nó chỉ nói được rằng nó không thấy dấu vết nào.

Bảng tuần thêm trạng thái thứ năm, **chưa tới**, và nó cũng là một chuyện trung thực:
ngày sau hôm nay thì *không có gì để đọc*, khác hẳn với *đã đọc mà không thấy gì*. Máy chủ
cũng không đọc đĩa cho những ngày đó. Bảng tuần không đối chiếu được (chưa hỏi máy chủ, hoặc
tệp kế hoạch hỏng) thì ô ghi thẳng **chưa đối chiếu** — không mượn chữ *chưa có dấu vết*,
vì mượn là nói sai.

Con số lệch là **ước lượng**, không phải đo: ngưỡng gộp 25 phút và ngưỡng nghỉ 8 phút
khiến một buổi có nghỉ giữa bị tách khúc.

## Hộp thư — và một ranh giới không được vượt

Đây là chỗ đầu tiên DevTrace cần mật khẩu của người khác, và là dữ liệu của **người khác
viết** — thứ nhạy cảm nhất trên máy. Nên có một ranh giới rạch ròi:

> **Chữ huynh tự viết thì đi cùng gói bằng chứng tới AI. Chữ người khác viết thì không bao giờ.**
>
> Nhiệm vụ, tên buổi, mục tiêu — huynh viết, huynh bật AI thì AI được thấy. Tiêu đề thư,
> địa chỉ người gửi, nội dung thư — **không đi đâu cả**. Cảnh báo về thư chỉ là **con số và
> số ngày**: *"5 thư có thể chưa được trả lời, cũ nhất 3 ngày"*.

Hệ quả kèm theo: **hộp thư không phải một nguồn bằng chứng.** Nó không vào `E.SOURCES`,
không vào `data/events/`, không vào `/api/export`. Ảnh chụp ở `data/mail/inbox.json` là
**cache** — dựng lại được bằng một lần bấm, mất nó không mất gì của huynh.

Cách nối: **IMAP với mật khẩu ứng dụng**, TLS ngầm ở cổng 993. Mật khẩu để trong biến môi
trường (`mail.passwordEnv`, mặc định `DEVTRACE_MAIL_PASSWORD`) — DevTrace **chỉ biết tên**
biến, không bao giờ biết giá trị, và không có đường nào ghi nó xuống đĩa. Tính năng mặc
định **tắt**: một bản DevTrace mới cài không mở kết nối nào ra ngoài.

**"Chưa trả lời" là một ước lượng, và sai cả hai chiều.** Trả lời từ máy khác thì bị tính
là chưa trả lời (sai âm); thư quảng cáo thì nằm mãi trong danh sách (sai dương). Số chính
là "đã gửi mà chưa được đáp", đối chiếu thư mục Đã gửi qua `In-Reply-To` và `References`.
Bỏ trống thư mục Đã gửi là lựa chọn có thật, nhưng khi đó tín hiệu chính tắt và thẻ phải
nói ra là đang thiếu — con số còn lại chỉ dựa vào cờ đã-trả-lời của máy chủ, và nó đếm thừa.

Những chỗ biết trước là sẽ hỏng, và nói thẳng: tài khoản chỉ cho OAuth/SSO thì không dùng
được; máy chủ đòi `ID` hoặc chỉ STARTTLS thì không hỗ trợ; tên thư mục không phải ASCII thì
không hỗ trợ. Không có `IDLE`, nên đây là hỏi-lúc-thu-thập, không phải thông báo đẩy. Khi
hỏng, thẻ Hộp thư nói thẳng lý do bằng tiếng Việt, và **mọi thứ khác vẫn chạy**.

Nút **Tạo nhiệm vụ từ thư** điền sẵn tiêu đề thư vào ô nhiệm vụ, huynh sửa được trước khi
lưu. Một khi đã lưu thì đó là **chữ huynh viết**, và đi theo gói bằng chứng như mọi nhiệm vụ
khác — hộp thoại đó nói rõ điều này.

## Sức khoẻ kho mã

Chuyện **"bây giờ"**, không phải chuyện của một ngày: cây làm việc bẩn của hôm nay không
nói được gì về ngày ba tháng trước. Nên ảnh chụp nằm riêng ở `data/repohealth.json`, và
cảnh báo git **chỉ phát khi ngày đang xem là hôm nay** — bản tổng hợp của một ngày cũ vì
thế ổn định và không bao giờ đi hỏi ảnh chụp hiện tại.

Dò: tách đã-chuẩn-bị / chưa-chuẩn-bị, trước/sau remote (`@{upstream}`, **không cần mạng**),
stash, nhánh cũ chưa gộp, thẻ, tệp lớn trong cây, và — chỉ khi huynh chọn chạy — quét bí mật
trong tệp bằng chính `redact.RULES`. Quét bí mật rất đắt và sẽ báo nhầm trên tệp thử, nên
nhãn ghi *"có thể là bí mật"*, không khẳng định.

Mỗi kho tốn khoảng sáu lệnh git, nên mặc định chỉ quét `sources.git.healthMaxRepos` kho
(20). Quét cả danh sách là việc phải chọn.

## Các nguồn dữ liệu và bằng chứng chúng đóng góp

Mỗi nguồn chỉ đóng góp **một loại bằng chứng khác nhau**. Không nguồn nào làm thay việc
của nguồn nào — đó là lý do phải có nhiều nguồn.

| Nguồn | Lấy từ đâu | Đóng góp gì |
| --- | --- | --- |
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl` | Phiên làm việc với AI: model, số lượt, lệnh đã chạy, token, lượt bị ngắt, và cả **lời nhắc gốc** của huynh |
| **Git** | `git log --numstat`, `git status` | Kết quả cứng: commit, số tệp, số dòng thêm/bớt, việc chưa ghi lại |
| **Tệp tin** | Ảnh chụp cây thư mục theo dõi | Công sức chưa commit — những lần sửa mà git chưa thấy |
| **Trình duyệt** | Chrome/Edge `History` (đọc qua `node:sqlite`) | Nguồn tham khảo: đã tra cứu gì, và tự phân loại **học / giải trí / khác** |
| **Terminal** | Lịch sử PSReadLine | Lệnh huynh **tự gõ** — thước đo tự lực, tách khỏi lệnh AI chạy |
| **VS Code** | `workspaceStorage`, `globalStorage` | Phiên soạn thảo, cửa sổ đang mở, số phiên trò chuyện AI trong editor |
| **GitHub** | API công khai của GitHub | Việc chỉ tồn tại trên mạng: pull request, issue, review, sao — thứ `git log` trên máy không thấy được |
| **Cửa sổ** | *tuỳ chọn*, do huynh tự chạy | Thời gian tập trung theo ứng dụng ở tiền cảnh |
| **Tự ghi** | Huynh tự thêm | Ghi chú của chính huynh — nguồn duy nhất không do máy sinh ra |

Nguồn **GitHub** cũng mặc định tắt, và đây là nguồn **duy nhất** gửi dữ liệu ra khỏi máy
trong lúc thu thập (`app/ai.js` chỉ gửi khi huynh bấm tổng kết). Khoá của nó cũng chỉ được
nhắc **tên** qua `tokenEnv`, không bao giờ được lưu. Nó là nguồn **dòng chảy**: API công khai
chỉ trả khoảng 90 ngày gần nhất, nên tính lại từ đầu mỗi lần là tự xoá dần quá khứ — bằng
chứng đã thấy một lần thì ở lại.

Nguồn **Cửa sổ** mặc định tắt và không tự cài gì vào máy. Khi nào muốn đo:

```powershell
powershell -ExecutionPolicy Bypass -File tools\window-sampler.ps1
```

Script nhận thêm `-IntervalSeconds` (mặc định 20), `-IdleSeconds` (mặc định 120: ngồi không
quá lâu thì không tính là tập trung) và `-MinSeconds` (mặc định 5: khối quá ngắn thì bỏ).
Muốn kiểm tra phép tính cộng dồn mà không phải ngồi đo thật:

```powershell
powershell -ExecutionPolicy Bypass -File tools\window-sampler.ps1 -SelfTest
```

## Trung thực về những chỗ DevTrace phải đoán

Có hai chỗ DevTrace phải suy ra, và cả hai đều **được đánh dấu rõ** trong giao diện:

- **Gán dự án cho lượt tra cứu.** Một lượt xem Stack Overflow không tự biết nó phục vụ dự
  án nào. DevTrace chỉ gán khi có một bằng chứng **mạnh** (phiên Codex, commit, tệp sửa,
  phiên soạn thảo, lệnh tự gõ) cách đó không quá 20 phút, và gắn nhãn `suy ra`.
- **Mốc thời gian của lệnh terminal.** File lịch sử PSReadLine không có thời gian. DevTrace
  **chỉ ghi những lệnh mới** xuất hiện kể từ lần thu thập trước, lấy lúc thu thập làm mốc.
  Lịch sử cũ chỉ được nạp một lần dưới dạng một mốc tổng hợp, không gán giờ giả.

Chỗ nào không biết thì nói là không biết. Đó là điều kiện để con số còn dùng được.

## Nhật ký và tầng AI

DevTrace **không cần AI để hoạt động**. Toàn bộ phần đối chiếu, thống kê, gợi ý việc làm
đều do máy tính. AI chỉ là lớp diễn đạt cuối cùng, và có hai cách dùng:

**Cách 1 — dán tay (không cần khoá API).** Bấm *Xem và sao chép lời nhắc*. DevTrace dựng
sẵn gói bằng chứng dạng JSON (khoảng 7 KB) kèm lời nhắc có ràng buộc, huynh dán vào bất kỳ
trợ lý nào rồi dán kết quả trở lại khung nhật ký.

**Cách 2 — gọi API.** Khai báo trong `devtrace.config.json`:

```json
"ai": {
  "provider": "openai-compatible",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "apiKeyEnv": "DEVTRACE_API_KEY"
}
```

Khoá đọc từ **biến môi trường**, không bao giờ ghi vào tệp cấu hình.

Lời nhắc gửi cho AI có năm ràng buộc, trong đó hai ràng buộc quan trọng nhất:

> 1. Chỉ dùng dữ liệu trong gói bằng chứng. Không suy đoán, không thêm chi tiết không có trong đó.
> 2. Mỗi nhận định phải kèm mã tham chiếu trong ngoặc, ví dụ (B2) hoặc (P1, D3). Không có mã thì không được viết.

## Dữ liệu của huynh

Tất cả nằm trong `data/`, trên máy huynh:

```
data/
  events/2026-10-09.jsonl     sự kiện thô của từng ngày (append-only, truy vết được)
  journals/2026-10-09.json    nhật ký của ngày
  plans/tasks.json            nhiệm vụ bốn tầm nhìn + dấu đã-xong theo ngày
  plans/timetable.json        thời khoá biểu tuần
  plans/sprints.json          đợt làm việc và mục tiêu đợt
  repohealth.json             ảnh chụp sức khoẻ kho mã ("bây giờ", không phải một ngày)
  mail/inbox.json             ảnh chụp hộp thư — CACHE, không bao giờ là bằng chứng
  snapshots/files.json        ảnh chụp cây thư mục để so sánh lần sau
  snapshots/shell.json        mốc theo dõi lịch sử terminal
  health.json                 lần chạy cuối và tình trạng từng nguồn
  window-log.jsonl            (chỉ khi huynh chạy window-sampler)
```

**Tệp kế hoạch hỏng thì DevTrace từ chối ghi.** `U.readJson` trả về giá trị dự phòng khi
parse lỗi, nên nếu cứ thế ghi thì kho việc của huynh bị thay bằng rỗng, âm thầm. Thay vào
đó: nó giữ một bản sao `tasks.json.hong-<mốc thời gian>`, và **từ chối mọi lần ghi** cho
tới khi huynh xử lý — giao diện hiện thẳng tên tệp và tên bản sao. Tệp chưa có và tệp rỗng
đều là kho mới, không phải hỏng.

Máy chủ **chặn** mọi truy cập qua trình duyệt vào `data/`, `app/`, `server.js` và tệp
cấu hình — chỉ những tệp thuộc giao diện mới được phục vụ. Bộ kiểm thử tự động có kiểm
tra luôn điều này.

## Cấu trúc mã

```
index.html            Trang chính
styles.css            Toàn bộ giao diện (ba bảng màu, chỉ dùng token)
server.js             Máy chủ + API (Node thuần)
devtrace.config.json  Cấu hình (tự sinh ở lần chạy đầu)
app/
  util.js             Tiện ích: đường dẫn, thời gian, JSONL, băm
  config.js           Nạp/gộp/lưu cấu hình, quy đường dẫn về dự án, dự án khai báo
  events.js           Mô hình sự kiện + kho lưu append-only
  correlate.js        Gom khối, ghép dự án, nối nhân quả
  digest.js           Bản tổng hợp ngày (ba câu hỏi)
  plans.js            Kho kế hoạch: bốn tầm nhìn, thời khoá biểu, đợt, đối chiếu
  alerts.js           Một chỗ duy nhất gom cảnh báo: kế hoạch, kho mã, hộp thư
  repohealth.js       Sức khoẻ kho mã ("bây giờ", không phải một ngày)
  mail.js             Hộp thư — phần THUẦN: đếm, không mạng, không bao giờ rời máy
  mail-fetch.js       Một phiên IMAP trong tiến trình con (tệp DUY NHẤT có `tls`)
  ai.js               Gói bằng chứng, lời nhắc, gọi API, lưu nhật ký
  redact.js           Che bí mật trước khi dữ liệu rời khỏi máy
  report.js           Các phép gộp phục vụ giao diện
  collect/
    index.js          Bộ điều phối + sức khoẻ nguồn
    codex.js git.js files.js browser.js shell.js vscode.js window.js
    github.js         Hoạt động trên GitHub (mặc định tắt, có khe cắm mạng)
    github-fetch.js   Một lần gọi API trong tiến trình con (đường ống là đồng bộ)
web/
  charts.js           Biểu đồ SVG viết tay
  views.js            Sinh HTML cho sáu màn hình
  app.js              Định tuyến, gọi API, bắt sự kiện
tools/
  smoke-test.js       Kiểm tra tự động toàn bộ logic
  find-repos.js       Dò các kho git trên máy, in ra khối dán vào cấu hình
  window-sampler.ps1  Đo thời gian tập trung (tuỳ chọn)
desktop/
  DevTrace.vbs        Nhấp đúp là mở; cầu nối mỏng, lưu bằng UTF-16
  main.js             Ứng dụng Electron: một bản chạy, khay hệ thống, thu xuống khay
  launch.js           Kiểm cổng, bật máy chủ nền, mở cửa sổ --app
  stop.js             Tắt máy chủ, kiểm tra danh tính trước khi tắt
  shortcut.js         Tạo và gỡ lối tắt qua PowerShell COM
  make-icon.js        Tự vẽ rồi tự nén ra devtrace.ico (không tải gì)
  devtrace.ico        Biểu tượng, bảy cỡ 16–256 px (cũng là /favicon.ico)
  *.cmd               Lối vào thay thế cho ai thích nhấp đúp tệp .cmd
  README.md           Vì sao lối tắt phải đi vòng qua %LOCALAPPDATA%\DevTrace
legacy/               Bản "Tu Luyện Ký" cũ, giữ lại để tham khảo
```

## Hai loại nguồn, hai cách ghi

Đây là chi tiết kỹ thuật đáng để huynh biết, vì nó quyết định dữ liệu có sạch hay không:

- **Nguồn suy ra được** (Codex, Git, Trình duyệt, VS Code): mỗi lần thu thập sẽ **tính lại
  từ đầu** và thay thế toàn bộ bản cũ. Nhờ vậy sửa bộ thu thập xong chỉ cần chạy lại là dữ
  liệu đúng, không bị nhân đôi.
- **Nguồn dòng chảy** (Tệp tin, Terminal, Cửa sổ, GitHub, Tự ghi): chỉ **ghi thêm** phần chưa
  từng thấy, vì quá khứ không thể dựng lại. Sự kiện được khử trùng theo mã định danh.

## Cái gì rời khỏi máy

DevTrace chạy trên máy huynh và mặc định **không gửi gì đi đâu**. Chỉ có hai đường ra, và cả
hai đều đi qua một bộ lọc che bí mật (`app/redact.js`):

- **Gói bằng chứng gửi cho AI** — chỉ khi huynh bấm *Suy luận bằng AI* và đã tự tay điền
  khoá API. Gói này **luôn** được che trước khi gửi.
- **Bản xuất chia sẻ** — `/api/export?redact=1`, hoặc nút *Xuất bản đã che để chia sẻ* trong
  màn Cài đặt.

Bộ lọc nhận ra những khuôn mẫu bí mật đã biết: khoá OpenAI/Anthropic/GitHub/AWS/Slack/Google/npm,
JWT, khối khoá riêng, `Bearer …`, mật khẩu nằm trong địa chỉ (`https://user:matkhau@…`), tham số
bí mật trong địa chỉ (`?token=…`), và giá trị gán cho biến có tên đáng ngờ (`DB_PASSWORD=…`,
`MYSQL_PWD=…`, `"access_token": …`). Tên biến được giữ lại, chỉ giá trị bị thay bằng `[đã che]`,
để dấu vết còn đọc được.

> Đây là **lưới an toàn, không phải bảo đảm**. Nó bắt khuôn mẫu đã biết; một bí mật viết theo
> cách lạ thì lọt. Nói thẳng vậy để không ai yên tâm sai chỗ.

Ba điều cố ý làm như vậy:

- **Bản xuất đầy đủ (`/api/export`) KHÔNG bị che.** Đó là bản sao lưu, và che nó đi là phá dữ
  liệu của huynh — đúng kiểu hỏng mà DevTrace vừa mất công chặn ở chỗ khác. Nó tự ghi rõ trong
  trường `note` rằng bản này còn nguyên dữ liệu gốc. Muốn bản chia sẻ thì dùng `?redact=1`.
- **Kho kế hoạch thì CÓ trong bản xuất, ảnh chụp hộp thư thì KHÔNG.** Kế hoạch là chữ huynh tự
  viết, không dấu vết nào dựng lại được nó — nên nó đi cùng bản sao lưu, kèm cả danh sách tệp
  hỏng nếu có (một tệp hỏng mà biến thành kế hoạch rỗng trong bản sao lưu thì bản sao lưu trông
  vẫn đầy đủ, và đó đúng là kiểu im lặng dự án này cấm). Ảnh chụp hộp thư thì ngược lại: nó là
  cache, và là chữ của người khác.
- **Kho `data/events/*.jsonl` không bao giờ bị che.** Huynh phải đọc lại được chính lệnh mình
  đã gõ. Che lúc lưu là mất dữ liệu, và mất âm thầm.
- **Mỗi lần che đều nói ra đã che cái gì** và che bao nhiêu chỗ, chứ không sửa dữ liệu của
  người khác trong im lặng.

Tắt được ở Cài đặt (`privacy.redactSecrets: false`), nhưng mặc định là bật: một lưới an toàn
mặc định tắt thì gần như chắc chắn không bao giờ được bật.

### Hạn lưu trữ

Mặc định **tắt**. Bật ở Cài đặt (`retention.enabled`, `retention.days`, `retention.keepJournals`):
mỗi lần thu thập xong, DevTrace xoá những ngày cũ hơn số ngày đã đặt và ghi lại đã xoá ngày
nào. Nhật ký **không** bị xoá theo, trừ khi huynh tắt `retention.keepJournals`.

Tự xoá dữ liệu của huynh là việc huynh phải nói rõ mình muốn — nên nó không bật sẵn.

## Kiểm tra tự động

```powershell
node tools/smoke-test.js
```

631 kiểm tra, chạy trong vài giây, không cần trình duyệt, **không cần mạng, và không mở một
kết nối nào**. Bao gồm:
tiện ích thời gian, kho sự kiện, cấu hình, đối chiếu, tổng hợp, tầng AI, từng bộ thu thập
(có cả tệp rollout giả), bộ điều phối **cùng chốt chặn chống xoá dữ liệu** (nguồn suy ra
đọc hụt, trả về rỗng, hoặc bị tắt đều không được xoá lịch sử cũ), **dựng thử cả sáu màn hình** (kể cả trường hợp rỗng),
**nối dây** (mọi `data-action` đều có hàm xử lý, mọi đường dẫn API đều có ở máy chủ, danh
sách trắng của máy chủ chặn đúng những thứ phải chặn), **chạy thật `app.js` trong một DOM
giả** để bắt những lỗi chỉ xuất hiện lúc mở trang, **bộ khởi động ứng dụng để bàn**
(chọn cổng, chọn trình duyệt, tham số `--app`, lối tắt, và định dạng tệp `devtrace.ico`), và
**nhóm bảo vệ dữ liệu rời khỏi máy**: từng khuôn mẫu bí mật phải bị che (kèm danh sách câu
vô hại **không** được phép cắn nhầm), gói gửi cho AI không được lọt bí mật trong khi kho trên
máy vẫn nguyên bản gốc, hạn lưu trữ chỉ xoá đúng ngày quá cũ, và `stop.js` **không được tắt
nhầm** — kể cả tình huống tệp pid cũ nằm lại rồi Windows cấp số pid đó cho phần mềm khác.

Ba nhóm mới, và mỗi nhóm kiểm một điều mà lời hứa suông không giữ được:

- **Kế hoạch** — việc cố định lặp đúng theo thứ, tích xong hôm nay không tích sẵn tuần sau,
  đối chiếu nói *chưa có dấu vết* chứ **không bao giờ** nói *chưa làm*, tốc độ **ẩn** khi
  chưa đủ hai đợt, tệp hỏng thì có bản sao và **đường ghi bị từ chối**, và `clearCollected`
  lẫn `prune` để `data/plans/*` **nguyên từng byte**.
- **Hộp thư** — mặc định tắt nghĩa là **không gọi mạng và không ghi tệp**, thiếu mật khẩu thì
  không mở kết nối, `sentIndex` dựng từ **cả** `In-Reply-To` lẫn `References`, tiêu đề thư
  **không** có trong gói gửi cho AI, mật khẩu đặt vào biến môi trường **không** xuất hiện ở
  bất kỳ tệp nào trong thư mục kiểm thử, và một phép soi mã nguồn giữ cho `app/mail.js` không
  bao giờ `require('tls')` — chỉ `app/mail-fetch.js` được.
- **Sức khoẻ kho** — chạy hoàn toàn trên runner git giả, cảnh báo git **vắng** ở bản tổng hợp
  của ngày cũ và **có** ở hôm nay, và quét tôn trọng `healthMaxRepos`.

Bài kiểm thử cố tình **không mở cửa sổ nào và không chạy tiến trình nào** — nó soi phần
suy nghĩ của bộ khởi động, chứ không bật ứng dụng lên làm phiền người đang ngồi trước máy.

## Giới hạn thật

- **Chỉ chạy trên Windows** ở phiên bản này (đường dẫn Chrome/Edge, PSReadLine, VS Code).
- **Lịch sử chỉ có từ lúc cài.** Codex, Git, Trình duyệt, VS Code có dữ liệu quá khứ; Terminal
  và Cửa sổ thì không.
- **Không biết huynh làm gì ngoài những nguồn trên.** Nếu huynh code trong một editor khác
  hoặc dùng một trợ lý khác, DevTrace sẽ không thấy — và nó sẽ nói thẳng là không thấy, chứ
  không đoán bừa.
- **"Phút hoạt động" là thời gian có dấu vết, không phải thời gian ngồi trước máy.** Muốn con
  số thứ hai thì phải bật nguồn Cửa sổ.
- **IMAP là phần mong manh nhất, và chỉ chạy một phần.** Chắc chắn với Gmail/Outlook **có mật
  khẩu ứng dụng**; tài khoản chỉ cho OAuth/SSO thì không dùng được, máy chủ đòi `ID` hoặc chỉ
  STARTTLS thì hỏng, tên thư mục không phải ASCII thì không hỗ trợ. Không có `IDLE`.
- **"Chưa trả lời" và "chênh bao nhiêu phút" đều là ước lượng.** Đã ghi rõ ở hai mục trên, và
  giao diện luôn ghi kèm chữ *ước lượng* — chỗ nào ước lượng thì không được trình bày như đo.
- **Cảnh báo kho mã tốn khoảng sáu lệnh git mỗi kho.** Mặc định quét 20 kho; quét cả danh sách
  là việc phải chọn, và nó chậm thật.

## Gợi ý cho chính huynh

Đây là công cụ, không phải lời giải. Cách học tốt nhất với chính dự án này:

1. Mở `data/events/<hôm nay>.jsonl` bằng trình soạn thảo và đọc vài dòng. Đó là toàn bộ
   bằng chứng thô. So xem kết luận ở màn *Hôm nay* có thật sự bám vào đó không.
2. Đọc `app/correlate.js`, tự giải thích hàm `links()` trước khi sửa ngưỡng thời gian.
3. Thử viết thêm một nguồn mới (ví dụ lịch sử Docker hoặc WakaTime) bằng cách bắt chước
   `app/collect/vscode.js` — nhớ đăng ký vào `COLLECTORS` trong `app/collect/index.js`.

Trước khi sửa `app/mail.js` hay `app/mail-fetch.js`, đọc bốn điều ở đầu `app/mail.js`. Điều
thứ nhất — chữ người khác viết không bao giờ đi đâu cả — là ranh giới chịu lực của cả tính
năng đó, và nó được giữ bằng phép kiểm chứ không bằng lời hứa.
