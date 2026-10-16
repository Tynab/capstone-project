// Cấu hình Vite — thay cho react-scripts (CRA 5 đã ngừng bảo trì: bản 5.0.1 là bản
// cuối và không còn bản vá cho hàng loạt gói trong cây của nó).
//
// Ba chi tiết cố ý, đừng đổi nếu không sửa kèm nơi khác:
// - Cổng dev server đọc từ biến PORT (mặc định 3000) và `strictPort: true`:
//   e2e/lib/stack.mjs dựng frontend bằng `npm start` với PORT=3000, và browser e2e
//   trỏ vào http://localhost:3000. strictPort để Vite KHÔNG tự nhảy sang cổng khác
//   khi 3000 bận — nhảy cổng là e2e trỏ sai chỗ rồi đỏ rất khó hiểu.
// - build.outDir = dist (Bản CRA dùng build/): Dockerfile COPY từ dist.
// - Khối `test` là của Vitest (đọc chung file này qua vitest/config), môi trường
//   jsdom + nạp src/setupTests.js; `globals: true` để test dùng describe/test/expect
//   không cần import.
import { defineConfig } from "vitest/config";
// `loadEnv` nằm trong 'vite', KHÔNG có trong 'vitest/config' (Vitest 5 chỉ tái xuất
// defineConfig) — import sai chỗ là config không load được và mọi lệnh đều đỏ.
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Proxy /api khi chạy dev server. Ứng dụng LUÔN gọi đường dẫn tương đối `/api`
  // (mặc định trong src/api/client.js) nên dev và production đi cùng một đường:
  // production là nginx proxy sang backend, dev là Vite proxy sang backend.
  // Nhờ vậy e2e không phải nhồi URL tuyệt đối vào bundle nữa.
  //
  // Cố ý đọc biến ở ĐÂY (chạy trong Node) chứ không dùng import.meta.env: Vite chỉ
  // đưa process.env.VITE_* vào import.meta.env ở đường BUILD, KHÔNG đưa vào dev server
  // — đo thật: chạy `VITE_API_URL=... npx vite` rồi đọc trong trình duyệt thì
  // import.meta.env chỉ có {mode:'development', dev:true}; app rơi về localhost:8000 và
  // e2e trình duyệt đỏ với ERR_CONNECTION_REFUSED. (Tự `define` khoá
  // "import.meta.env.VITE_API_URL" cũng KHÔNG ăn — Vite tự quản khoá đó.)
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = env.VITE_API_URL || process.env.VITE_API_URL;
  // Đích proxy: ưu tiên URL tuyệt đối trong VITE_API_URL, rồi VITE_PROXY_TARGET
  // (e2e dùng biến này), cuối cùng là backend mặc định khi chạy tay.
  const proxyTarget =
    (apiUrl && /^https?:/.test(apiUrl) ? apiUrl : null) ||
    process.env.VITE_PROXY_TARGET ||
    "http://localhost:8000";

  return {
    plugins: [react()],
    server: {
      port: Number(process.env.PORT) || 3000,
      strictPort: true,
      proxy: {
        "/api": { target: proxyTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/setupTests.js",
      include: ["src/**/*.{test,spec}.{js,jsx}"],
    },
  };
});
