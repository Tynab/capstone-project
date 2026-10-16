# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tổng quan

Frontend `todo-app`: **Vite 8 + React 18**, JavaScript thuần (không TypeScript). Gọi API backend Express ở `../backend` — đọc `../backend/CLAUDE.md` trước khi động vào phần API.

> **Đã bỏ Create React App** (react-scripts 5.0.1 — bản cuối cùng, không còn bản vá). Chuyển sang Vite để dứt điểm: 1113 gói trong cây react-scripts biến mất, `npm audit` của frontend từ 92 mục còn 9, và không cần `overrides` nào nữa (khối `overrides` cũ đã xoá sạch).

Version control: repo git ở **gốc dự án `../`** (không phải trong `frontend/`), `.gitignore` ở gốc lo `node_modules/`, `.env`, `frontend/dist/`.

Đây là phần frontend của dự án DevOps cuối khóa (đề bài: dựng CICD GitHub Actions + hệ thống giám sát Grafana/Prometheus — cả hai đã dựng xong, xem [../infra/README.md](../infra/README.md)). Đóng gói: [Dockerfile](Dockerfile) (build bằng Vite rồi phục vụ bằng nginx, proxy `/api` sang backend) — image được CI build và deploy lên swarm, không build tại máy Windows.

## Lệnh thường dùng

```bash
npm install        # bắt buộc trước khi chạy bất cứ thứ gì
npm start          # dev server Vite tại http://localhost:3000 (cổng đọc từ PORT)
npm run build      # build production vào dist/
npm run preview    # xem thử bản build
npm test           # vitest run — 47 unit test (reducer, utils, lớp api, component)
npm run lint       # ESLint 9 (flat config: eslint.config.mjs)
```

- `npm test` chạy MỘT lần rồi thoát (`vitest run`) — không có watch mode như jest của CRA. Muốn watch: `npm run test:watch`. Bộ unit test này mock toàn bộ `src/api/*` nên **không cần server**; luồng thật xuyên tầng (đăng ký → CRUD → F5 → đăng xuất) vẫn do `../e2e` phủ — test API xanh không chứng minh app không trắng màn hình.
- Chỉ dùng **npm** — `yarn.lock` đã bị xoá (trước đây tồn tại song song hai lockfile nên npm và yarn có thể dùng hai cây dependency khác nhau).
- **`npm run build` KHÔNG chạy ESLint** (CRA thì có — build đỏ nếu lint lỗi). Vì vậy lint là bước riêng: `npm run lint`, và CI chạy nó thành một bước độc lập. Đừng bỏ bước đó, mất là mất luôn lưới lint.
- Tailwind v3 chạy qua **`postcss.config.js` ở gốc `frontend/`** (Vite đọc file này; CRA thì tự cấu hình bên trong nên file này từng vô tác dụng — nay ngược lại: thiếu nó là mất sạch style).
- Cấu hình API qua `.env` (xem `.env.example`) — Vite chỉ nhúng biến có tiền tố **`VITE_`** (trước đây là `REACT_APP_`).

## Kiến trúc

`index.html` (ở **gốc `frontend/`**, Vite đòi vậy — CRA để trong `public/`) → `src/main.jsx` → `src/App.jsx`. `App.jsx` là toàn bộ app shell: `BrowserRouter` + toàn bộ `Routes`, giữ toàn bộ state dùng chung và cấp cả 2 context (các component con vẫn có `useState` cục bộ riêng).

### Lớp gọi API — component không bao giờ gọi axios trực tiếp

- [src/api/client.js](src/api/client.js): instance axios duy nhất. `baseURL` lấy từ `VITE_API_URL`, mặc định `http://localhost:8000/api`.
- **Request interceptor** tự gắn `Authorization: Bearer` cho mọi request. Không dựng header bằng tay ở chỗ gọi.
- **Response interceptor cho 401**: xoá token và chuyển hướng `/login`, **trừ** 4 đường dẫn trong `PUBLIC_PATHS` (login/register/forgotPassword/resetPassword). Phải giữ nguyên danh sách này — người dùng có token cũ mở link reset trong email sẽ mất token trên query string nếu bị đá sang `/login`.
- [src/api/authApi.js](src/api/authApi.js), [src/api/taskApi.js](src/api/taskApi.js): mọi lời gọi API đi qua đây; component không cần biết đường dẫn HTTP.

### State và context

- 3 `useReducer` tại `App.jsx`: `tasks` ([taskReducer.js](src/reducer/taskReducer.js)), `userToken` ([tokenReducer.js](src/reducer/tokenReducer.js)), `user` ([userReducer.js](src/reducer/userReducer.js)).
- 2 context: `TokenContext` = `{userToken, tokenDispatch, user, userDispatch}`, `TaskContext` = `{tasks, dispatch}`; khai báo ở `src/context/*.js` (là `.js` vì chỉ có `createContext`, không JSX). Cả hai `value` đều bọc `useMemo` — không bọc thì mọi thao tác task làm re-render gần cả cây.
- `App.jsx` tự fetch `/user/getUser` + `/task/getTask` trong `useEffect` phụ thuộc `userToken`, có cờ `cancelled` để không ghi state từ request cũ.
- [main.jsx](src/main.jsx) bọc app trong `<React.StrictMode>` và `<ErrorBoundary>` → ở dev mọi `useEffect` chạy 2 lần nên hai fetch trên bị gọi đôi; `ErrorBoundary` là lưới an toàn vì `taskReducer` **ném Error** với action lạ.

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

