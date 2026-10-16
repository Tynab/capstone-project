// PostCSS chạy qua Vite (trước đây CRA tự cấu hình PostCSS bên trong react-scripts
// nên file này KHÔNG có tác dụng; từ khi chuyển sang Vite thì nó là bắt buộc —
// thiếu nó là Tailwind không sinh CSS và giao diện mất sạch style).
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
