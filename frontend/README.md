# Frontend — ứng dụng todo (React)

Giao diện todo: đăng ký/đăng nhập, thêm và quản lý task, quên/đặt lại mật khẩu.
Create React App 5 + React 18 + Tailwind, JavaScript thuần (không TypeScript).

## Chạy

```bash
npm install
npm start        # http://localhost:3000
```

Cần backend đang chạy (mặc định `http://localhost:8000/api`) — xem [../backend/README.md](../backend/README.md).
Muốn trỏ sang API khác thì đặt `REACT_APP_API_URL` trong `.env` (mẫu ở [.env.example](.env.example)).

> `REACT_APP_*` được CRA nhúng vào bundle **lúc build**, không phải lúc chạy — đổi giá trị
> thì phải build lại.

## Cấu trúc

```
src/
├─ api/         lớp gọi HTTP duy nhất (client.js + authApi/taskApi) — component KHÔNG gọi axios trực tiếp
├─ components/  component dạng file phẳng (PascalCase .jsx); nhóm con: common/, icons/
├─ context/     2 context: TokenContext (user + token), TaskContext (tasks)
├─ reducer/     3 reducer thuần cho tasks / token / user
├─ styles/      CSS thường (Tailwind viết trong className)
└─ utils/       đọc-ghi token an toàn, format thời gian, đọc thông báo lỗi
```

`App.js` là app shell: giữ state dùng chung, khai báo toàn bộ route, và tự nạp
`/user/getUser` + `/task/getTask` mỗi khi token đổi.

## Build & deploy

```bash
npm run build    # sản phẩm vào build/ (bị .gitignore chặn)
npm run format   # prettier cho src/
```

Khi deploy, frontend được đóng gói bằng [Dockerfile](Dockerfile): build CRA rồi phục vụ
bằng nginx ([nginx.conf](nginx.conf)). nginx lo hai việc quan trọng:

1. **SPA fallback** — mọi đường dẫn không phải file tĩnh đều trả `index.html`, nếu không
   F5 ở `/active` hay `/resetPassword` sẽ 404.
2. **Proxy `/api` sang backend** — cùng origin nên không cần cấu hình CORS, và không bị
   chặn mixed content khi trang chạy https.

Image do CI build và deploy lên swarm — xem [../infra/README.md](../infra/README.md).

## Test

`npm test` mở jest ở chế độ watch; **frontend không có unit test** (cố ý — phần này được
kiểm bằng test e2e chạy trên Chrome thật, ở [../e2e](../e2e/README.md)). Chạy một lần:
`CI=true npm test`.

Chi tiết kiến trúc, các lỗi đã từng xảy ra và quy ước trong mã: [CLAUDE.md](CLAUDE.md).