- Styling: Tailwind viết trong `className`, cộng CSS thường — `src/App.css` (import ở `App.jsx` nên là global) và `src/styles/*.css`.
- Quy ước thư mục: mọi component là **file phẳng** trong `src/components/` (PascalCase, `.jsx`); chỉ nhóm con mới có thư mục (`common/`, `icons/`, chữ thường). CSS để riêng ở `src/styles/`. Giữ đúng quy ước này khi thêm component mới.
- Ảnh tĩnh để ở `src/assets/` rồi `import` vào component (webpack băm tên file nên không lo cache). **Không hotlink ảnh từ site ngoài**: ảnh minh hoạ trang đăng ký từng nằm trên `pngtree.com` và luôn trả 403 vì site đó chặn hotlink — nay là `src/assets/register-illustration.png` (đã thu nhỏ 2500x2500 → 625x625, 596KB → 70KB). Ảnh trang đăng nhập vẫn lấy từ `mdbcdn.b-cdn.net`; nếu CDN đó chết thì tải về `src/assets/` theo đúng cách này.
- [FormAlert](src/components/common/FormAlert.jsx) là component dùng chung hiển thị lỗi/thành công của form (lỗi của từng task trong `Task.jsx` tự render `p role="alert"`, `ErrorBoundary` có màn hình lỗi riêng); [DeleteIcon](src/components/icons/DeleteIcon.jsx) là SVG nội bộ (trước đây là `@mui/icons-material`, kéo cả MUI + emotion vào bundle chỉ để render 1 icon).
- [formatRelativeTime](src/utils/formatRelativeTime.js) dùng `Intl.RelativeTimeFormat` thay cho `moment` (~60KB minified, ~19KB gzip cho một hàm).
- Nút nào gửi request đều phải `disabled` trong lúc chờ, và mọi input phải có tên truy cập được: `<label>` thật (form ẩn bằng `sr-only` để giữ nguyên thiết kế, `CreateTask` dùng label hiển thị) hoặc `aria-label` như checkbox trong `Task.jsx`.

## Lưu ý khi deploy

- `baseURL` chạy **trong trình duyệt của người dùng**, nên `localhost` ở đó là máy của họ chứ không phải máy chủ. Đặt `VITE_API_URL` lúc build, hoặc tốt hơn là dùng đường dẫn tương đối `/api` + proxy qua nginx (không phải cấu hình CORS, không bị chặn mixed content khi trang chạy https).
- `BrowserRouter` đòi SPA fallback (rewrite mọi path về `index.html`), nếu không `/active`, `/resetPassword`… sẽ 404 khi F5. Trong lab, [nginx.conf](nginx.conf) làm việc đó bằng `try_files`. Build giả định phục vụ ở gốc domain (`package.json` không có `homepage`).
- Link reset password do backend dựng từ `FRONTEND_URL` (mẫu ở `../backend/.env.example`; thiếu biến thì rơi về mặc định `https://todo-app-b96a5.web.app`) — đổi nơi deploy frontend thì phải sửa cả biến đó ở backend, không chỉ sửa repo này.
- Backend chỉ cho CORS từ các origin trong `CORS_ORIGIN` (`.env` của backend). Đổi tên miền frontend thì phải thêm vào đó.

## Phụ thuộc và cảnh báo bảo mật

Sau khi bỏ CRA: **không còn khối `overrides` nào** trong `package.json`. Toàn bộ hơn một nghìn gói của
cây `react-scripts` (webpack 5, webpack-dev-server 4, svgo 1.x, postcss 7 của resolve-url-loader, uuid,
node-forge, sprintf-js…) đã biến mất, kéo theo gần hết cảnh báo. Đừng thêm lại `overrides` trừ khi có
lý do cụ thể và đo được — mỗi lần thêm phải chạy đủ `npm run build`, `npm test`, `npm run lint`, và
`cd ../e2e && npm run test:browser`.

Vài cảnh báo còn lại (nếu có) đều nằm ở gói **chưa có bản vá ở bất kỳ phiên bản nào** (`braces`,
`node-forge`, `sprintf-js` từng rơi vào nhóm này) — nhóm đó chỉ hết khi gói rời khỏi cây dependency.

**Luôn kiểm bằng `npm ci --dry-run` sau mỗi lần sửa lockfile hoặc `package.json`** — CI dùng `npm ci`
(CNpm của Node 20 = npm 10) nên lockfile lệch là job test đỏ ngay từ bước cài dependency, trước cả khi
chạy test. Hai bài học đã trả giá:

1. Xoá `package-lock.json` để sinh lại từ đầu làm npm chọn `typescript@7` (không thoả peer
   `typescript@4.9.5`) → `npm ci` báo "Invalid: lock file's typescript@7.0.2 does not satisfy
   typescript@4.9.5". Sửa lockfile theo kiểu TĂNG DẦN (`npm install` trên lock cũ), đừng xoá để dựng lại.
2. Máy dev dùng npm 11 còn CI dùng npm 10: lock sinh bằng npm 11 có thể bị npm 10 từ chối
   ("Missing: … from lock file"). Vì vậy khi thêm/bớt gói hãy chạy bằng đúng bản của CI:
   `npx --yes npm@10 install …`, rồi kiểm `npx --yes npm@10 ci --dry-run`.

Tuyệt đối không chạy `npm audit fix --force`: nó "vá" bằng cách hạ gói xuống bản 0.0.0 và làm chết build.
