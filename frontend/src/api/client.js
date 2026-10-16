import axios from "axios";
import { readToken, clearToken } from "../utils/authStorage";

// Mặc định là đường dẫn TƯƠNG ĐỐI "/api" — chạy cùng origin với trang nên không có
// CORS, không bị chặn mixed content khi trang chạy https, và không phụ thuộc tên miền:
// production thì nginx của container frontend proxy sang backend, còn dev server thì
// Vite proxy (xem `server.proxy` trong vite.config.mjs).
//
// Đặt VITE_API_URL (tiền tố VITE_ là bắt buộc, trước đây là REACT_APP_ của CRA) khi
// muốn trỏ thẳng sang một API khác — giá trị được nhúng vào bundle LÚC BUILD, và khi đó
// phải thêm origin của frontend vào CORS_ORIGIN ở backend.
const instance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

// Gắn token vào mọi request. Trước đây mỗi chỗ gọi tự dựng header
// `Authorization: Bearer ...` bằng tay (3 chỗ), nên thêm một lời gọi mới là dễ quên.
instance.interceptors.request.use((config) => {
  const token = readToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Các trang không cần đăng nhập. Phải loại trừ chúng khỏi việc chuyển hướng:
// người dùng có token cũ mở link reset trong email (/resetPassword?token=...)
// sẽ bị App.js gọi getUser -> 401 -> đá sang /login trước khi form kịp hiện,
// làm mất token nằm trên query string. Đây là lỗi đã từng xảy ra, đừng thu hẹp danh sách này.
const PUBLIC_PATHS = ["/login", "/register", "/forgotPassword", "/resetPassword"];

// 401 nghĩa là token không còn hiệu lực (hết hạn, hoặc mật khẩu đã được đổi ở nơi khác
// nên tokenVersion không còn khớp). Luôn xoá token chết; chỉ chuyển hướng khi đang ở
// trang cần đăng nhập, thay vì để token cũ nằm lại và UI hiển thị trạng thái ảo.
instance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response && error.response.status;
    if (status === 401) {
      clearToken();
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
export default instance;
