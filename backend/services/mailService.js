import { createTransport } from "nodemailer";
import dotenv from "dotenv";
import logger from "../utils/logger.js";
import { buildTransportOptions, hasMailConfig } from "./smtpConfig.js";
dotenv.config();

// Địa chỉ gửi lấy từ env thay vì hardcode: đổi người gửi không phải sửa code.
// Gmail SMTP bắt buộc `from` phải là chính tài khoản đã xác thực, nên mặc định
// lấy GMAIL_USERNAME; giá trị dự phòng chỉ để không vỡ với .env cũ.
const mailFrom = () => process.env.GMAIL_USERNAME || "alok.yadav6000@gmail.com";

const createTransporter = () => createTransport(buildTransportOptions());

// Gửi mail là việc phụ, không được làm hỏng luồng chính.
// Trước đây hàm này nằm trong taskController và lỗi chỉ được console.log,
// nên addTask vẫn trả 200 kể cả khi mail không bao giờ tới.
export const sendTaskAddedMail = (email, title, description) => {
  if (!hasMailConfig()) {
    logger.warn('Bỏ qua mail "Task Added": chưa cấu hình SMTP_HOST lẫn GMAIL_USERNAME/GMAIL_PASSWORD');
    return;
  }

  createTransporter().sendMail(
    {
      from: mailFrom(),
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
