// Migration một lần: chuyển `task.userId` từ chuỗi sang ObjectId.
//
// PHẢI chạy TRƯỚC khi khởi động server với schema userId kiểu ObjectId. Nếu không,
// mọi task cũ vẫn nằm trong DB dưới dạng chuỗi, và truy vấn `{ userId: req.user.id }`
// (Mongoose cast giá trị truy vấn thành ObjectId) sẽ không khớp bản ghi nào — task
// biến mất khỏi UI dù dữ liệu vẫn còn nguyên.
//
// Chạy:  npm run migrate:userid
// Script idempotent: chỉ đụng tới document có userId đang là chuỗi.
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("Thiếu MONGO_URI trong .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true });
  const tasks = mongoose.connection.collection("tasks");

  const pending = await tasks.countDocuments({ userId: { $type: "string" } });
  console.log(`Tìm thấy ${pending} task có userId kiểu chuỗi.`);
  if (pending === 0) {
    console.log("Không có gì phải chuyển.");
  }

  let converted = 0;
  let skipped = 0;
  const cursor = tasks.find({ userId: { $type: "string" } });

  for await (const doc of cursor) {
    if (!mongoose.Types.ObjectId.isValid(doc.userId)) {
      skipped += 1;
      console.warn(`Bỏ qua task ${doc._id}: userId "${doc.userId}" không phải ObjectId hợp lệ.`);
      continue;
    }
    await tasks.updateOne(
      { _id: doc._id },
      { $set: { userId: new mongoose.Types.ObjectId(doc.userId) } }
    );
    converted += 1;
  }

  console.log(`Đã chuyển ${converted} task, bỏ qua ${skipped} task.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Migration thất bại:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
