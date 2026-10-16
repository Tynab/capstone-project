import jwt from "jsonwebtoken";
import userModel from "../models/userModel.js";

const requireAuth = async (req, res, next) => {
  const { authorization } = req.headers;
  if (!authorization) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authorization.split(" ")[1] + "";
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Đối chiếu tokenVersion: token phát hành trước lần đổi mật khẩu gần nhất bị từ chối.
    // Token cũ không có field này nên cũng bị loại -> người dùng phải đăng nhập lại.
    // Lấy kèm email: controller thêm task cần email để gửi thông báo, dùng lại
    // document này thay vì truy vấn users thêm một lần nữa cho mỗi task.
    const user = await userModel.findById(decoded.id).select("tokenVersion email");
    if (!user || user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = decoded;
    req.userDoc = user;
    next();
  } catch (error) {
    // không trả error.message ra ngoài: thông báo của jwt hay Mongoose lộ chi tiết nội bộ
    return res.status(401).json({ message: "Unauthorized" });
  }
};
export default requireAuth;
