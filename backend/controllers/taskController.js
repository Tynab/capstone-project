import mongoose from "mongoose";
import taskModel from "../models/taskModel.js";
import { sendTaskAddedMail } from "../services/mailService.js";
import logger from "../utils/logger.js";

// Envelope thống nhất cho mọi endpoint: LUÔN là object JSON, có `message` cho
// người đọc và các key đặt theo tài nguyên (`task`, `tasks`). Trước đây mỗi
// endpoint một kiểu: {message}, {user, token}, {user}, và cả mảng thô.

const addTask = async (req, res) => {
  const { title, description } = req.body;

  // Endpoint ghi chính của app mà trước đây không kiểm tra dữ liệu vào.
  if (
    typeof title !== "string" ||
    typeof description !== "string" ||
    !title.trim() ||
    !description.trim()
  ) {
    return res.status(400).json({ message: "Please enter all fields" });
  }

  try {
    // Dùng document mà requireAuth đã tải (nó phải đọc user để so tokenVersion):
    // trước đây chỗ này truy vấn users thêm một lần nữa cho MỖI task được thêm.
    // (Trước nữa, truy vấn đó còn nằm ngoài try/catch nên lỗi Mongo làm request treo.)
    const user = req.userDoc;
    if (!user || !user.email) {
      return res.status(404).json({ message: "User not found" });
    }

    const newTask = await taskModel.create({
      title,
      description,
      completed: false,
      userId: req.user.id,
    });

    // Không chờ mail: độ trễ SMTP không được nằm trong thời gian phản hồi.
    sendTaskAddedMail(user.email, title, description);

    return res.status(201).json({ message: "Task added successfully", task: newTask });
  } catch (error) {
    // Không trả error.message: thông báo của Mongoose lộ tên collection,
    // tên field và cả host/port của DB.
    logger.error("addTask error:", error.message);
    return res.status(500).json({ message: "Could not create task" });
  }
};

const getTask = async (req, res) => {
  try {
    const tasks = await taskModel.find({ userId: req.user.id });
    return res.status(200).json({ tasks });
  } catch (error) {
    logger.error("getTask error:", error.message);
    return res.status(500).json({ message: "Could not load tasks" });
  }
};

const removeTask = async (req, res) => {
  const { id } = req.params;

  // id không phải ObjectId hợp lệ sẽ ném CastError và lộ đường dẫn nội bộ
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: "Task not found" });
  }

  try {
    // chỉ xoá khi task thuộc về chính người đang đăng nhập
    const deleted = await taskModel.findOneAndDelete({ _id: id, userId: req.user.id });
    if (!deleted) {
      return res.status(404).json({ message: "Task not found" });
    }
    return res.status(200).json({ message: "Task deleted successfully" });
  } catch (error) {
    logger.error("removeTask error:", error.message);
    return res.status(500).json({ message: "Could not delete task" });
  }
};

// Endpoint còn thiếu trước đây: không có cách nào lưu trạng thái hoàn thành,
// nên tick trên UI chỉ là state tạm trong phiên.
const updateTask = async (req, res) => {
  const { id } = req.params;
  const { completed } = req.body;

  if (typeof completed !== "boolean") {
    return res.status(400).json({ message: "`completed` must be a boolean" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: "Task not found" });
  }

  try {
    // Lọc theo cả userId để không sửa được task của người khác
    const updated = await taskModel.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $set: { completed } },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ message: "Task not found" });
    }
    return res.status(200).json({ message: "Task updated successfully", task: updated });
  } catch (error) {
    logger.error("updateTask error:", error.message);
    return res.status(500).json({ message: "Could not update task" });
  }
};

export { addTask, getTask, removeTask, updateTask };
