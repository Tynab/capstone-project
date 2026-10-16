# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tổng quan

Frontend `todo-app`: Create React App 5 (`react-scripts` 5.0.1) + React 18, JavaScript thuần (không TypeScript). Gọi API backend Express ở `../backend` — đọc `../backend/CLAUDE.md` trước khi động vào phần API.

Version control: repo git ở **gốc dự án `../`** (không phải trong `frontend/`), `.gitignore` ở gốc lo `node_modules/`, `.env`, `frontend/build/`.

Đây là phần frontend của dự án DevOps cuối khóa (đề bài: dựng CICD GitHub Actions + hệ thống giám sát Grafana/Prometheus — cả hai đã dựng xong, xem [../infra/README.md](../infra/README.md)). Đóng gói: [Dockerfile](Dockerfile) (build CRA rồi phục vụ bằng nginx, proxy `/api` sang backend) — image được CI build và deploy lên swarm, không build tại máy Windows.

## Lệnh thường dùng

```bash
npm install        # bắt buộc trước khi chạy bất cứ thứ gì
npm start          # dev server tại http://localhost:3000
npm run build      # build production vào build/
npm test           # jest watch mode — 47 unit test (reducer, utils, lớp api, component)
```

- Chạy test một lần (không watch): `npm test -- --watchAll=false` hoặc `CI=true npm test`. Bộ unit test này mock toàn bộ `src/api/*` nên **không cần server**; luồng thật xuyên tầng (đăng ký → CRUD → F5 → đăng xuất) vẫn do `../e2e` phủ — test API xanh không chứng minh app không trắng màn hình.
- Chỉ dùng **npm** — `yarn.lock` đã bị xoá (trước đây tồn tại song song hai lockfile nên npm và yarn có thể dùng hai cây dependency khác nhau).
- Không có script lint riêng; ESLint của CRA (`eslintConfig` trong `package.json`) chạy kèm cả `start` lẫn `build`, và **`npm run build` fail nếu có lint error** (tắt bằng `DISABLE_ESLINT_PLUGIN=true`).
- Tailwind v3: CRA 5 tự chèn plugin `tailwindcss` khi thấy `tailwind.config.js` ở **gốc `frontend/`** — thư mục chạy `npm` (`react-scripts@5.0.1` dò theo `paths.appPath`, không phải gốc repo). **Thêm `postcss.config.js` sẽ không có tác dụng.**
- Cấu hình API qua `.env` (xem `.env.example`) — CRA chỉ nhúng biến có tiền tố `REACT_APP_`.

## Kiến trúc

`src/index.js` → `src/App.js`. `App.js` là toàn bộ app shell: `BrowserRouter` + toàn bộ `Routes`, giữ toàn bộ state dùng chung và cấp cả 2 context (các component con vẫn có `useState` cục bộ riêng).

### Lớp gọi API — component không bao giờ gọi axios trực tiếp

- [src/api/client.js](src/api/client.js): instance axios duy nhất. `baseURL` lấy từ `REACT_APP_API_URL`, mặc định `http://localhost:8000/api`.
- **Request interceptor** tự gắn `Authorization: Bearer` cho mọi request. Không dựng header bằng tay ở chỗ gọi.
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
- Ảnh tĩnh để ở `src/assets/` rồi `import` vào component (webpack băm tên file nên không lo cache). **Không hotlink ảnh từ site ngoài**: ảnh minh hoạ trang đăng ký từng nằm trên `pngtree.com` và luôn trả 403 vì site đó chặn hotlink — nay là `src/assets/register-illustration.png` (đã thu nhỏ 2500x2500 → 625x625, 596KB → 70KB). Ảnh trang đăng nhập vẫn lấy từ `mdbcdn.b-cdn.net`; nếu CDN đó chết thì tải về `src/assets/` theo đúng cách này.
- [FormAlert](src/components/common/FormAlert.jsx) là component dùng chung hiển thị lỗi/thành công của form (lỗi của từng task trong `Task.jsx` tự render `p role="alert"`, `ErrorBoundary` có màn hình lỗi riêng); [DeleteIcon](src/components/icons/DeleteIcon.jsx) là SVG nội bộ (trước đây là `@mui/icons-material`, kéo cả MUI + emotion vào bundle chỉ để render 1 icon).
- [formatRelativeTime](src/utils/formatRelativeTime.js) dùng `Intl.RelativeTimeFormat` thay cho `moment` (~60KB minified, ~19KB gzip cho một hàm).
- Nút nào gửi request đều phải `disabled` trong lúc chờ, và mọi input phải có tên truy cập được: `<label>` thật (form ẩn bằng `sr-only` để giữ nguyên thiết kế, `CreateTask` dùng label hiển thị) hoặc `aria-label` như checkbox trong `Task.jsx`.

