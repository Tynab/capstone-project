import userModel from "../models/userModel.js";
import { getTransporter } from "../services/mailService.js";
import crypto from "crypto";
import { hashPassword } from "../utils/password.js";
import logger from "../utils/logger.js";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

// Cùng ràng buộc với lúc đăng ký (xem userController.js): trước đây không có
// kiểm tra nào nên mật khẩu một ký tự vẫn đặt lại được.
const MIN_PASSWORD_LENGTH = 8;

// Trang reset phải trỏ tới frontend đã deploy, không phải bản chạy local.
// Đọc LÚC DÙNG chứ không phải lúc import: dotenv.config() chạy sau khi module được
// nạp, nên đọc sớm thì giá trị đúng phụ thuộc thứ tự nạp module (đã từng như vậy).
const frontendUrl = () => process.env.FRONTEND_URL || "https://todo-app-b96a5.web.app";

// DB chỉ giữ hash của token, không giữ token thô: đọc được collection cũng không dùng được token
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Route to handle "forgot password" request
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  // email phải là chuỗi: nếu nhận object, findOne sẽ hiểu đó là operator ($ne, $regex...)
  // và khớp user bất kỳ, cho phép ghi resetToken lên tài khoản không thuộc người gọi
  if (typeof email !== "string" || !email) {
    return res.status(400).json({ message: "Please enter all fields" });
  }

  // Luôn trả CÙNG một thông báo dù email có tồn tại hay không, để không dò được tài khoản nào đã đăng ký
  const genericMessage = "If that email is registered, a reset link has been sent.";

  try {
    const user = await userModel.findOne({ email });

    if (user) {
      const rawToken = crypto.randomBytes(20).toString("hex");
      user.resetToken = hashToken(rawToken);
      user.resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await user.save();

      const resetUrl = `${frontendUrl()}/resetPassword?token=${rawToken}`;
      // Dùng chung transporter với mailService (dùng lại kết nối thay vì tạo mới
      // mỗi thư). Cấu hình lấy từ env — xem services/smtpConfig.js.
      const transporter = getTransporter();

      // KHÔNG await gửi mail. Thời gian gửi SMTP là vài trăm ms tới vài giây, nên
      // await làm thời gian phản hồi khác hẳn giữa "email có trong DB" và "không có"
      // — biến endpoint này thành công cụ dò email, đúng thứ mà thông báo chung đang
      // cố che. Lỗi gửi mail vẫn được ghi log qua .catch, không bị nuốt im lặng.
      transporter
        .sendMail({
          // Gmail SMTP bắt buộc from là chính tài khoản đã xác thực, nên lấy từ
          // env thay vì hardcode: đổi người gửi không phải sửa code.
          from: process.env.GMAIL_USERNAME || "alok.yadav6000@gmail.com",
          to: email,
          subject: "Reset Password",
          html: `<h1>Reset Password</h1><h2>Click on the link to reset your password</h2><h3>${resetUrl}</h3>`,
        })
        .catch((error) => {
          logger.error("forgotPassword mail error:", error.message);
        });
    }
  } catch (error) {
    // vẫn trả thông báo chung: nếu trả lỗi riêng thì kẻ tấn công dò được email qua phản hồi
    logger.info("forgotPassword error:", error.message);
  }

  res.status(200).json({ message: genericMessage });
};

//  Route to handle password reset request
const resetPassword = async (req, res) => {
  const { token, password } = req.body;

  // token phải là chuỗi: token = null khớp mọi user chưa có resetToken (Mongo coi null khớp cả field thiếu),
  // và object {$ne: null} khớp user bất kỳ -> ghi đè mật khẩu người khác mà không cần xác thực
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }
  if (typeof password !== "string" || !password) {
    return res.status(400).json({ message: "Please enter all fields" });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    // Kiểm tra rẻ trước: bcrypt cost 10 tốn CPU và một slot của libuv threadpool,
    // nên nếu hash trước khi kiểm token thì request rác nào cũng bắt server trả giá đó.
    // Đây chỉ là chốt chặn sớm — tính nguyên tử vẫn do findOneAndUpdate bên dưới đảm bảo.
    const candidate = await userModel.exists({
      resetToken: hashToken(token),
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!candidate) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const hashedPassword = await hashPassword(password);

    // findOneAndUpdate là MỘT thao tác nguyên tử, nên hai request song song cùng token
    // thì chỉ một request khớp được và đổi mật khẩu; request kia không tìm thấy gì.
    // (findOne rồi save sẽ cho cả hai cùng qua và cùng ghi — phá vỡ tính dùng-một-lần.)
    // Chỉ khớp token còn hạn; token cũ không có resetTokenExpiry nên cũng bị loại.
    const user = await userModel.findOneAndUpdate(
      {
        resetToken: hashToken(token),
        resetTokenExpiry: { $gt: new Date() },
      },
      {
        $set: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
        // tăng tokenVersion -> mọi JWT đã phát hành trước đó hết hiệu lực, kể cả token bị đánh cắp
        $inc: { tokenVersion: 1 },
      },
      { new: true }
    );
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ message: "Password reset failed" });
  }
};
export { forgotPassword, resetPassword };
