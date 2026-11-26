// Thay cho moment().fromNow(). moment nặng ~66KB gzip mà cả app chỉ dùng đúng
// một hàm, trong khi Intl.RelativeTimeFormat có sẵn trong trình duyệt.
// Giữ "en" cho khớp phần còn lại của giao diện (đang là tiếng Anh).
const DIVISIONS = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const formatRelativeTime = (date) => {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return "";

  let duration = (time - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "";
};
