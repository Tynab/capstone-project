# Backend — API todo (Express + MongoDB)

API cho ứng dụng todo: tài khoản, task, và luồng quên/đặt lại mật khẩu qua email.
Toàn bộ mã dùng **ESM** (`"type": "module"`) — `import`/`export`, không `require`.

## Chạy

```bash
npm install
cp .env.example .env      # điền MONGO_URI và JWT_SECRET (bắt buộc, xem bên dưới)
npm start                 # http://localhost:8000
```

- **Thiếu `JWT_SECRET` thì server thoát ngay** — cố ý, để không chạy trong trạng thái
  mà mọi request xác thực đều lỗi 500 khó hiểu.
- **Không kết nối được MongoDB thì server cũng không mở cổng** (thoát mã 1) — trong
  docker-compose/swarm, container API thường khởi động trước khi Mongo sẵn sàng, nên
  cơ chế restart sẽ tự đưa nó lên.

## API

Mọi response là **object JSON** — kể cả lỗi: `{ message }` cho người đọc, key đặt theo
tài nguyên (`{ user, token }`, `{ tasks }`, `{ message, task }`…).

| Nhóm | Endpoint | Auth | Rate limit |
|---|---|---|---|
| `/api/health` | `GET /health` | không | không |
| `/api/user` | `POST /login`, `POST /register`, `GET /getuser` | `/getuser` | login 10/15ph · register 20/giờ |
| `/api/task` | `POST /addTask`, `GET /getTask`, `DELETE /removeTask/:id`, `PATCH /updateTask/:id` | tất cả | 3 route ghi: 100/15ph |
| `/api/forgotPassword` | `POST /forgotPassword`, `POST /resetPassword` | không | 5/giờ · 10/15ph |

Vài ràng buộc có chủ đích, **đừng gỡ khi sửa mã**:

- Lỗi đăng nhập dùng **cùng một thông báo** cho "email không tồn tại" và "sai mật khẩu",
  `forgotPassword` luôn trả cùng một câu — để không biến API thành công cụ dò email đã đăng ký.
- Mọi endpoint nhận dữ liệu từ `req.body` đều **tự kiểm tra kiểu**. Repo không bật
  `sanitizeFilter` toàn cục, nên đây là lớp chặn NoSQL operator injection duy nhất.
- Token reset mật khẩu chỉ được dùng **một lần**, lưu dạng SHA-256, hạn 15 phút; đổi mật
  khẩu xong thì mọi JWT cũ hết hiệu lực (`tokenVersion`).

## Test

```bash
npm test        # unit test (node --test) — không cần MongoDB
```

Test end-to-end (dựng mongod thật + backend thật) nằm ở [../e2e](../e2e/README.md).

## Cấu hình

Xem [.env.example](.env.example) — mỗi biến đều có ghi chú. Hai nhóm đáng chú ý:

- **Gửi mail**: điền `SMTP_HOST` để dùng SMTP riêng (lab dùng Mailpit), hoặc để trống và
  dùng `GMAIL_*` (phải là App Password). Thiếu cả hai thì API vẫn trả 200 nhưng không có
  mail nào được gửi — server cảnh báo lúc khởi động.
- **`TRUST_PROXY`**: chỉ bật khi chạy sau reverse proxy, nếu không rate limit đếm sai IP.

## Đóng gói & triển khai

Image dựng từ [Dockerfile](Dockerfile) (2 stage, `node:20-slim`, chạy bằng user `node`,
healthcheck gọi `/api/health`). CI build và deploy lên swarm — xem [../infra/README.md](../infra/README.md).

Chi tiết kiến trúc, các lỗi đã từng xảy ra và quy ước trong mã: [CLAUDE.md](CLAUDE.md).
