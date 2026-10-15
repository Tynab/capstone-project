import axios from "axios";
import { readToken, clearToken } from "../utils/authStorage";

// Đổi được lúc build qua REACT_APP_API_URL (CRA nhúng biến REACT_APP_* vào bundle).
// Không để cứng localhost: bản deploy sẽ gọi vào chính máy của người dùng,
// nên mọi request — kể cả link reset trong email — không bao giờ tới được backend.
const instance = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:8000/api",
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
