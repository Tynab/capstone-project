# node:20-slim (glibc) chứ không phải alpine: bcrypt là native addon, trên musl
# thường phải build lại từ source và dễ vỡ khi thiếu toolchain.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
# Mã nguồn mặc định 8001 khi thiếu PORT; đặt 8000 ngay trong image để image tự
# nhất quán với EXPOSE bên dưới (đã gặp thật: thiếu biến -> app nghe 8001, map
# cổng 8000 không tới đâu).
ENV PORT=8000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Không chạy bằng root: container bị chiếm cũng không có quyền trong image.
USER node
EXPOSE 8000

# Healthcheck bằng chính Node (fetch có sẵn từ Node 18): image node:20-slim
# KHÔNG có wget lẫn curl, nên healthcheck kiểu wget sẽ luôn fail và container
# bị đánh dấu unhealthy dù app chạy tốt.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
