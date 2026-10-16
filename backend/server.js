import express from "express"
import mongoose from "mongoose"
import cors from "cors"
import helmet from "helmet"
import dotenv from "dotenv"
import logger from "./utils/logger.js"
import { hasMailConfig } from "./services/smtpConfig.js"

import userRouter from "./routes/userRoute.js"
import taskRouter from "./routes/taskRoute.js"
import forgotPasswordRouter from "./routes/forgotPassword.js"

//app config
dotenv.config()

//dừng ngay nếu thiếu secret, thay vì để mọi request auth lỗi 500 khó hiểu
if (!process.env.JWT_SECRET) {
    logger.error("Thiếu JWT_SECRET trong .env")
    process.exit(1)
}

const app = express()
const port = process.env.PORT || 8001
mongoose.set('strictQuery', true);

// Thiếu thông tin Gmail thì không mail nào gửi được, nhưng /forgotPassword vẫn trả 200
// với thông báo "đã gửi link" -> người dùng chờ một link không bao giờ tới. Cảnh báo sớm.
// Dùng hasMailConfig() chứ không kiểm riêng GMAIL_*: trong lab SMTP_HOST=mailpit
// nên mail VẪN gửi được, cảnh báo cũ in sai và làm người đọc tưởng hỏng chức năng.
if (!hasMailConfig()) {
    logger.warn("CẢNH BÁO: chưa cấu hình SMTP_HOST lẫn GMAIL_USERNAME/GMAIL_PASSWORD — chức năng quên mật khẩu sẽ không gửi được mail (API vẫn trả 200).")
}

// Sau reverse proxy (nginx trong Docker), bật TRUST_PROXY=1 để req.ip là IP thật của client.
// Chỉ bật khi thực sự có proxy: nếu không, client tự đặt header X-Forwarded-For và vượt được rate limit.
if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1)
}

//middlewares
// helmet đặt các header phòng thủ (X-Content-Type-Options, X-Frame-Options, CSP...).
app.use(helmet())
app.use(express.json())

// CORS chỉ mở cho origin của frontend. `cors()` không tham số đặt Access-Control-Allow-Origin: *,
// nghĩa là mọi trang web đều đọc được response của API này từ trình duyệt nạn nhân.
// Danh sách lấy từ CORS_ORIGIN (phân tách bằng dấu phẩy) để đổi khi đổi tên miền.
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000,https://todo-app-b96a5.web.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

app.use(cors({
    origin: (origin, callback) => {
        // Không có Origin: request cùng origin, curl, health check của Docker.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true)
        }
        // Trả về false (không phải Error) để chỉ đơn giản là không gắn header CORS —
        // trình duyệt tự chặn, và server không sinh ra lỗi 500 vô nghĩa trong log.
        logger.warn("CORS: từ chối origin", origin)
        return callback(null, false)
    },
}))

//db config
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
}, async (err) => {
    if (err) {
        // Không mở cổng khi chưa có DB. Trước đây server vẫn listen nên nó trông như
        // đang chạy, trong khi mọi request cần DB đều treo hoặc lỗi 500 khó hiểu.
        // Thoát hẳn để Docker/hệ thống giám sát thấy container chết và khởi động lại.
        //
        // Lưu ý: callback này chỉ chạy sau serverSelectionTimeoutMS của Mongoose
        // (mặc định 30s), nên khi DB không tới được thì phải chờ ~30s mới thấy thoát.
        // Đừng hạ timeout này xuống thấp: trong docker-compose, container API thường
        // khởi động trước khi Mongo sẵn sàng, hạ xuống sẽ làm container chết lặp.
        logger.error("Không kết nối được MongoDB:", err.message)
        process.exit(1)
    }
    logger.info("DB Connected")

    // Cảnh báo sớm nếu DB còn dữ liệu theo schema cũ (userId kiểu chuỗi): những task
    // đó sẽ không khớp truy vấn theo ObjectId nữa nên biến mất khỏi UI. Kiểm tra ở
    // đây rẻ hơn nhiều so với việc người dùng tự hỏi vì sao task của họ mất.
    try {
        const stale = await mongoose.connection
            .collection("tasks")
            .countDocuments({ userId: { $type: "string" } })
        if (stale > 0) {
            logger.error(`CÓ ${stale} task với userId kiểu chuỗi (schema cũ). Chạy "npm run migrate:userid" rồi khởi động lại, nếu không chúng sẽ không hiển thị.`)
        }
    } catch (checkError) {
        logger.warn("Không kiểm tra được dữ liệu cũ:", checkError.message)
    }

    // Healthcheck: dùng cho HEALTHCHECK của image, healthcheck của swarm và
    // blackbox-exporter. Chỉ trả trạng thái sống, không lộ thông tin nội bộ.
    // Đặt ngoài requireAuth vì probe không mang token.
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }))

    //api endpoints
    app.use("/api/user", userRouter)
    app.use("/api/task", taskRouter)
    app.use("/api/forgotPassword", forgotPasswordRouter)

    //listen
    app.listen(port, () => logger.info(`Listening on localhost:${port}`))
})
