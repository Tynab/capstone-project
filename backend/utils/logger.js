// Logger tối giản, không thêm phụ thuộc ngoài.
//
// Lý do tồn tại: trước đây mọi thứ đều là console.log, không phân biệt được lỗi
// với thông tin thường, không có thời gian, và không tắt được khi chạy thật.
//
// Mức đọc từ LOG_LEVEL (error | warn | info | debug, mặc định info). Đọc LÚC GỌI
// chứ không phải lúc import: server.js gọi dotenv.config() sau khi các module đã
// được nạp, nên đọc sớm sẽ bỏ qua giá trị trong .env.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const currentThreshold = () => {
  const configured = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[configured] === undefined ? LEVELS.info : LEVELS[configured];
};

const format = (value) => {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const write = (level, args) => {
  if (LEVELS[level] > currentThreshold()) return;
  // Lỗi và cảnh báo ra stderr để tách được khỏi luồng log thường khi deploy.
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${new Date().toISOString()} [${level.toUpperCase()}] ${args.map(format).join(" ")}\n`);
};

const logger = {
  error: (...args) => write("error", args),
  warn: (...args) => write("warn", args),
  info: (...args) => write("info", args),
  debug: (...args) => write("debug", args),
};

export default logger;
