import bcrypt from "bcrypt";

// Chính sách hash khai báo MỘT chỗ: trước đây cost 10 được viết lặp ở ba nơi
// (đăng ký, đổi mật khẩu, và script migration) nên sửa một chỗ là lệch ngay.
// Bcrypt đọc cost từ chính hash khi verify, nên đổi số này không làm hỏng
// mật khẩu cũ.
export const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
