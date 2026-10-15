// Giới hạn tần suất theo IP, lưu trong bộ nhớ tiến trình (cửa sổ cố định).
// Đúng cho một instance. Nếu chạy nhiều instance thì phải thay Map này bằng store dùng chung (Redis),
// vì mỗi instance đếm riêng nên giới hạn thực tế sẽ nhân lên theo số instance.
const buckets = new Map()
const MAX_BUCKETS = 10000
let instanceCount = 0

// Xoá bucket đã hết hạn; nếu vẫn đầy thì xoá dần bucket cũ nhất (Map giữ thứ tự chèn).
// Chỉ gọi khi Map đã chạm trần, và luôn đưa size xuống dưới trần, nên chi phí O(n) được chia đều.
const evict = (now) => {
    for (const [key, entry] of buckets) {
        if (now > entry.resetAt) buckets.delete(key)
    }
    while (buckets.size >= MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value)
    }
}

const rateLimit = ({ windowMs, max, message }) => {
    // Khoá theo instance limiter, KHÔNG theo URL.
    // req.originalUrl giữ cả query string, nên khoá theo URL thì chỉ cần thêm ?x=1 mỗi request
    // là mỗi lần một bucket mới và giới hạn không bao giờ chạm tới.
    const limiterId = ++instanceCount

    return (req, res, next) => {
        const now = Date.now()
        if (buckets.size >= MAX_BUCKETS) evict(now)

        // req.ip là địa chỉ socket, không giả mạo được. Sau reverse proxy phải bật TRUST_PROXY
        // (xem server.js) để lấy IP thật của client, nếu không mọi request dùng chung một bucket.
        const key = `${limiterId}:${req.ip}`
        const entry = buckets.get(key)

        if (!entry || now > entry.resetAt) {
            buckets.set(key, { count: 1, resetAt: now + windowMs })
            return next()
        }

        entry.count += 1
        if (entry.count > max) {
            res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)))
            return res.status(429).json({ message })
        }
        next()
    }
}

export default rateLimit
