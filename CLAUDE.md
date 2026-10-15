# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dự án này là gì

Ứng dụng todo 3 phần — React (CRA) + Express/Mongoose + MongoDB — nhưng **mục đích thật của repo là bài cuối khóa CyberSoft DevOps 04**. Đề bài ở [du-an-cuoi-khoa.md](du-an-cuoi-khoa.md) yêu cầu **2 hạng mục**: dựng CICD bằng **GitHub Actions** và dựng hệ thống giám sát **Grafana + Prometheus**.

Trong repo **chưa có hạng mục nào**: không `.github/` (workflow), không cấu hình Prometheus/Grafana; ứng dụng cũng chưa được đóng gói (không `Dockerfile`, không `docker-compose*`). Phần mã ứng dụng thì đã qua refactor và nhiều vòng review. Nghĩa là khi được yêu cầu "dựng CICD / thêm giám sát", đó là **nội dung được chấm điểm**, không phải việc phụ — và không có sẵn khuôn mẫu nào trong repo để bắt chước.

## Bản đồ repo và thứ tự đọc

| Thư mục | Vai trò | Manifest chi tiết |
|---|---|---|
| [backend/](backend/) | API Express 4 + Mongoose 6, ESM, JWT, reset password qua mail | [backend/CLAUDE.md](backend/CLAUDE.md) |
| [frontend/](frontend/) | CRA 5 + React 18 + Tailwind, JavaScript thuần | [frontend/CLAUDE.md](frontend/CLAUDE.md) |
| [e2e/](e2e/) | Test trên hạ tầng thật: mongod thật + backend + Chrome thật | [e2e/README.md](e2e/README.md) |

Hai file CLAUDE.md ở thư mục con là bản chi tiết (kiến trúc, guard bảo mật, các lỗi đã từng xảy ra thật) — **đọc file tương ứng trước khi sửa `backend/` hoặc `frontend/`**. File ở gốc này chỉ chứa thứ liên quan nhiều phần cùng lúc.

Tài liệu trạng thái: [CODE_REVIEW_BACKLOG.md](CODE_REVIEW_BACKLOG.md) (15 phát hiện còn đúng với mã hiện tại, không mục nào nghiêm trọng) và [frontend/CODE_REVIEW_CHECKLIST.md](frontend/CODE_REVIEW_CHECKLIST.md) (đã xong toàn bộ A/B/C).

Quy ước tài liệu: manifest duy nhất là `CLAUDE.md` (kể cả bản trong thư mục con). Không tạo `AGENTS.md` hay `.clinerules/`.

## Lệnh

Ba thư mục có `package.json` **độc lập**, mỗi thư mục `npm install` riêng. Không có package workspace, không có lệnh nào chạy cả repo từ gốc.

### Backend — [backend/](backend/)

```bash
cd backend
npm install
npm start                  # = node server.js, không có nodemon
npm run migrate:userid     # migration một lần cho task cũ có userId kiểu chuỗi
```

- Cần `.env` (mẫu ở [backend/.env.example](backend/.env.example)). Thiếu `JWT_SECRET` thì server `process.exit(1)` ngay; không kết nối được MongoDB thì **không mở cổng** và thoát mã 1 — muốn chạy được phải có `MONGO_URI` trỏ tới Mongo thật.
- `npm test` là placeholder `exit 1`. Backend không có test, không có ESLint, không có Prettier config (chỉ frontend có `.prettierrc`).

### Frontend — [frontend/](frontend/)

```bash
cd frontend
npm install
npm start                  # dev server tại http://localhost:3000
npm run build              # build production vào build/ (đã có sẵn, bị .gitignore chặn)
npm run format             # prettier --write "src/**/*.{js,jsx,css}" — chỉ áp dụng cho src/
```

- `npm test` là jest ở watch mode; repo **không có file test nào** ở frontend. Chạy một lần: `CI=true npm test` hoặc `npm test -- --watchAll=false`.
- Có cả `package-lock.json` lẫn `yarn.lock` — chọn một package manager rồi giữ nguyên.

### E2E — [e2e/](e2e/) — đây là bộ test duy nhất thực sự chạy

```bash
cd e2e
npm install                # lần đầu tải binary mongod (~80MB), dùng lại cache về sau
npm run test:api           # 40 khẳng định tầng HTTP: auth, guard bảo mật, hợp đồng API
npm run test:browser       # 13 khẳng định qua Chrome thật (cần Chrome/Edge, hoặc đặt CHROME_PATH)
```

- Cần Node 18+ (theo [e2e/README.md](e2e/README.md) — dùng `fetch` built-in). Cổng mặc định: API 8123 (api) / 8124 (browser), web 3000; đổi bằng `E2E_API_PORT`, `E2E_WEB_PORT`.
- **Không có cơ chế chọn một test**: cả hai file là script `node *.mjs` chạy tuần tự, in `PASS`/`FAIL` qua `record()`, exit code 1 nếu có mục đỏ. Muốn chạy hẹp thì sửa/comment trong file test, không có cờ CLI.
- Test tự dựng `mongod` riêng và `JWT_SECRET` riêng, **không đọc `.env` thật**, không cần Mongo hay backend đang chạy sẵn.

