# Test end-to-end

Bộ test chạy trên **hạ tầng thật**, không mock: một `mongod` thật (qua
`mongodb-memory-server`), backend thật, và với test trình duyệt thì thêm frontend
dev server + Chrome thật.

## Chạy

```bash
cd e2e
npm install          # lần đầu tải binary mongod (~80MB), sau đó dùng lại cache
npm run test:api     # test tầng API
npm run test:browser # test qua trình duyệt thật
```

Yêu cầu: Node 18+ (dùng `fetch` built-in). Test trình duyệt cần Chrome hoặc Edge —
tự dò các đường dẫn thông dụng, hoặc đặt `CHROME_PATH` để chỉ định.

Biến môi trường: `E2E_API_PORT` (mặc định 8123 / 8124), `E2E_WEB_PORT` (mặc định 3000).

## Vì sao cần cả hai

`test:api` kiểm tra hợp đồng và các guard bảo mật ở tầng HTTP. `test:browser` kiểm tra
thứ mà test API không thấy được: **app có thật sự chạy trong trình duyệt không**.

Hai tầng này không thay thế nhau. Đã từng có lúc toàn bộ test API xanh trong khi app
trắng màn hình: `getTasks()` trả `res.data` thay vì `res.data.tasks`, nên reducer nhận
một object và `tasks.map` ném `tasks is not iterable`. Chỉ trình duyệt mới phát hiện được.

## Những gì được kiểm chứng

`test:api` — đăng ký/đăng nhập, chống dò email, chặn NoSQL operator injection ở cả 4
endpoint công khai, guard JWT, phân quyền task (người khác không xoá/sửa được), token
reset dùng một lần + hết hạn + lưu dạng hash, JWT cũ bị vô hiệu hoá sau khi đổi mật
khẩu, CORS whitelist, rate limit.

`test:browser` — đăng ký, thêm task, tick hoàn thành, xoá, đăng xuất, đăng nhập lại —
mỗi thao tác ghi đều **F5 lại trang** để xác nhận thay đổi nằm thật trong DB chứ không
chỉ trong state client. Đây chính là lỗi gốc của dự án trước refactor.

## Ghi chú

- Test dùng `JWT_SECRET` riêng, không đụng tới `.env` thật.
- `CORS_ORIGIN` được truyền qua biến môi trường để test không phụ thuộc cổng mặc định.
- Thư mục này là hạ tầng test, tách khỏi `backend/` và `frontend/` để dependency của
  test không lẫn vào dependency của ứng dụng.
