import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    // Lưu SHA-256 của token, KHÔNG lưu token thô: đọc được DB cũng không dùng được token
    resetToken: { type: String, required: false },
    resetTokenExpiry: { type: Date, required: false },
    // Tăng lên mỗi lần đổi mật khẩu -> mọi JWT phát hành trước đó hết hiệu lực
    tokenVersion: { type: Number, default: 0 },
})


const userModel = mongoose.model("User", userSchema);
export default userModel;
