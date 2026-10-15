# node:20-slim (glibc) chứ không phải alpine: bcrypt là native addon, trên musl
# thường phải build lại từ source và dễ vỡ khi thiếu toolchain.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Không chạy bằng root: container bị chiếm cũng không có quyền trong image.
USER node
EXPOSE 8000

# /api/health trả 200 khi server đã lên (server chỉ listen sau khi nối được DB,
# nên healthcheck này cũng bao hàm luôn trạng thái DB).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8000/api/health || exit 1

CMD ["node", "server.js"]