## Lưu ý khi deploy

- `baseURL` chạy **trong trình duyệt của người dùng**, nên `localhost` ở đó là máy của họ chứ không phải máy chủ. Đặt `REACT_APP_API_URL` lúc build, hoặc tốt hơn là dùng đường dẫn tương đối `/api` + proxy qua nginx (không phải cấu hình CORS, không bị chặn mixed content khi trang chạy https).
- `BrowserRouter` đòi SPA fallback (rewrite mọi path về `index.html`), nếu không `/active`, `/resetPassword`… sẽ 404 khi F5. Trong lab, [nginx.conf](nginx.conf) làm việc đó bằng `try_files`. Build giả định phục vụ ở gốc domain (`package.json` không có `homepage`).
- Link reset password do backend dựng từ `FRONTEND_URL` (mẫu ở `../backend/.env.example`; thiếu biến thì rơi về mặc định `https://todo-app-b96a5.web.app`) — đổi nơi deploy frontend thì phải sửa cả biến đó ở backend, không chỉ sửa repo này.
- Backend chỉ cho CORS từ các origin trong `CORS_ORIGIN` (`.env` của backend). Đổi tên miền frontend thì phải thêm vào đó.

## Phụ thuộc và cảnh báo bảo mật

`react-scripts` là **5.0.1 — bản phát hành cuối cùng của CRA** và không còn được bảo trì: `npm audit` trả
`fixAvailable = react-scripts@0.0.0` cho hàng loạt gói, tức npm không tìm được bản vá nào. Vì vậy các
cảnh báo còn lại trong cây của nó chỉ ghim được bằng `overrides` trong `package.json`.

Nguyên tắc đã áp dụng: **chỉ ghim trong cùng major** (bản vá do chính nhà phát hành phát hành cho nhánh
đó). Sau khi ghim: `npm audit` của frontend không còn cảnh báo `critical` nào, và còn ~26 cặp
(gói, advisory) — tất cả đòi nhảy major nên **cố ý để nguyên**, gồm ba gói chưa có bản vá ở bất kỳ
phiên bản nào (`braces <= 3.0.3`, `node-forge <= 1.4.0`, `sprintf-js <= 1.1.3`). Nhóm này nằm trong
công cụ build/dev-server (`webpack-dev-server`, `http-proxy-middleware`, `svgo 1.x`, `postcss 7` của
`resolve-url-loader`, `uuid`, `react-router 6`) — **không vào bundle production**. Muốn sạch hoàn toàn
thì phải bỏ CRA (chuyển sang Vite), là việc riêng, không gộp vào đợt vá bảo mật.

Mỗi lần thêm/sửa `overrides` phải chạy đủ: `npm run build` (bắt lỗi webpack/postcss), `CI=true npm test`,
`cd ../e2e && npm run test:browser`, **và `npm ci --dry-run`** — CI dùng `npm ci` nên lockfile lệch
package.json là job test đỏ ngay từ bước cài dependency. Bài học đã trả giá: xoá `package-lock.json` để
sinh lại từ đầu làm npm chọn `typescript@7` (không thoả peer `typescript@4.9.5` của `@typescript-eslint`),
`npm ci` báo "Invalid: lock file's typescript@7.0.2 does not satisfy typescript@4.9.5". Vì vậy hãy sửa
lockfile theo kiểu TĂNG DẦN (`npm install` trên lock cũ) và kiểm bằng `npm ci --dry-run`, đừng xoá lock
để dựng lại. Tuyệt đối không chạy `npm audit fix --force`: nó "vá" bằng cách hạ `react-scripts` xuống
`0.0.0` và làm chết cả `npm start` lẫn `npm run build`.
