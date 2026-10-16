import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // Lưu SHA-256 của token, KHÔNG lưu token thô: đọc được DB cũng không dùng được token
  // Index vì resetPassword lọc theo resetToken ở hai truy vấn mỗi lần thử
  // (exists rồi findOneAndUpdate); không index là mỗi lần quét cả collection.
  resetToken: { type: String, required: false, index: true },
  resetTokenExpiry: { type: Date, required: false },
  // Tăng lên mỗi lần đổi mật khẩu -> mọi JWT phát hành trước đó hết hiệu lực
  tokenVersion: { type: Number, default: 0 },
});

const userModel = mongoose.model("User", userSchema);
export default userModel;
