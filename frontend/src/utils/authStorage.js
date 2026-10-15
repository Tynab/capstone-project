import { AUTH_TOKEN_KEY } from "../constants";

// Token được ghi bằng JSON.stringify nên phải parse lại khi đọc: đọc thô sẽ ra
// chuỗi kèm dấu nháy bao quanh và header Authorization gửi đi sẽ sai.
//
// parse được bọc try/catch vì giá trị hỏng (người dùng sửa tay, dữ liệu cũ) làm
// JSON.parse ném lỗi. Trước đây lời gọi này nằm thẳng trong render của App.js nên
// một giá trị hỏng là cả cây component unmount -> trắng màn hình.
export const readToken = () => {
  const raw = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveToken = (token) => {
  localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(token));
};

export const clearToken = () => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
};
