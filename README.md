# Todo App — hạ tầng DevOps trên Docker Swarm

[![CI/CD](https://github.com/Tynab/capstone-project/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Tynab/capstone-project/actions/workflows/ci-cd.yml)

Bài cuối khóa **CyberSoft DevOps 04**. Ứng dụng todo 3 phần (React + Express + MongoDB) chạy trên
**Docker Swarm 2 node** dựng hoàn toàn bằng IaC, kèm pipeline CICD và hệ thống giám sát.

- **CICD**: GitHub Actions — test → build image → deploy lên swarm qua self-hosted runner, có rollback bằng tag.
- **Giám sát**: Prometheus + Grafana + node-exporter + cAdvisor + mongodb-exporter + blackbox-exporter.
- **Hạ tầng**: Vagrant + Ansible, một lệnh trên Windows là có cụm 2 node đang chạy.

## Kiến trúc

```
Windows 11 (máy dev)                        GitHub
┌──────────────────────────┐               ┌───────────────────────────┐
│ infra\setup.cmd          │               │ Actions: test → build     │
│   ├─ cài VirtualBox+     │               │   → deploy (runner tự    │
│   │  Vagrant nếu thiếu   │               │     host trong VM)        │
│   └─ vagrant up +        │               └───────────▲───────────────┘
│      provision Ansible   │                           │ kéo job
└───────────┬──────────────┘                           │
            │ tạo & cấu hình                           │
            ▼                                          │
   Docker Swarm (host-only 192.168.56.0/24)            │
   ┌────────────────────────────────┐  ┌───────────────┴───────────────┐
   │ swarm-manager · 192.168.56.10  │  │ swarm-worker · 192.168.56.11  │
   │  frontend(nginx) · backend     │  │  mongo + volume               │
   │  prometheus · grafana · mailpit│  │  backend · frontend           │
   │  portainer(:9000) · cloudflared│  │  portainer-agent              │
   │  mongodb/blackbox exporter     │  │  node-exporter · cAdvisor     │
   │  node-exporter · cAdvisor      │  │                               │
   │  GitHub self-hosted runner     │  │                               │
   └────────────────────────────────┘  └───────────────────────────────┘
```

Truy cập từ máy dev: **80** app · **9000** Portainer · **9090** Prometheus · **3001** Grafana ·
**8025** Mailpit (hộp thư của lab).

Công khai qua **Cloudflare Tunnel** (bật/gỡ bằng một biến trong `infra/.env`):
<https://capstone.yamiannephilim.com> cho app và <https://capstone-api.yamiannephilim.com> cho API.

## Thành phần

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| [frontend/](frontend/) | React 18 (CRA) + Tailwind, phục vụ bằng nginx | Giao diện; nginx proxy `/api` sang backend nên cùng origin, không cần CORS |
| [backend/](backend/) | Express 4 + Mongoose 6 (ESM), JWT | API: user, task, quên/đặt lại mật khẩu; rate limit theo IP |
| [infra/](infra/) | Vagrant + Ansible → Docker Swarm | Dựng 2 VM, cài Docker, join swarm, sinh secret, deploy stack, cài runner |
| [e2e/](e2e/) | Node + mongodb-memory-server + puppeteer-core | Test trên hạ tầng thật: 43 khẳng định tầng API + 13 khẳng định qua Chrome |
| [.github/workflows/](.github/workflows/) | GitHub Actions | Pipeline test → build → deploy |
| Cloudflare Tunnel | cloudflared chạy trong stack | Đưa app/API ra domain thật mà không mở cổng vào, không cần IP công khai |
| Portainer | portainer-ce + agent (`mode: global`) | Quản trị swarm trên UI, xem container/volume/image của cả 2 node |
| [docs/](docs/) | — | Đặc tả thiết kế và kế hoạch thi công của phần hạ tầng |

## Bắt đầu nhanh

### A. Dựng lab đầy đủ (cách của bài nộp)

```bash
infra\setup.cmd          # cài VirtualBox/Vagrant nếu thiếu, dựng 2 VM, deploy stack
```

Sau khi xong: app ở <http://192.168.56.10>, Grafana ở <http://192.168.56.10:3001>.
Mật khẩu lab nằm trong `/opt/capstone/.env` của VM manager
(`vagrant ssh manager -c "sudo cat /opt/capstone/.env"`).

Chi tiết dựng, vận hành, sao lưu và xử lý sự cố: **[infra/README.md](infra/README.md)**.

### B. Chạy từng phần trên máy (khi phát triển)

```bash
# Backend — cần MongoDB đang chạy
cd backend
cp .env.example .env     # điền MONGO_URI và JWT_SECRET
npm install && npm start # http://localhost:8000

# Frontend
cd frontend
npm install && npm start # http://localhost:3000

# Test (không cần cài MongoDB: bộ test tự dựng mongod)
cd backend && npm test              # unit test
cd e2e && npm install
npm run test:api                    # 43 khẳng định tầng HTTP
npm run test:browser                # 13 khẳng định qua Chrome thật
```

## CICD

Mỗi lần push lên `main`, [ci-cd.yml](.github/workflows/ci-cd.yml) chạy ba job:

| Job | Chạy trên | Việc |
|---|---|---|
| `test` | runner GitHub | unit test backend, e2e tầng API, e2e qua trình duyệt thật |
| `build` | runner GitHub | build 2 image, đẩy lên GHCR với tag `<sha 7 ký tự>` + `latest` |
| `deploy` | **runner self-hosted trong VM manager** | `docker stack deploy` đúng tag vừa build, chờ hội tụ rồi kiểm `/api/health` và đối chiếu ảnh đang chạy |

**Rollback**: chạy workflow bằng tay với input `image_tag` là tag cũ — swarm kéo lại đúng bản đó.
Nếu runner offline (VM tắt), job `deploy` sẽ nằm ở trạng thái `queued` cho tới khi VM bật lại.

## Giám sát

Prometheus scrape 7 target: node-exporter và cAdvisor trên **cả hai node** (phần cứng + container),
mongodb-exporter (trạng thái database), và blackbox-exporter đo chính app qua nginx.
Grafana nạp sẵn datasource + dashboard "Capstone overview" (7 panel) từ file khi khởi động —
không phải bấm tay.

## Cấu trúc repo

```
backend/     API Express + Mongoose (ESM)      · chi tiết: backend/CLAUDE.md
frontend/    React (CRA) + nginx               · chi tiết: frontend/README.md
e2e/         Test trên hạ tầng thật            · chi tiết: e2e/README.md
infra/       Vagrant + Ansible → Docker Swarm  · chi tiết: infra/README.md
docs/        Đặc tả thiết kế + kế hoạch thi công phần hạ tầng
CLAUDE.md    Hướng dẫn cho agent làm việc trong repo này
```

## Ghi chú

- **Không có secret nào trong repo.** `backend/.env` bị `.gitignore` chặn; secret của lab do Ansible
  sinh ngẫu nhiên và lưu trong VM (`/opt/capstone/.env`, quyền 0640). Chỉ commit các file `.env.example`.
- Image trên GHCR là package công khai để cả hai node kéo được mà không cần credential — nội dung
  image chỉ là mã ứng dụng, không chứa secret.
- Repo công khai nên workflow **không** bật trigger `pull_request`: với self-hosted runner, PR từ fork
  có thể chạy code tùy ý trên VM (xem ghi chú trong [ci-cd.yml](.github/workflows/ci-cd.yml)).
