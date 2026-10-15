# Checklist sửa lỗi theo kết quả code review

Nguồn: báo cáo review 2 lượt (98 agent, 130 phát hiện thô, 28 phát hiện được phản biện 3 lớp).
Quy ước ID: **A** = lỗi nghiêm trọng (chấm ≥80), **B** = nên sửa (75 + bảo mật gần ngưỡng), **C** = chất lượng/UX/conventions.

Trạng thái: **đã xong toàn bộ A + B + C**.

> **Cập nhật 2026-10-16 — đọc trước, phần dưới là bản ghi lịch sử:**
> - Repo hiện ở `D:/capstone-project` với **một** commit `aa96208` (Initial commit). Các hash trong tài liệu này (`ff8dd63`, `713d1dd`, `80f302d`, `626ff1c`) không còn tồn tại.
> - `backend/scheduler/` **đã được xoá** (hết mục "xoá thủ công").
> - Đã có bộ test e2e thật ở `../e2e` (`npm run test:api`, `npm run test:browser`) — trả lời cho mục 4.6 (`app.listen` chạy dù DB lỗi: đã sửa, xem `backend/server.js`) và cho dòng "**Chưa kiểm chứng:** UI trong trình duyệt thật" ở cuối file.

---

## Bước 0 — Chuẩn bị

- [x] **0.1** `git init` + commit — repo ở gốc `D:/DevOps 04`, 4 commit: `ff8dd63` (mốc đầu) → `713d1dd` (refactor) → `80f302d` (chỉ mở cổng khi có DB) → `626ff1c` (prettier). Bản sao lưu tạm đã xoá.
- [x] **0.2** `.env` đã được ignore ở `backend/.gitignore` (`node_modules/`, `.env`, `*.log`).
- [x] **0.3** `npm install` đã chạy; `npm run build` biên dịch sạch, không cảnh báo lint.
- [x] **0.4** Số dòng đã được kiểm lại sau mỗi lần sửa.

---

## Bước 1 — Chuyển định danh task sang `_id` — XONG

- [x] **1.1** `[B2]` `AllTask`/`Active`/`Completed` truyền `key={task._id}`; `Task.jsx` đọc `task._id` trực tiếp, không còn prop `id` theo index.
- [x] **1.2** `[B2]` `taskReducer` lọc/ánh xạ theo `_id`, không theo `index`.
- [x] **1.3** `[B2]` `ADD_TASK` nhận task đầy đủ từ server (`action.task`).
- [x] **1.4** `[B2]` `addTask` trả **201** kèm `task` mới (có `_id`, `createdAt`).
- [x] **1.5** `[C20]` `key` là `_id` ở cả 3 danh sách.

## Bước 2 — Cho xoá và hoàn thành thực sự lưu xuống DB — XONG

- [x] **2.1** `[A2]` `DELETE /api/task/removeTask/:id`, đọc `req.params.id`.
- [x] **2.2** `[A1]` Thêm `PATCH /api/task/updateTask/:id` cập nhật `completed`.
- [x] **2.3** `[A1]` `Task.jsx` gọi API trước, **chỉ dispatch khi thành công**, có thông báo lỗi và khoá nút khi đang chờ.
- [x] **2.4** `[B1]` `dispatch(ADD_TASK)` nằm trong `try`, POST lỗi thì không thêm task ảo.

## Bước 3 — Lớp API và cấu hình `baseURL` — XONG

- [x] **3.1** `[B3]` `src/api/` (`client`, `authApi`, `taskApi`); không component nào gọi axios trực tiếp.
- [x] **3.2** `[B3]` Request interceptor gắn `Authorization`; đã bỏ cả 3 chỗ dựng header bằng tay.
- [x] **3.3** `[B3]` `getErrorMessage` dùng chung cho mọi chỗ hiển thị lỗi.
- [x] **3.4** `[A3]` `baseURL` đọc từ `REACT_APP_API_URL`; có `frontend/.env.example`.
- [x] **3.5** `[A3]` Thống nhất cổng: `.env` đặt `PORT=8000`, `.env.example` ghi rõ.

## Bước 4 — Chặn rò rỉ thông tin và gia cố xử lý lỗi — XONG

- [x] **4.1** `[A4]` Cả 6 catch (userController, taskController) trả thông báo chung, chi tiết ghi `console.error`.
- [x] **4.2** `[A4]` Lỗi `E11000` được map về 400 "User already exists".
- [x] **4.3** `[C2]` 4 form dùng `getErrorMessage`, không còn đọc thẳng `error.response.data.message`.
- [x] **4.4** `[C21]` `await userModel.findById()` đã nằm trong `try/catch`.
- [x] **4.5** `[C22]` Bỏ mã lỗi 501/502, dùng 500.
- [x] **4.6** `[C29]` Log đi qua `backend/utils/logger.js`: có mức (`LOG_LEVEL`), timestamp, tách stderr; không còn `console.*` trong mã chạy.
  - [ ] Phần còn lại của C29: `app.listen` vẫn chạy dù DB không kết nối (đã quan sát trong smoke test: server mở cổng và không báo lỗi kết nối trong ~13s đầu). Muốn chặt thì chuyển `app.listen` vào trong callback của `mongoose.connect`.
