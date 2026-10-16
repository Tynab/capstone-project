import { createTransport } from "nodemailer";
import logger from "../utils/logger.js";
import { buildTransportOptions, hasMailConfig, mailFromAddress } from "./smtpConfig.js";

// KHÔNG gọi dotenv.config() ở đây. Entry point (server.js) nạp .env trước khi
// module này được dùng; gọi rải rác ở nhiều module làm giá trị đọc được phụ thuộc
// thứ tự nạp module — nguồn của lỗi rất khó truy.

// Người gửi lấy từ smtpConfig.mailFromAddress() — một chỗ duy nhất quyết định địa chỉ
// này cho cả mail reset lẫn mail thông báo task.

let cachedKey = null;
let cachedTransporter = null;

// Dùng lại transporter theo cấu hình hiện tại. Trước đây mỗi lần gửi là một lần
// createTransport mới, nghĩa là mỗi lần thêm task phải bắt tay TCP + TLS + SMTP
// AUTH đầy đủ tới máy chủ mail.
// Khoá cache là chính options: cấu hình đổi (ví dụ đổi SMTP_HOST) thì tạo lại.
export const getTransporter = (env = process.env) => {
  const options = buildTransportOptions(env);
  const key = JSON.stringify(options);

  if (key !== cachedKey) {
    cachedTransporter = createTransport(options);
    cachedKey = key;
  }
  return cachedTransporter;
};

// Gửi mail là việc phụ, không được làm hỏng luồng chính.
// Trước đây hàm này nằm trong taskController và lỗi chỉ được console.log,
// nên addTask vẫn trả 200 kể cả khi mail không bao giờ tới.
export const sendTaskAddedMail = (email, title, description) => {
  if (!hasMailConfig()) {
    logger.warn(
      'Bỏ qua mail "Task Added": chưa cấu hình SMTP_HOST lẫn GMAIL_USERNAME/GMAIL_PASSWORD'
    );
    return;
  }

  getTransporter().sendMail(
    {
      from: mailFromAddress(),
      to: email,
      subject: "Task Added",
      html: `<h1>Task added successfully</h1><h2>Title: ${title}</h2><h3>Description: ${description}</h3>`,
    },
    (error, info) => {
      if (error) {
        logger.error("sendTaskAddedMail error:", error.message);
      } else {
        logger.info("Email sent: " + info.response);
      }
    }
  );
};
