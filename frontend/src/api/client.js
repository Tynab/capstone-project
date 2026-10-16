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

// Cơ chế đồng bộ state với localStorage khi có 401: App.jsx đăng ký handler duy
// nhất lúc mount và bỏ đăng ký khi unmount. Chỉ xoá token khỏi localStorage thôi
// thì userToken/user trong React vẫn còn — Header hiện trạng thái "đã đăng nhập"
// ảo cho tới khi F5 (lỗi đã từng xảy ra thật khi người dùng có token cũ mở link
// reset trong email). Handler được gọi ở MỌI ca 401, kể cả trang công khai; chỉ
// riêng việc chuyển hướng mới phân biệt theo PUBLIC_PATHS bên dưới.
let unauthorizedHandler = null;
export const setUnauthorizedHandler = (fn) => {
  unauthorizedHandler = fn;
};

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
      // Gọi handler ngay sau khi xoá token để state React luôn khớp localStorage.
      // Ở trang công khai không có chuyển hướng "che" lỗi nên đây là cơ chế duy
      // nhất để Header hết hiển thị trạng thái đăng nhập ảo.
      if (unauthorizedHandler) unauthorizedHandler();
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
export default instance;
