# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tổng quan

Backend Express 4 + Mongoose 6 cho ứng dụng todo, phục vụ frontend React ở `../frontend`. Toàn bộ mã dùng **ESM** (`"type": "module"`) — dùng `import`/`export`, không dùng `require`.

## Lệnh thường dùng

```bash
npm install                    # cài theo backend/package-lock.json có sẵn
npm start                      # = node server.js; không có nodemon
npm run migrate:userid         # migration một lần cho dữ liệu task cũ (xem bên dưới)
```

- Cần MongoDB local (`MONGO_URI` trong `.env`). Không kết nối được DB thì callback của `mongoose.connect` ghi log rồi `process.exit(1)`, còn `app.listen` chỉ chạy trong nhánh kết nối thành công — server **không mở cổng khi chưa có DB** ([server.js:64-102](server.js#L64-L102)).
- `JWT_SECRET` là bắt buộc: `server.js` thoát ngay khi thiếu biến này ([server.js:16-19](server.js#L16-L19)).
- Cổng lấy từ `PORT` (đang `8000`, fallback `8001`). Frontend gọi qua `REACT_APP_API_URL`, mặc định `http://localhost:8000/api` ([../frontend/src/api/client.js](../frontend/src/api/client.js)).
- `npm test` chạy unit test bằng `node --test` (Node tự quét `*.test.js`): `smtpConfig`, `mailTransport`, `password`, `rateLimit`, `userModel`. `npm run format` chạy Prettier (cấu hình ở `.prettierrc`, dùng chung quy ước với frontend). Test end-to-end thật nằm ở [../e2e](../e2e/README.md). Đóng gói và deploy: [../infra/README.md](../infra/README.md) (image dựng từ `backend/Dockerfile`, không cần Docker trên máy — build trong VM hoặc trên CI).

### Biến môi trường (.env)

`MONGO_URI`, `JWT_SECRET`, `PORT`, `GMAIL_USERNAME`, `GMAIL_PASSWORD`, `FRONTEND_URL`, `TRUST_PROXY`, `CORS_ORIGIN`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS` (bỏ trống `SMTP_HOST` = dùng Gmail như cũ). Mẫu ở `.env.example`; `.env` thật đã được `.gitignore` chặn vì dự án nộp qua GitHub.

- **Hai biến Gmail đang trống, nên hiện không mail nào gửi được.** Gửi mail là fire-and-forget — lỗi chỉ đi vào `logger` (không còn `console.log`), và `forgotPassword` cố ý không để lỗi lộ ra response (để không dò được email). Hệ quả: API trả 200 kèm thông báo "đã gửi link" trong khi thực tế không có mail nào tới. `server.js` cảnh báo lúc khởi động khi thiếu hai biến này; muốn chức năng quên mật khẩu chạy thật thì phải điền Gmail App Password.
- `FRONTEND_URL` là gốc frontend dùng để dựng link reset trong email.
- `TRUST_PROXY=1` chỉ đặt khi chạy sau reverse proxy (nginx/Caddy). **Đặt sai lúc không có proxy sẽ cho phép client giả `X-Forwarded-For` và vượt rate limit** ([server.js:31-34](server.js#L31-L34)); không đặt khi có proxy thì mọi request dùng chung một bucket. Đổi giá trị này phải khởi động lại server.

## Kiến trúc

`server.js` → `routes/` → `controllers/` → `models/`, với guard JWT ở `middleware/requireAuth.js` và giới hạn tần suất ở `middleware/rateLimit.js`.

| Prefix | Routes | Auth | Rate limit |
|---|---|---|---|
| `/api/health` | `/health` | không (probe không mang token) | không |
| `/api/user` | `/login`, `/register`, `/getuser` | chỉ `/getuser` | `/login` 10/15ph, `/register` 20/giờ |
| `/api/task` | `POST /addTask`, `GET /getTask`, `DELETE /removeTask/:id`, `PATCH /updateTask/:id` | tất cả | ba route GHI 100/15phút; `getTask` không giới hạn |
| `/api/forgotPassword` | `/forgotPassword`, `/resetPassword` | không | 5/giờ và 10/15ph |

### Xác thực

- JWT payload **`{id, tokenVersion}`**, hạn 3 ngày, secret `JWT_SECRET`. Vì payload là `{id}`, controller phải dùng **`req.user.id`**, không phải `req.user._id`.
- `requireAuth` lấy token bằng `authorization.split(' ')[1]`, verify chữ ký, rồi **đọc user từ DB** để so `user.tokenVersion === decoded.tokenVersion` ([middleware/requireAuth.js:14-16](middleware/requireAuth.js#L14-L16)). Vì vậy nó là middleware **async có truy vấn DB**, không còn thuần stateless.
- Mọi lỗi xác thực đều trả **401** với cùng một thông báo; không trả `error.message` để khỏi lộ chi tiết nội bộ.
- Token cũ không có `tokenVersion` sẽ bị từ chối — đổi cơ chế này làm toàn bộ người dùng phải đăng nhập lại.
- Mật khẩu hash bcrypt salt 10.

### Vòng đời reset password

`forgotPassword` sinh token thô 20 byte, **chỉ gửi token thô trong email**; DB lưu **SHA-256** của nó kèm `resetTokenExpiry` 15 phút ([models/userModel.js:8-9](models/userModel.js#L8-L9)). Hệ quả khi sửa:

- `resetToken` trong DB là hash — đọc được collection cũng không dùng được token.
- `resetPassword` tra `{resetToken: sha256(token), resetTokenExpiry: {$gt: new Date()}}` bằng **`findOneAndUpdate`** — phải giữ nguyên tác nguyên tử này, vì `findOne` rồi `save` sẽ cho hai request song song cùng token cùng qua và cùng ghi, phá vỡ tính dùng-một-lần. Token hết hạn hoặc token cũ (không có `resetTokenExpiry`) đều bị loại. Hằng số hạn ở `RESET_TOKEN_TTL_MS` đầu [forgotPasswordController.js](controllers/forgotPasswordController.js).
- Trước `findOneAndUpdate` có một `userModel.exists(...)` cùng điều kiện. Đó **không** phải chốt kiểm tra chính (tính nguyên tử nằm ở `findOneAndUpdate`), mà để token rác bị loại trước khi tốn một lần bcrypt cost 10 — hash trước khi kiểm token là mở đường DoS bằng request rác.
- Đổi mật khẩu xong thì tăng `user.tokenVersion` → **mọi JWT phát hành trước đó hết hiệu lực**, kể cả token đã bị đánh cắp.
- Đổi cách hash hay cách đặt hạn phải sửa đồng thời cả chỗ ghi (trong `forgotPassword`) và chỗ đọc (trong `resetPassword`).

### Dò tài khoản (user enumeration)

`loginUser` trả **cùng một thông báo "Invalid credentials"** cho cả email không tồn tại lẫn sai mật khẩu, và `forgotPassword` luôn trả cùng một câu chung dù email có trong DB hay không. Đừng tách hai nhánh ra thành hai thông báo khác nhau — làm vậy là mở lại công cụ dò email đã đăng ký.

`registerUser` vẫn trả `"User already exists"` — đây là oracle còn hở, chấp nhận vì UX đăng ký cần biết email đã dùng; bù lại bằng rate limit.

### Rate limit

`middleware/rateLimit.js` là cửa sổ cố định, lưu trong `Map` của tiến trình. Khoá là `limiterId:req.ip`, trong đó **`limiterId` sinh tự động cho mỗi lần gọi `rateLimit()`**, không phải URL.

- **Không được đưa URL vào khoá.** Bản đầu dùng `req.originalUrl`, nhưng biến này giữ cả query string, nên chỉ cần thêm `?x=1` vào mỗi request là mỗi lần một bucket mới — giới hạn không bao giờ chạm tới. Lỗi này đã từng xảy ra thật, đừng lặp lại.
- `Map` có trần `MAX_BUCKETS`: chạm trần thì xoá bucket hết hạn trước, sau đó xoá dần bucket cũ nhất.
- Chỉ đúng cho **một instance**. Chạy nhiều container thì mỗi instance đếm riêng, giới hạn thực tế nhân theo số instance — muốn chính xác phải thay bằng store dùng chung (Redis).
- Bộ đếm mất khi restart, và không reset khi đăng nhập thành công.
- `req.ip` là địa chỉ socket; muốn ra IP thật sau proxy thì đặt `TRUST_PROXY=1`.

### Phía frontend

[../frontend/src/api/client.js](../frontend/src/api/client.js) có response interceptor cho **401**: luôn xoá `authToken` khỏi localStorage, nhưng **chỉ chuyển hướng về `/login` khi đang ở trang cần đăng nhập**.

Cần thiết vì sau khi đổi mật khẩu (hoặc token hết hạn), `requireAuth` từ chối token cũ — không có interceptor thì token cũ nằm lại và UI vẫn hiển thị trạng thái ảo cho tới khi người dùng tự bấm Logout.

`PUBLIC_PATHS` trong file đó liệt kê các trang được miễn chuyển hướng. **Đừng rút ngắn danh sách này**: người dùng còn token cũ mở link reset trong email sẽ bị `App.js` gọi `getUser` → 401 → đá sang `/login` trước khi form kịp hiện, làm mất token nằm trên query string.

**Địa chỉ backend phải khớp nhau khi deploy.** Frontend đọc `REACT_APP_API_URL` (CRA nhúng biến `REACT_APP_*` vào bundle **lúc build**, nên đổi giá trị phải build lại), backend dựng link reset từ `FRONTEND_URL`. Bản đầu để cứng `http://localhost:8000/api` phía frontend và `https://todo-app-b96a5.web.app` phía backend — bản deploy khi đó gọi vào chính máy người dùng nên luồng reset không bao giờ tới backend. Sửa một trong hai mà quên cái kia sẽ tái hiện đúng lỗi này.

### Chống NoSQL operator injection — không được gỡ các guard này

Các endpoint nhận giá trị từ `req.body` đưa vào filter Mongo đều phải tự kiểm tra kiểu (`typeof x !== 'string'`). **Không có sanitizer toàn cục** (`sanitizeFilter` không được bật), nên đây là lớp phòng vệ duy nhất. Lý do cụ thể, không phải để cho đẹp:

- `findOne({resetToken: null})` khớp **mọi user chưa từng yêu cầu reset** (Mongo coi `null` khớp cả field bị thiếu) → ghi đè mật khẩu người khác, chiếm tài khoản không cần xác thực.
- `{"$ne": null}` hoặc object operator khác cũng lọt vào filter nếu không chặn kiểu.

Guard hiện có ở `loginUser`, `registerUser`, `forgotPassword`, `resetPassword`. **Thứ tự quan trọng**: trong `registerUser`, validate phải chạy *trước* `findOne({email})`.

### Hợp đồng API

Mọi response đều là **object JSON**: `message` cho người đọc, key đặt theo tài nguyên. Điều này đúng cả với lỗi hạ tầng: có catch-all 404 và error handler 4 tham số (đặt sau các router trong [server.js](server.js)) nên JSON sai định dạng trả `400 {message}` và đường dẫn lạ trả `404 {message}` — không bao giờ là trang HTML kèm stack trace.

- `{user, token}` — `/user/login`, `/user/register`.
- `{user}` — `/user/getuser` (404 nếu không tìm thấy).
- `{tasks}` — `/task/getTask`.
- `{message, task}` — `/task/addTask` (201) và `/task/updateTask/:id`.
- `{message}` — các endpoint còn lại, kể cả 429 của rate limit.

Object `user` trong mọi response đều đi qua whitelist `toSafeUser` ở [userController.js](controllers/userController.js) — chỉ trả `_id`, `name`, `email`. Đây là **whitelist**, nên field mới thêm vào `userModel` (`resetToken`, `tokenVersion`…) mặc định **không** lộ ra API; muốn client thấy thì phải sửa `toSafeUser`. (Frontend chỉ dùng `user.name`.)

### Quy ước route dễ nhầm

- `POST /addTask` trả **201** kèm `task` vừa tạo (có `_id`, `createdAt`) — client dùng luôn object đó thay vì tự dựng task ở phía nó. Đổi shape này thì phải sửa `../frontend/src/api/taskApi.js`.
- `DELETE /removeTask/:id` và `PATCH /updateTask/:id` đọc id từ **`req.params`**. Bản đầu là `GET /removeTask` đọc `req.body.id` — trình duyệt không gửi body kèm GET nên id luôn `undefined` và endpoint không bao giờ chạy được. Đừng quay lại kiểu đó, và cũng đừng để hành động xoá nằm sau GET.
- Cả hai dùng `findOneAndDelete`/`findOneAndUpdate` với `{_id, userId: req.user.id}` — chỉ thao tác được trên task của chính mình, trả 404 khi không khớp (không phân biệt "không tồn tại" với "của người khác"). Có guard `mongoose.Types.ObjectId.isValid(id)` trước truy vấn để không lộ CastError.
- `PATCH /updateTask/:id` chỉ nhận `completed` kiểu boolean; giá trị khác trả 400.
- Route tên `"/getuser"` còn frontend gọi `"/user/getUser"`; khớp được vì Express mặc định không phân biệt hoa/thường — đã có test runtime ở [../e2e/api.e2e.mjs](../e2e/api.e2e.mjs).
- `taskModel.userId` là **`ObjectId` ref tới `User`, có index**. Dữ liệu tạo trước bản này lưu userId dưới dạng **chuỗi**, nên phải chạy `npm run migrate:userid` một lần: Mongoose cast giá trị truy vấn thành ObjectId nên `{ userId: req.user.id }` sẽ không khớp bản ghi cũ, và task biến mất khỏi UI dù vẫn nằm trong DB. `server.js` đếm bản ghi cũ lúc khởi động và báo lỗi nếu còn sót.

### Ghi chú khác

- CORS chỉ cho các origin trong `CORS_ORIGIN` (phân tách bằng dấu phẩy; mặc định `http://localhost:3000,https://todo-app-b96a5.web.app`). Origin lạ bị từ chối bằng cách không gắn header CORS — cố ý không ném Error để khỏi sinh lỗi 500 vô nghĩa trong log.
- `helmet()` đặt các header phòng thủ; `express.json()` thay cho `body-parser`.
- Link reset dựng từ `FRONTEND_URL`, `from` của mail lấy từ `GMAIL_USERNAME`; cả hai vẫn còn giá trị dự phòng hardcode khi thiếu env (`https://todo-app-b96a5.web.app` và `alok.yadav6000@gmail.com` — [forgotPasswordController.js:17,63](controllers/forgotPasswordController.js#L17), [mailService.js:9](services/mailService.js#L9)).
- Mail "Task Added" nằm ở [services/mailService.js](services/mailService.js) (`sendTaskAddedMail`) và `taskController` không tự tạo transporter nữa; **mail reset thật vẫn dựng transporter ngay trong controller** ([forgotPasswordController.js:45](controllers/forgotPasswordController.js#L45)). Hàm này tự bỏ qua khi thiếu credentials thay vì ném lỗi.
- Mật khẩu tối thiểu **8 ký tự** (`MIN_PASSWORD_LENGTH`), kiểm ở cả `registerUser` và `resetPassword`.
- Log đi qua [utils/logger.js](utils/logger.js) — có mức `error|warn|info|debug`, đặt bằng `LOG_LEVEL`, kèm timestamp và tách stderr. Đừng gọi `console.*` trực tiếp trong mã chạy. Logger đọc `LOG_LEVEL` **lúc gọi** chứ không lúc import, vì `dotenv.config()` chạy sau khi các module đã được nạp.
- Hai dependency `body-parser` và `crypto` đã được gỡ khỏi `package.json`; thư mục `scheduler/` (rỗng, không được import) đã xoá.
- **Server chỉ mở cổng sau khi kết nối được DB**: `mount route` và `app.listen` nằm trong callback của `mongoose.connect`, DB không tới được thì thoát mã 1 để Docker khởi động lại. Callback đó chỉ chạy sau `serverSelectionTimeoutMS` (mặc định 30s) — đừng hạ thấp, vì trong docker-compose container API thường lên trước khi Mongo sẵn sàng.
- Script một lần nằm ở [scripts/](scripts/); chúng dùng `console.*` trực tiếp vì là công cụ dòng lệnh, không phải mã chạy trong server.
- Backend không có unit test riêng; kiểm chứng end-to-end bằng bộ test ở [../e2e](../e2e/README.md) (`npm run test:api`, `npm run test:browser`) — bộ test tự dựng `mongod` thật qua `mongodb-memory-server` nên không cần cài MongoDB sẵn.
