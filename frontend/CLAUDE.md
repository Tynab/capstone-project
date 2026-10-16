# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tổng quan

Frontend `todo-app`: Create React App 5 (`react-scripts` 5.0.1) + React 18, JavaScript thuần (không TypeScript). Gọi API backend Express ở `../backend` — đọc `../backend/CLAUDE.md` trước khi động vào phần API.

Version control: repo git được khởi tạo ở **gốc dự án `../`** (không phải trong `frontend/`), kèm `.gitignore` ở gốc lo `node_modules/`, `.env`, `frontend/build/`. Lịch sử hiện chỉ có một commit `aa96208` (Initial commit, chứa `README.md` và `.gitattributes`); các hash cũ (`ff8dd63`, `713d1dd`) được nhắc trong tài liệu phiên trước không còn tồn tại trong repo này.

Đây là phần frontend của dự án DevOps cuối khóa (đề bài: dựng CICD GitHub Actions + hệ thống giám sát Grafana/Prometheus — cả hai đã dựng xong, xem [../infra/README.md](../infra/README.md)). Đóng gói: [Dockerfile](Dockerfile) (build CRA rồi phục vụ bằng nginx, proxy `/api` sang backend) — image được CI build và deploy lên swarm, không build tại máy Windows.

## Lệnh thường dùng

```bash
npm install        # bắt buộc trước khi chạy bất cứ thứ gì
npm start          # dev server tại http://localhost:3000
npm run build      # build production vào build/
npm test           # jest watch mode — frontend KHÔNG có file test nào; bộ test thật nằm ở ../e2e
```

- Chạy test một lần (không watch): `npm test -- --watchAll=false` hoặc `CI=true npm test`.
- Có **cả** `package-lock.json` lẫn `yarn.lock` — chọn một package manager rồi giữ nguyên lockfile tương ứng.
- Không có script lint riêng; ESLint của CRA (`eslintConfig` trong `package.json`) chạy kèm cả `start` lẫn `build`, và **`npm run build` fail nếu có lint error** (tắt bằng `DISABLE_ESLINT_PLUGIN=true`).
- Tailwind v3: CRA 5 tự chèn plugin `tailwindcss` khi thấy `tailwind.config.js` ở **gốc `frontend/`** — thư mục chạy `npm` (`react-scripts@5.0.1` dò theo `paths.appPath`, không phải gốc repo). **Thêm `postcss.config.js` sẽ không có tác dụng.**
- Cấu hình API qua `.env` (xem `.env.example`) — CRA chỉ nhúng biến có tiền tố `REACT_APP_`.

## Kiến trúc

`src/index.js` → `src/App.js`. `App.js` là toàn bộ app shell: `BrowserRouter` + toàn bộ `Routes`, giữ toàn bộ state dùng chung và cấp cả 2 context (các component con vẫn có `useState` cục bộ riêng).

### Lớp gọi API — component không bao giờ gọi axios trực tiếp

- [src/api/client.js](src/api/client.js): instance axios duy nhất. `baseURL` lấy từ `REACT_APP_API_URL`, mặc định `http://localhost:8000/api`.
- **Request interceptor** tự gắn `Authorization: Bearer`. Không chỗ nào được dựng header bằng tay nữa.
- **Response interceptor cho 401**: xoá token và chuyển hướng `/login`, **trừ** 4 đường dẫn trong `PUBLIC_PATHS` (login/register/forgotPassword/resetPassword). Phải giữ nguyên danh sách này — người dùng có token cũ mở link reset trong email sẽ mất token trên query string nếu bị đá sang `/login`.
- [src/api/authApi.js](src/api/authApi.js), [src/api/taskApi.js](src/api/taskApi.js): mọi lời gọi API đi qua đây; component không cần biết đường dẫn HTTP.

### State và context

- 3 `useReducer` tại `App.js`: `tasks` ([taskReducer.js](src/reducer/taskReducer.js)), `userToken` ([tokenReducer.js](src/reducer/tokenReducer.js)), `user` ([userReducer.js](src/reducer/userReducer.js)).
- 2 context: `TokenContext` = `{userToken, tokenDispatch, user, userDispatch}`, `TaskContext` = `{tasks, dispatch}`; khai báo ở `src/context/*.js` (là `.js` vì chỉ có `createContext`, không JSX). Cả hai `value` đều bọc `useMemo` — không bọc thì mọi thao tác task làm re-render gần cả cây.
- `App.js` tự fetch `/user/getUser` + `/task/getTask` trong `useEffect` phụ thuộc `userToken`, có cờ `cancelled` để không ghi state từ request cũ.
- [index.js](src/index.js) bọc app trong `<React.StrictMode>` và `<ErrorBoundary>` → ở dev mọi `useEffect` chạy 2 lần nên hai fetch trên bị gọi đôi; `ErrorBoundary` là lưới an toàn vì `taskReducer` **ném Error** với action lạ.

### Routing

`/` → `Header` (có `<Outlet/>`) → `userToken ? Layout : Login`; `Layout` (có `<Outlet/>` + `TaskIndicator`) chứa index → `AllTask`, `active` → `Active`, `completed` → `Completed`. Ngoài ra có `/login`, `/register`, `/forgotPassword`, `/resetPassword`. `Login` được render ở cả route `/` lẫn `/login`. `NavLink to="/"` **phải có prop `end`**, nếu không tab "All Task" sáng ở mọi route.

