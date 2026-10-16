FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Đường dẫn TƯƠNG ĐỐI: request /api đi qua chính nginx của container này rồi
# được proxy sang backend, nên bundle không phụ thuộc tên miền nào.
# Vite nhúng biến VITE_* lúc build -> phải truyền bằng build-arg (trước đây là
# REACT_APP_API_URL của CRA).
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Vite xuất ra dist/ (CRA xuất ra build/).
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