- [x] **4.7** `[B5b, C31]` Chống dò email qua thời gian: `/login` luôn tốn một lần bcrypt (hash giả khi không có user); `/forgotPassword` không còn `await` gửi mail.
- [x] **4.8** `[B5c]` Mật khẩu tối thiểu 8 ký tự ở `register` + `resetPassword` + `minLength` phía form.
- [x] **4.9** `[B5a]` `tokenVersion` đã có sẵn (do phiên song song thêm) — token cũ bị từ chối sau khi đổi mật khẩu.
- [x] **4.10** `[B6a]` CORS whitelist theo `CORS_ORIGIN`.
- [x] **4.11** `[B6b]` Thêm `helmet`.
- [x] **4.12** `[B4]` Thêm `ErrorBoundary` bọc `App`.

## Bước 5 — Dọn dẹp chất lượng, UX và conventions

### Log và code chết — XONG
- [x] **5.1** `[C1]` 0 dòng `console.log` còn lại trong `src` (đã grep).
- [x] **5.2** `[C16]` Xoá block toast, `div` "This is test", `.addTask`, và xoá hẳn `createTask.css` (chỉ chứa rule `.toast` chết).
- [x] **5.3** `[C16]` `UNSET_TOKEN`/`UNSET_USER` giờ được dùng thật trong logout.

### CSS và UI — XONG
- [x] **5.4** `[C3]` Xoá rule chết `task-container` trong `App.css`.
- [x] **5.5** `[C4]` `NavLink to="/"` có prop `end`.
- [x] **5.6** `[C5]` `Active`/`Completed` lọc trước rồi mới kiểm tra rỗng.
- [x] **5.7** `[C9]` Bỏ các class `dark:` nửa vời (không có cơ chế bật).

### A11y và form — XONG
- [x] **5.8** `[C7]` Mọi input có `<label>` thật (`sr-only` để giữ thiết kế).
- [x] **5.9** `[C7]` Bỏ ô "Remember me" không điều khiển gì.
- [x] **5.10** `[C7]` `alt` có nghĩa.
- [x] **5.11** `[C10]` Nút xoá là `<button>` thật, có `aria-label`, focus bằng bàn phím được.
- [x] **5.12** `[C6]` Nút submit `disabled` khi đang gửi ở Login/Register/CreateTask.
- [x] **5.13** `[C8]` Bỏ nút Facebook/Twitter giả và rác template MDB.

### Cấu trúc và nhất quán
- [x] **5.14** `[C11]` `AUTH_TOKEN_KEY` trong `src/constants.js`.
- [x] **5.15** `[C12]` `TASK_ACTIONS`/`AUTH_ACTIONS` thay cho chuỗi rải rác.
- [x] **5.16** `[C13]` Một nguồn sự thật cho auth; logout dispatch thay vì reload.
- [x] **5.17** `[C14]` Component `FormAlert` dùng chung.
- [x] **5.18** `[C15]` Chuẩn hoá cấu trúc: mọi component là file phẳng trong `src/components/` (PascalCase `.jsx`); CSS gom về `src/styles/`; bỏ 4 thư mục component cũ. Quy ước đã ghi vào `CLAUDE.md`.
- [x] **5.19** `[C17]` Thêm `.prettierrc` + script `npm run format`. **Chưa chạy format toàn bộ** — sẽ tạo diff khổng lồ trên cả file không liên quan; nên chạy một lượt riêng khi đã có git.

### Hiệu năng — XONG
- [x] **5.20** `[C18]` Gỡ `@mui/*`, `@emotion/*`, `styled-engine-sc`; icon xoá là SVG nội bộ.
- [x] **5.21** `[C19]` Gỡ `moment`; dùng `Intl.RelativeTimeFormat`.
- [x] **5.22** `[C20]` `value` của cả 2 context bọc `useMemo`.

### Backend
- [x] **5.23** `[C23]` Envelope thống nhất: `{tasks}`, `{message, task}`, `{user, token}`, `{user}`, `{message}`.
- [x] **5.24** `[C24]` `addTask` có validate kiểu + rỗng.
- [x] **5.25** `[C25]` `userId` đổi sang **`ObjectId` ref tới `User` + index**; kèm `scripts/migrate-task-userid-to-objectid.js` (`npm run migrate:userid`, idempotent) và cảnh báo lúc khởi động nếu DB còn bản ghi kiểu chuỗi.
- [x] **5.26** `[C26]` Gỡ `body-parser`, `crypto`; sửa `main` thành `server.js`; thêm script `start`. `scheduler/scheduler.js` (0 byte, không ai import) **không xoá được do quyền** — xoá thủ công nếu muốn.
- [x] **5.27** `[C27]` `from` lấy từ `GMAIL_USERNAME`; link reset dựng từ `FRONTEND_URL`; `CORS_ORIGIN` thêm vào `.env.example`.
- [x] **5.28** `[C28]` Tách `services/mailService.js`; controller không tự tạo transporter.
- [x] **5.29** `[C30]` `TRUST_PROXY` đã có trong `.env.example` kèm cảnh báo hai chiều. Đặt `=1` khi chạy sau nginx.
- [x] **5.30** `[C32]` `mailService` tự bỏ qua và cảnh báo khi thiếu credentials; `addTask` không chờ mail.
- [x] **5.31** `[C33]` `forgotPassword` không còn chặn response bằng độ trễ SMTP.

