// Cấu hình SMTP tách khỏi chỗ gọi: trước đây cả hai chỗ gửi mail đều cứng
// `service: 'gmail'` (một chỗ còn cứng cả host smtp.gmail.com:465), nên không
// thể trỏ vào SMTP giả trong lab (Mailpit) mà không sửa mã.
//
// Quy tắc: có SMTP_HOST thì dùng host/port/secure từ env; không có thì giữ
// nguyên hành vi Gmail cũ, để cấu hình đang chạy không bị phá.

const hasGmailCreds = (env) =>
  Boolean(env.GMAIL_USERNAME && env.GMAIL_PASSWORD);

// Điều kiện "gửi được mail": có SMTP riêng, hoặc có đủ cặp Gmail.
export const hasMailConfig = (env = process.env) =>
  Boolean(env.SMTP_HOST) || hasGmailCreds(env);

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
