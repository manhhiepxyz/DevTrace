/* =====================================================================
   seed.js — Dữ liệu gốc của "Tu Luyện Ký"
   Bám theo bức thư: Understand → Build → Verify → Accelerate,
   7 giới luật, 5 cảnh giới, 4 chế độ dùng AI, lịch tu luyện mỗi ngày.
   Phần mở rộng: theo dõi việc đọc và quản lý nhóm theo Scrum.
   ===================================================================== */
(function (global) {
  'use strict';

  global.SEED = {
    phiênBản: 2,

    /* Bốn bước của công pháp chủ đạo */
    methods: [
      { id: 'understand', name: 'Understand', vi: 'Tự hiểu', desc: 'Đọc yêu cầu, vẽ luồng dữ liệu, dự đoán cách hoạt động và viết kế hoạch bằng lời của mình. Chưa yêu cầu AI sinh code.' },
      { id: 'build', name: 'Build', vi: 'Tự xây', desc: 'Tự viết code, tra tài liệu chính thức khi cần, tự chạy chương trình. Chấp nhận viết chậm và mắc lỗi.' },
      { id: 'verify', name: 'Verify', vi: 'Tự kiểm chứng', desc: 'Dùng debugger, log, DevTools, SQL và test để tìm hiểu chuyện gì thực sự xảy ra. Không sửa theo cảm tính.' },
      { id: 'accelerate', name: 'Accelerate', vi: 'AI tăng tốc', desc: 'Chỉ sau khi đã có cách giải quyết của riêng mình mới nhờ AI review, tìm phương án tốt hơn, phát hiện lỗ hổng.' }
    ],

    /* Bảy giới luật chống nhập ma */
    rules: [
      { id: 1, title: 'Không copy code khi chưa hiểu luồng chạy', detail: 'Mỗi đoạn code quan trọng phải trả lời được: đầu vào là gì, đầu ra là gì, nó gọi thành phần nào, có thể lỗi ở đâu và tại sao phải viết như vậy.' },
      { id: 2, title: 'Tự suy nghĩ trước khi hỏi AI', detail: 'Khi gặp lỗi, dành 15–30 phút tái hiện lỗi, đọc thông báo, đặt giả thuyết và thử nghiệm. Không vật lộn hàng giờ với lỗi ngoài phạm vi kiến thức.' },
      { id: 3, title: 'Không giao cả tính năng cho AI', detail: 'Chia tính năng thành phần nhỏ. Ví dụ với API tạo tài liệu: tự thiết kế request, validation, service, repository và test theo từng bước.' },
      { id: 4, title: 'Mỗi lần dùng AI phải có mục đích học tập', detail: 'Thay vì "viết giúp tôi API", hãy hỏi "tại sao transaction của tôi không rollback?" hoặc "review thiết kế hiện tại và chỉ ra rủi ro, chưa sửa code".' },
      { id: 5, title: 'Luôn kiểm tra code do AI đề xuất', detail: 'Đọc diff, chạy test, kiểm tra quyền truy cập và xem tác động đến module liên quan. Không chấp nhận bản sửa chỉ vì nó làm hết lỗi trước mắt.' },
      { id: 6, title: 'Không đo tiến bộ bằng số dòng code', detail: 'Đo bằng số vấn đề tự giải quyết được, số khái niệm giải thích được và khả năng debug khi không có AI.' },
      { id: 7, title: 'Định kỳ tái tạo mà không nhìn lời giải', detail: 'Đóng đoạn code mẫu, tự viết lại từ đầu trên bài toán nhỏ tương tự. Đây là cách kiểm tra mình thực sự lĩnh hội hay chỉ nhận ra code khi nhìn thấy.' }
    ],

    /* Bốn chế độ dùng AI */
    aiModes: [
      { id: 'A', name: 'Tự học, tự viết', score: 25, desc: 'Không nhờ AI sinh code. Dùng tài liệu chính thức, compiler, debugger và test.' },
      { id: 'B', name: 'Chỉ xin gợi ý', score: 18, desc: 'Yêu cầu AI giải thích khái niệm hoặc đưa gợi ý, không viết lời giải hoàn chỉnh. Tự triển khai.' },
      { id: 'C', name: 'Review và phản biện', score: 10, desc: 'Tự viết code trước. AI kiểm tra lỗi logic, bảo mật, hiệu năng, thiết kế nhưng chưa tự sửa.' },
      { id: 'D', name: 'Vibe coding có kiểm soát', score: 2, desc: 'Khi đã hiểu kiến trúc và tiêu chí nghiệm thu, giao AI sinh giao diện, boilerplate, test cơ bản. Sau đó phải review và kiểm chứng.' }
    ],

    /* Lịch tu luyện mỗi ngày */
    schedule: [
      { id: 'review', label: 'Ôn lại kiến thức và tự giải thích bằng lời', short: 'Ôn tập', minutes: 30, color: '#3b4a7a' },
      { id: 'docs', label: 'Đọc tài liệu, thử nghiệm một khái niệm nhỏ', short: 'Đọc tài liệu', minutes: 45, color: '#8a6a3d' },
      { id: 'build', label: 'Tự xây một phần của dự án', short: 'Tự xây', minutes: 90, color: '#2f6b52' },
      { id: 'debug', label: 'Debug, viết test và kiểm tra kết quả', short: 'Debug & test', minutes: 30, color: '#b08419' },
      { id: 'journal', label: 'Ghi nhật ký: hiểu gì, vướng gì, mai làm gì', short: 'Nhật ký', minutes: 15, color: '#9e2b1e' }
    ],

    journalQuestions: [
      { id: 'didToday', q: 'Hôm nay mình đã tự làm được gì?' },
      { id: 'misconception', q: 'Có khái niệm nào trước đây mình hiểu sai không?' },
      { id: 'hardestBug', q: 'Lỗi khó nhất là gì và nguyên nhân gốc ở đâu?' },
      { id: 'cantExplain', q: 'Phần code nào mình vẫn chưa thể giải thích?' },
      { id: 'canRedo', q: 'Nếu ngày mai không có AI, mình có thể tự làm lại phần nào?' }
    ],

    /* Năm cảnh giới */
    levels: [
      {
        id: 1, name: 'Hiểu một chương trình', weeks: 'Tuần 1', theme: 'Java Core và Git',
        skills: ['Java Core', 'Git', 'Unit test'],
        tasks: [
          'Tự viết các class User, Document, DocumentService',
          'Hiểu constructor, encapsulation, interface, collections và exception',
          'Dùng Git để commit từng thay đổi nhỏ',
          'Viết unit test cho một số quy tắc nghiệp vụ'
        ],
        pass: 'Tự viết lại một class và giải thích được vì sao từng phương thức tồn tại.'
      },
      {
        id: 2, name: 'Hiểu dữ liệu', weeks: 'Tuần 2', theme: 'SQL và thiết kế database',
        skills: ['SQL', 'Thiết kế bảng', 'Index'],
        tasks: [
          'Tự thiết kế bảng users, organizations, memberships, documents',
          'Thực hành primary key, foreign key, unique constraint và transaction',
          'Viết truy vấn tìm kiếm, sắp xếp và phân trang',
          'Tìm hiểu index bằng EXPLAIN ANALYZE trên PostgreSQL'
        ],
        pass: 'Tự giải thích được quan hệ giữa các bảng, viết truy vấn không phụ thuộc vào AI và chỉ ra vì sao một index có hoặc không có ích.'
      },
      {
        id: 3, name: 'Hiểu đường đi của request', weeks: 'Tuần 3–4', theme: 'HTTP và Spring Boot',
        skills: ['HTTP', 'Spring Boot', 'REST API'],
        tasks: [
          'Tạo REST API đầu tiên',
          'Tự viết controller, service, repository và DTO',
          'Dùng Postman hoặc Bruno gửi request',
          'Mở DevTools Network và đối chiếu request/response',
          'Tạo các lỗi có chủ đích để hiểu status code, validation và exception handling'
        ],
        pass: 'Huynh có thể lần theo một request từ trình duyệt đến database và giải thích dữ liệu đã đi qua những thành phần nào.'
      },
      {
        id: 4, name: 'Hiểu quyền và tính đúng đắn', weeks: 'Tuần 5–6', theme: 'Bảo mật và kiểm thử',
        skills: ['Xác thực', 'Phân quyền', 'Kiểm thử'],
        tasks: [
          'Xây đăng nhập và phân quyền',
          'Viết test cho người dùng không có quyền truy cập tài liệu',
          'Kiểm tra các trường hợp dữ liệu không hợp lệ và request lặp',
          'Học transaction, validation, logging và quản lý lỗi'
        ],
        pass: 'Huynh chứng minh được bằng test rằng người dùng không thể đọc hoặc sửa tài liệu ngoài phạm vi quyền hạn.'
      },
      {
        id: 5, name: 'Tự vận hành sản phẩm', weeks: 'Tuần 7 trở đi', theme: 'UI, tích hợp và triển khai',
        skills: ['UI', 'Tích hợp', 'Docker'],
        tasks: [
          'Dùng vibe coding để tạo giao diện dựa trên API contract đã chốt',
          'Tự kiểm tra các API bằng DevTools và công cụ HTTP',
          'Kết nối object storage hoặc dịch vụ email',
          'Đóng gói bằng Docker, triển khai môi trường thử nghiệm',
          'Tự tái hiện và debug lỗi từ log, debugger và database'
        ],
        pass: 'Có một tính năng chạy hoàn chỉnh từ giao diện đến database, có test và có thể giải thích cách xử lý lỗi.'
      }
    ],

    /* ---------------------- Theo dõi việc đọc ---------------------- */
    readingKinds: [
      { id: 'sach', label: 'Sách' },
      { id: 'tai-lieu', label: 'Tài liệu chính thức' },
      { id: 'khoa-hoc', label: 'Khoá học' },
      { id: 'bai-viet', label: 'Bài viết' }
    ],
    readingUnits: ['trang', 'chương', 'bài', 'giờ', '%'],
    readingStatuses: [
      { id: 'reading', label: 'Đang đọc' },
      { id: 'paused', label: 'Tạm dừng' },
      { id: 'done', label: 'Đã xong' }
    ],

    /* ---------------------- Quản lý nhóm theo Scrum ---------------------- */
    scrumColumns: [
      { id: 'todo', label: 'Cần làm', hint: 'Đã chốt cho sprint này' },
      { id: 'doing', label: 'Đang làm', hint: 'WIP — đừng kéo quá nhiều' },
      { id: 'review', label: 'Chờ duyệt', hint: 'Đã xong, cần người kiểm' },
      { id: 'done', label: 'Hoàn thành', hint: 'Đạt tiêu chí nghiệm thu' }
    ],
    priorities: [
      { id: 'cao', label: 'Cao', color: '#9e2b1e' },
      { id: 'vua', label: 'Vừa', color: '#b08419' },
      { id: 'thap', label: 'Thấp', color: '#6b7a5a' }
    ],
    storyPoints: [1, 2, 3, 5, 8, 13],
    retroQuestions: [
      { id: 'good', q: 'Điều gì đã tốt trong sprint này?' },
      { id: 'improve', q: 'Điều gì cần cải thiện?' },
      { id: 'actions', q: 'Hành động cụ thể cho sprint sau?' }
    ],
    memberColors: ['#9e2b1e', '#2f6b52', '#3b4a7a', '#b08419', '#7a4b8a', '#1f6f7a'],

    /* Định nghĩa "hoàn thành" để dán trên bảng Scrum */
    definitionOfDone: [
      'Code chạy được và đã tự đọc lại từng dòng',
      'Có test cho luồng chính và luồng lỗi',
      'Đã kiểm tra bằng dữ liệu thật, không chỉ dữ liệu mẫu',
      'Giải thích được cho người khác trong 2 phút'
    ]
  };
})(window);
