# Backlog review — kết quả xác minh

Các vòng review trước trong phiên này nêu ra **102 phát hiện** nhưng chỉ **42** từng được
phản biện để kết luận. File này ghi lại kết quả xác minh **60 phát hiện còn lại**, đối
chiếu với mã nguồn tại thời điểm chạy.

Cách chạy lại: đọc `never-verified.json` (nếu còn) và đối chiếu với mã hiện tại — phần
lớn trong số này là vấn đề chất lượng, không phải lỗ hổng.

## Kết quả

| Kết luận | Số lượng |
|---|---|
| Đã được sửa trong lúc refactor | 38 |
| **Còn đúng với mã hiện tại** | **15** |
| Lỗi thời (file/đối tượng không còn) | 3 |
| Sai ngay từ đầu | 1 |

Sau khi đọc lại 18 mục được đánh "còn đúng", 3 mục nữa được loại (2 đã được sửa trong
lúc chạy — `scheduler/scheduler.js` đã bị xoá, `server.js` đã `process.exit(1)` khi
không kết nối được DB; 1 mục tự nhận là "chấp nhận được, không cần sửa").

**Không còn mục nào ở mức nghiêm trọng.** 15 mục còn lại: 3 medium, 7 low, 5 nit.

## Còn đúng — 3 mục medium

### 1. Không có middleware xử lý lỗi, cũng không có bắt 404 — `backend/server.js`

Chuỗi middleware chỉ có `helmet`, `express.json`, `cors` rồi tới 3 router và `app.listen`.
Không có handler 4 tham số nào (grep `(err, req, res, next)`: 0 kết quả).

Hệ quả: JSON sai định dạng gửi tới bất kỳ route nào — kể cả `/api/user/login` công khai —
rơi vào handler mặc định của Express, trả về **trang HTML kèm stack trace** (vì `.env`
không đặt `NODE_ENV`), thay vì envelope `{message}` như phần còn lại của API. Đường dẫn
không tồn tại cũng vậy.

Sửa: thêm một catch-all 404 và một error handler 4 tham số trả JSON, đặt sau các router.

### 2. Mỗi mail dựng một transport mới, và `/addTask` không có rate limit — `backend/services/mailService.js`

`mailService.js` và `forgotPasswordController.js` đều tạo transport mới cho từng thư,
không bật `pool`. Mỗi lần thêm task là một lần bắt tay TCP + TLS + SMTP AUTH đầy đủ tới
`smtp.gmail.com`.

Kèm theo: `taskRoute.js` là route ghi duy nhất **không** có rate limiter, nên một tài
khoản đã đăng nhập có thể kích hoạt gửi mail không giới hạn.

## Còn đúng — 7 mục low

- **`models/userModel.js`**: `resetToken` không có index, nhưng `resetPassword` chạy hai
  truy vấn lọc trên nó mỗi lần thử (`exists` rồi `findOneAndUpdate`).
- **`middleware/rateLimit.js`**: khi `Map` chạm `MAX_BUCKETS`, `evict()` quét toàn bộ
  10.000 phần tử mỗi request; comment trong file vẫn nói chi phí "được chia đều".
- **`controllers/taskController.js`**: `addTask` truy vấn `userModel` chỉ để lấy email
  nhận thông báo — thêm một truy vấn users cho mỗi lần thêm task, trong khi `requireAuth`
  đã tải cùng document đó.
- **`controllers/userController.js`**: chính sách bcrypt cost 10 viết lặp ở hai controller,
  không có helper dùng chung.
- **`controllers/forgotPasswordController.js`**: `dotenv.config()` gọi ở 4 module; `FRONTEND_URL`
  đọc lúc import nên tính đúng phụ thuộc thứ tự nạp module.
- **`middleware/requireAuth.js`**: `req.token = token` là gán chết — không nơi nào đọc.
- **`routes/userRoute.js`**: route đăng ký là `/getuser` (chữ thường) còn frontend gọi
  `/user/getUser`; cặp này chỉ khớp nhờ Express mặc định không phân biệt hoa/thường.
  **Đã có test chạy thật cho điều này** — xem `e2e/api.e2e.mjs`.

## Còn đúng — 5 mục nit (định dạng)

Không ảnh hưởng hành vi, nhưng nên chuẩn hoá một lần bằng formatter:

- Trích dẫn chuỗi trộn giữa nháy đơn và nháy kép, cả giữa các file lẫn trong một file.
- `forgotPasswordController.js` lệch lưới thụt lề 4 khoảng trắng (36 dòng).
- Dấu chấm phẩy kết câu không nhất quán.
- `taskModel.js` khai báo `const taskInstance = mongoose.Schema({` (thiếu `new`, tên khác)
  trong khi `userModel.js` dùng `const userSchema = new mongoose.Schema(`.
- Khoảng trắng quanh `{`, `(`, `if` khác nhau giữa các file.

Backend chưa có cấu hình Prettier/ESLint (chỉ frontend có `.prettierrc`), nên các lệch
này sẽ tiếp tục sinh ra.

## Điều đáng chú ý nhất về con số này

Trong 60 phát hiện chưa từng được xác minh, **38 mục đã được sửa** — bởi đợt refactor
song song, không phải bởi việc xác minh này. Nói cách khác: phần lớn "nợ" đã tự trả
trước khi tôi kịp kiểm tra. Con số ban đầu tôi báo cho PO ("khoảng 22") cũng sai — tôi
đếm thiếu một vòng review.
