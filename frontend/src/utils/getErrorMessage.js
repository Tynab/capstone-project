// Lấy thông báo lỗi từ response mà không làm ném lỗi thêm lần nữa.
//
// Khi lỗi mạng (backend tắt, sai host, bị CORS chặn) axios reject với `error.response`
// là undefined. Đọc thẳng `error.response.data.message` trong khối catch sẽ ném
// TypeError ngay tại đó, và người dùng không nhận được thông báo lỗi nào.
export const getErrorMessage = (
  error,
  fallback = "Không kết nối được máy chủ. Vui lòng thử lại."
) => {
  const message = error && error.response && error.response.data && error.response.data.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
};
