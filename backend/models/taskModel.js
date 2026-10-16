import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    // ObjectId ref tới User, kèm index vì mọi truy vấn task đều lọc theo userId.
    //
    // LƯU Ý KHI NÂNG CẤP: dữ liệu cũ lưu userId dưới dạng CHUỖI. Phải chạy
    // `npm run migrate:userid` trước khi khởi động server với schema này — nếu không,
    // truy vấn `{ userId: req.user.id }` sẽ không khớp bản ghi cũ (Mongoose cast giá
    // trị truy vấn thành ObjectId, còn dữ liệu lưu là chuỗi), và task biến mất khỏi
    // UI dù vẫn còn nguyên trong DB.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    completed: { type: Boolean, required: true },
  },
  { timestamps: true }
);

const taskModel = mongoose.model("Task", taskSchema);
export default taskModel;
