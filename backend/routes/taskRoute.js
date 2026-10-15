import express from "express"
import { addTask, getTask, removeTask, updateTask } from "../controllers/taskController.js"
import requireAuth from "../middleware/requireAuth.js";
const router = express.Router();

router.post("/addTask", requireAuth, addTask)
router.get("/getTask", requireAuth, getTask)

// Xoá làm thay đổi dữ liệu nên phải là DELETE, và id nằm trên đường dẫn.
// Trước đây là `GET /removeTask` đọc `req.body.id`: trình duyệt không gửi body
// kèm GET nên id luôn undefined, endpoint không bao giờ chạy được — và GET có
// side-effect thì bị prefetch/crawler/proxy gọi vào lúc nào không biết.
router.delete("/removeTask/:id", requireAuth, removeTask)

// Trước đây backend không có endpoint cập nhật nào, nên trạng thái hoàn thành
// không thể lưu xuống DB.
router.patch("/updateTask/:id", requireAuth, updateTask)

export default router;