---

## Bảng đối chiếu — mọi mục A/B/C đều có bước

| Nhóm | ID → bước |
|---|---|
| **A** | A1 → 2 ✅ · A2 → 2 ✅ · A3 → 3 ✅ · A4 → 4 ✅ |
| **B** | B1 → 2 ✅ · B2 → 1 ✅ · B3 → 3 ✅ · B4 → 4 ✅ · B5a → 4.9 ✅ · B5b → 4.7 ✅ · B5c → 4.8 ✅ · B6a → 4.10 ✅ · B6b → 4.11 ✅ |
| **C** | C1 → 5.1 ✅ · C2 → 4.3 ✅ · C3 → 5.4 ✅ · C4 → 5.5 ✅ · C5 → 5.6 ✅ · C6 → 5.12 ✅ · C7 → 5.8-5.10 ✅ · C8 → 5.13 ✅ · C9 → 5.7 ✅ · C10 → 5.11 ✅ · C11 → 5.14 ✅ · C12 → 5.15 ✅ · C13 → 5.16 ✅ · C14 → 5.17 ✅ · C15 → 5.18 ✅ · C16 → 5.2-5.3 ✅ · C17 → 5.19 ✅ · C18 → 5.20 ✅ · C19 → 5.21 ✅ · C20 → 5.22 ✅ · C21 → 4.4 ✅ · C22 → 4.5 ✅ · C23 → 5.23 ✅ · C24 → 5.24 ✅ · C25 → 5.25 ✅ · C26 → 5.26 ✅ · C27 → 5.27 ✅ · C28 → 5.28 ✅ · C29 → 4.6 ✅ · C30 → 5.29 ✅ · C31 → 4.7 ✅ · C32 → 5.30 ✅ · C33 → 5.31 ✅ |

---

## Kiểm chứng end-to-end (2026-10-16)

Chạy `node e2e.mjs` trong `d:/tmp/todo-e2e/` — dựng MongoDB tạm trong bộ nhớ, chạy **đúng server thật**, không đụng DB của dự án. **23 kiểm tra, 22 đạt.**

Đạt (những cái quan trọng nhất):

- ★ **Trạng thái hoàn thành được lưu** — PATCH `updateTask` rồi GET lại vẫn `completed: true`.
- ★ **Xoá được lưu** — DELETE `removeTask` rồi GET lại không còn task. Đây chính là hai tính năng trước đây chỉ là state ảo.
- ★ **Server không mở cổng khi DB không tới được** — thoát mã 1 (xem ghi chú bên dưới).
- Migration `userId` chuỗi → ObjectId chạy đúng, và **idempotent** (chạy lần 2 không đổi gì).
- Phân quyền: user khác không sửa/xoá được task (404); không token thì 401.
- Validate: mật khẩu 1 ký tự bị từ chối; `completed` không phải boolean bị từ chối; id sai định dạng trả 404 chứ không lộ CastError.
- Không rò rỉ: đăng ký trùng email trả `{"message":"User already exists"}`, không có `E11000`/tên collection; login trả cùng thông báo cho "email lạ" và "sai mật khẩu".
- Envelope đúng như tài liệu: `{tasks: []}`, `{user, token}`, 201 kèm `task`.

**1 mục báo đỏ là do ngân sách chờ của test, không phải lỗi code:** test chờ 25s trong khi callback lỗi của Mongoose chỉ chạy sau `serverSelectionTimeoutMS` (mặc định 30s). Chạy lại riêng: server thoát mã 1 sau **30.4s**.

**Chưa kiểm chứng:** UI trong trình duyệt thật (không chạy headless browser). Luồng đã kiểm là ở tầng HTTP — đủ để khẳng định dữ liệu được lưu, nhưng chưa khẳng định được giao diện hiển thị đúng sau mỗi thao tác.

---

## D. Đã xem xét và cố ý KHÔNG làm

Ghi lại để không ai "sửa" nhầm thành lỗi:

- **`getTask` trả nguyên document Mongoose** (chấm 40) — hiện chưa lộ gì: schema `Task` chỉ có `title/description/userId/completed`, query đã lọc theo `userId`.
- **"Rate limit vượt được bằng `?x=1`"** (chấm 0) — **false positive**, dựa trên code cũ. `rateLimit.js` dùng `${limiterId}:${req.ip}`, query string không tham gia vào key.
- **Login gắn cả `onClick` lẫn `onSubmit`** (chấm 50) — nay đã bỏ `onClick` thừa.
- **`taskController` trộn 3 phong cách async** (chấm 50) — đã đồng nhất sang `async/await` trong lúc viết lại.
- **Thêm TypeScript / test coverage / i18n** — ngoài phạm vi, không phải lỗi.
