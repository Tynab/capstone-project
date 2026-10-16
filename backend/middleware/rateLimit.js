// Giới hạn tần suất theo IP, lưu trong bộ nhớ tiến trình (cửa sổ cố định).
// Đúng cho một instance. Nếu chạy nhiều instance thì phải thay Map này bằng store dùng chung (Redis),
// vì mỗi instance đếm riêng nên giới hạn thực tế sẽ nhân lên theo số instance.
const buckets = new Map();
const MAX_BUCKETS = 10000;
let instanceCount = 0;

// Mỗi lần chạm trần chỉ quét tối đa ngần này bucket. Quét cả Map 10.000 phần tử
// ngay trong request đang chịu tải là chi phí O(n) đúng lúc tệ nhất.
const EVICT_SCAN_LIMIT = 500;

// Xoá bucket hết hạn trong phạm vi đã quét. Trả về số bucket đã xoá.
// Tách riêng để test được mà không cần dựng cả middleware.
export const evictExpired = (buckets, now, scanLimit = EVICT_SCAN_LIMIT) => {
  let scanned = 0;
  let deleted = 0;
  for (const [key, entry] of buckets) {
    if (scanned >= scanLimit) break;
    scanned += 1;
    if (now > entry.resetAt) {
      buckets.delete(key);
      deleted += 1;
    }
  }
  return deleted;
};

// Quét có trần; nếu vẫn đầy thì xoá dần bucket cũ nhất (Map giữ thứ tự chèn).
const evict = (now) => {
  evictExpired(buckets, now);
  let guard = 0;
  while (buckets.size >= MAX_BUCKETS && guard < MAX_BUCKETS) {
    buckets.delete(buckets.keys().next().value);
    guard += 1;
  }
};

const rateLimit = ({ windowMs, max, message }) => {
  // Khoá theo instance limiter, KHÔNG theo URL.
  // req.originalUrl giữ cả query string, nên khoá theo URL thì chỉ cần thêm ?x=1 mỗi request
  // là mỗi lần một bucket mới và giới hạn không bao giờ chạm tới.
  const limiterId = ++instanceCount;

  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size >= MAX_BUCKETS) evict(now);

    // req.ip là địa chỉ socket, không giả mạo được. Sau reverse proxy phải bật TRUST_PROXY
    // (xem server.js) để lấy IP thật của client, nếu không mọi request dùng chung một bucket.
    const key = `${limiterId}:${req.ip}`;
    const entry = buckets.get(key);

    if (!entry || now > entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
};

export default rateLimit;