## Bốn biến môi trường phải khớp nhau

Đây là nguồn lỗi deploy đã từng xảy ra thật (bản deploy cũ để cứng `localhost` ở frontend và một domain Firebase đã chết ở backend, nên luồng reset password không bao giờ tới được backend). Khi đổi nơi chạy, phải sửa **đồng thời**:

| Biến | Ở đâu | Ghi chú |
|---|---|---|
| `REACT_APP_API_URL` | `frontend/.env` (chưa có trong repo — tạo từ `frontend/.env.example`) | CRA nhúng vào bundle **lúc build** → đổi phải build lại. Mặc định `http://localhost:8000/api` ([frontend/src/api/client.js](frontend/src/api/client.js)) |
| `PORT` | `backend/.env` | `8000`; fallback trong mã là `8001` |
| `CORS_ORIGIN` | `backend/.env` | Danh sách origin phân tách bằng dấu phẩy; origin lạ bị từ chối bằng cách không gắn header CORS |
| `FRONTEND_URL` | `backend/.env` (hiện chưa đặt — đang dùng mặc định; mẫu ở `.env.example`) | Gốc frontend dùng để dựng link reset trong email; mặc định trỏ tới domain Firebase cũ |

Giá trị `baseURL` chạy **trong trình duyệt người dùng**, nên `localhost` ở đó là máy của họ. Khi đóng gói Docker, cách ít lỗi nhất là dùng đường dẫn tương đối `/api` + reverse proxy (nginx) sang backend — không phải cấu hình CORS, không bị chặn mixed content khi trang chạy https ([frontend/CLAUDE.md](frontend/CLAUDE.md) có ghi chú chi tiết).

Hai biến `GMAIL_USERNAME` / `GMAIL_PASSWORD` đang trống: `/forgotPassword` vẫn trả 200 kèm "đã gửi link" nhưng **không có mail nào được gửi**.

## Hợp đồng API giữa hai phần

Bốn tiền tố: `/api/user` (login, register, getuser), `/api/task` (addTask, getTask, removeTask/:id, updateTask/:id), `/api/forgotPassword` (forgotPassword, resetPassword), `/api/health` (healthcheck, không auth).

Mọi response là object JSON: `message` cho người đọc, key theo tài nguyên — `{user, token}` khi auth, `{tasks}` khi lấy danh sách, `{message, task}` khi thêm/sửa task. Mọi lời gọi đi qua lớp API ở [frontend/src/api/](frontend/src/api/) — **component không bao giờ gọi axios trực tiếp**, và lỗi luôn đọc bằng `getErrorMessage` (đọc thẳng `error.response.data.message` sẽ ném `TypeError` khi lỗi mạng). Chi tiết route, guard và mã trạng thái: [backend/CLAUDE.md](backend/CLAUDE.md).

## Quy ước

- **Backend dùng ESM** (`"type": "module"`): `import`/`export`, không `require`.
- **Mã chạy trong server không gọi `console.*` trực tiếp** — dùng [backend/utils/logger.js](backend/utils/logger.js) (mức đặt qua `LOG_LEVEL`). Script một lần trong `backend/scripts/` là ngoại lệ.
- **Không có sanitizer Mongo toàn cục** (`sanitizeFilter` không bật). Lớp phòng vệ duy nhất là kiểm tra kiểu thủ công ở từng endpoint nhận `req.body` — đây là các guard đã được viết có chủ đích, đừng gỡ.
- Comment và tài liệu viết bằng **tiếng Việt**, thường kèm lý do "vì sao" và lỗi cụ thể đã từng xảy ra. Giữ văn phong này khi thêm mã mới.
- Quy ước riêng của từng phần (thư mục component, cách đặt tên, CSS) nằm ở manifest thư mục con tương ứng.

## Kiểm chứng trước khi báo xong

Không có unit test nào, và backend không có linter (frontend chỉ có ESLint mặc định của CRA chạy kèm `start`/`build`) — không có lưới nào tự chặn lỗi. Cách duy nhất để biết thay đổi thật sự chạy (và đây là lý do bộ test e2e tồn tại):

1. Sửa backend hoặc hợp đồng API → `cd e2e && npm run test:api`.
2. Đụng vào UI/state/reducer → thêm cả `npm run test:browser`; test API xanh không chứng minh app không trắng màn hình (đã từng có đúng tình huống đó).
3. Nêu rõ đã chạy gì và kết quả ra sao — kể cả khi đỏ.

## Việc còn tồn đã biết

- Không có handler lỗi 4 tham số và không có catch-all 404: JSON sai định dạng gửi tới bất kỳ route nào (kể cả endpoint công khai) rơi vào handler mặc định của Express, trả **HTML kèm stack trace** thay vì envelope `{message}`. Cân nhắc khi viết health check cho Docker.
- Không route ghi nào của `/api/task` có rate limit (`addTask`, `removeTask`, `updateTask`), mà mỗi lần thêm task lại gửi một mail.
- Rate limit lưu trong `Map` của tiến trình (theo instance, mất khi restart) — chạy nhiều container thì giới hạn thực tế nhân theo số instance.
