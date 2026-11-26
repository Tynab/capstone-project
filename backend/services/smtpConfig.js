// Cấu hình SMTP tách khỏi chỗ gọi: trước đây cả hai chỗ gửi mail đều cứng
// `service: 'gmail'` (một chỗ còn cứng cả host smtp.gmail.com:465), nên không
// thể trỏ vào SMTP giả trong lab (Mailpit) mà không sửa mã.
//
// Quy tắc: có SMTP_HOST thì dùng host/port/secure từ env; không có thì giữ
// nguyên hành vi Gmail cũ, để cấu hình đang chạy không bị phá.

const hasGmailCreds = (env) => Boolean(env.GMAIL_USERNAME && env.GMAIL_PASSWORD);

// Điều kiện "gửi được mail": có SMTP riêng, hoặc có đủ cặp Gmail.
export const hasMailConfig = (env = process.env) => Boolean(env.SMTP_HOST) || hasGmailCreds(env);

// Địa chỉ người gửi của mọi mail do app gửi. Thứ tự ưu tiên:
//   1. MAIL_FROM  — đặt tường minh, dùng được với mọi SMTP (kể cả mailpit trong lab).
//   2. GMAIL_USERNAME — Gmail bắt buộc `from` phải là chính tài khoản đã xác thực.
//   3. Giá trị trung tính của dự án.
// Trước đây hai chỗ tự viết lại biểu thức này và giá trị dự phòng là địa chỉ Gmail
// của tác giả tutorial (alok.yadav6000@gmail.com) — mail của dự án gửi dưới tên người
// khác. Gộp về một hàm để không còn chỗ thứ hai để lệch.
export const mailFromAddress = (env = process.env) =>
  env.MAIL_FROM || env.GMAIL_USERNAME || "Todo App <no-reply@localhost>";

export const buildTransportOptions = (env = process.env) => {
  if (env.SMTP_HOST) {
    const options = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 1025),
      secure: String(env.SMTP_SECURE) === "true",
    };
    // Mailpit chạy không auth -> chỉ gắn auth khi thật sự có tài khoản,
    // nếu không nodemailer sẽ thử AUTH với user/pass rỗng.
    if (env.SMTP_USER) {
      options.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
    }
    return options;
  }
  return {
    service: "gmail",
    auth: { user: env.GMAIL_USERNAME, pass: env.GMAIL_PASSWORD },
  };
};