### Task được định danh bằng `_id`, không bằng index

- `AllTask`/`Active`/`Completed` truyền `key={task._id}` và không truyền `id` riêng; `Task.jsx` đọc `task._id` trực tiếp. `taskReducer` lọc/ánh xạ theo `_id`.
- `ADD_TASK` nhận **task do server trả về** (`action.task`, đã có `_id` và `createdAt`), không phải object tự dựng ở client.
- `MARK_DONE` nhận giá trị `completed` đã lưu ở server (`action.completed`) thay vì tự đảo trạng thái cũ.
- Xoá và tick đều **gọi API trước, chỉ dispatch khi thành công**; nút bị khoá trong lúc chờ. Backend có `DELETE /api/task/removeTask/:id` và `PATCH /api/task/updateTask/:id`.
- `Active`/`Completed` lọc **trước rồi mới** kiểm tra rỗng, nếu không sẽ hiện trang trắng khi có task nhưng không task nào khớp bộ lọc.

### Xác thực — một nguồn sự thật

- Token JWT nằm ở `localStorage` dưới khoá `AUTH_TOKEN_KEY`; **chỉ** [src/utils/authStorage.js](src/utils/authStorage.js) được đọc/ghi (đã bọc `try/catch` vì `JSON.parse` trên giá trị hỏng trước đây làm trắng màn hình ngay trong render).
- Trạng thái đăng nhập lấy từ `userToken` trong `TokenContext` — không nơi nào đọc lại localStorage trong lúc render.
- Logout dispatch `UNSET_TOKEN` + `UNSET_USER` rồi `navigate("/login")`; không reload cả trang.
- `Login`/`Register` thành công → dispatch `SET_TOKEN` + `SET_USER` + `saveToken`.

### Envelope API (khớp backend)

Luôn là object JSON, `message` cho người đọc, key đặt theo tài nguyên: `/user/login` + `/user/register` → `{user, token}`; `/user/getUser` → `{user}`; `/task/getTask` → `{tasks}`; `/task/addTask` + `/task/updateTask/:id` → `{message, task}`; còn lại → `{message}`.

Lỗi luôn đọc qua [getErrorMessage](src/utils/getErrorMessage.js) — đọc thẳng `error.response.data.message` sẽ ném `TypeError` khi lỗi mạng (không có `response`) và người dùng không thấy thông báo nào.

### UI

- Styling: Tailwind viết trong `className`, cộng CSS thường — `src/App.css` (import ở `App.js` nên là global) và `src/styles/*.css`.
- Quy ước thư mục: mọi component là **file phẳng** trong `src/components/` (PascalCase, `.jsx`); chỉ nhóm con mới có thư mục (`common/`, `icons/`, chữ thường). CSS để riêng ở `src/styles/`. Giữ đúng quy ước này khi thêm component mới.
- [FormAlert](src/components/common/FormAlert.jsx) là component dùng chung hiển thị lỗi/thành công của form (lỗi của từng task trong `Task.jsx` tự render `p role="alert"`, `ErrorBoundary` có màn hình lỗi riêng); [DeleteIcon](src/components/icons/DeleteIcon.jsx) là SVG nội bộ (trước đây là `@mui/icons-material`, kéo cả MUI + emotion vào bundle chỉ để render 1 icon).
- [formatRelativeTime](src/utils/formatRelativeTime.js) dùng `Intl.RelativeTimeFormat` thay cho `moment` (~60KB minified, ~19KB gzip cho một hàm).
- Nút nào gửi request đều phải `disabled` trong lúc chờ, và mọi input phải có tên truy cập được: `<label>` thật (form ẩn bằng `sr-only` để giữ nguyên thiết kế, `CreateTask` dùng label hiển thị) hoặc `aria-label` như checkbox trong `Task.jsx`.

## Lưu ý khi deploy

- `baseURL` chạy **trong trình duyệt của người dùng**, nên `localhost` ở đó là máy của họ chứ không phải máy chủ. Đặt `REACT_APP_API_URL` lúc build, hoặc tốt hơn là dùng đường dẫn tương đối `/api` + proxy qua nginx (không phải cấu hình CORS, không bị chặn mixed content khi trang chạy https).
- `BrowserRouter` đòi web server có SPA fallback (rewrite mọi path về `index.html`), nếu không `/active`, `/resetPassword`… sẽ 404 khi F5. Repo chưa có file cấu hình hosting nào và `package.json` không có `homepage`, nên build giả định phục vụ ở gốc domain.
- Link reset password do backend dựng từ `FRONTEND_URL` (mẫu ở `../backend/.env.example`; `backend/.env` hiện chưa đặt biến này nên đang rơi về mặc định `https://todo-app-b96a5.web.app`) — đổi nơi deploy frontend thì phải sửa cả biến đó ở backend, không chỉ sửa repo này.
- Backend chỉ cho CORS từ các origin trong `CORS_ORIGIN` (`.env` của backend). Đổi tên miền frontend thì phải thêm vào đó.
