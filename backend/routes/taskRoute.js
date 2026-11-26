import express from "express";
import { addTask, getTask, removeTask, updateTask } from "../controllers/taskController.js";
import requireAuth from "../middleware/requireAuth.js";
import rateLimit from "../middleware/rateLimit.js";
const router = express.Router();

// Các route GHI đều gửi mail (addTask) hoặc đổi dữ liệu, nên phải có trần: một tài
// khoản đã đăng nhập trước đây có thể kích hoạt gửi mail không giới hạn.
// Đặt limiter TRƯỚC requireAuth để request không hợp lệ cũng bị đếm.
const taskWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many task operations, please try again later.",
});

router.post("/addTask", taskWriteLimiter, requireAuth, addTask);
// Đọc thì không giới hạn: danh sách task được gọi lại nhiều lần khi dùng UI bình thường.
router.get("/getTask", requireAuth, getTask);

// Xoá làm thay đổi dữ liệu nên phải là DELETE, và id nằm trên đường dẫn.
// Trước đây là `GET /removeTask` đọc `req.body.id`: trình duyệt không gửi body
// kèm GET nên id luôn undefined, endpoint không bao giờ chạy được — và GET có
// side-effect thì bị prefetch/crawler/proxy gọi vào lúc nào không biết.
router.delete("/removeTask/:id", taskWriteLimiter, requireAuth, removeTask);

// Trước đây backend không có endpoint cập nhật nào, nên trạng thái hoàn thành
// không thể lưu xuống DB.
router.patch("/updateTask/:id", taskWriteLimiter, requireAuth, updateTask);

export default router;
