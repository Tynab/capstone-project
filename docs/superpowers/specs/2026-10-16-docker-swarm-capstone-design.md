# Thiết kế: Docker Swarm 2 node + giám sát + CICD cho bài cuối khóa

Ngày: 2026-10-16
Trạng thái: chờ duyệt (chưa thi công)

## 1. Mục tiêu và phạm vi

Đề bài ([du-an-cuoi-khoa.md](../../../du-an-cuoi-khoa.md)) yêu cầu đúng **2 hạng mục**: dựng CICD bằng GitHub Actions, và dựng hệ thống giám sát Grafana + Prometheus. Ứng dụng đã có sẵn trong repo (React + Express + MongoDB) và đã qua nhiều vòng review — thiết kế này dựng hạ tầng quanh nó, không viết lại ứng dụng.

Kết quả bàn giao:

- **Docker Swarm 2 node** (1 manager + 1 worker) trên 2 VM Vagrant, chạy MongoDB, backend, frontend, Prometheus, Grafana, Mailpit và các exporter.
- **Toàn bộ hạ tầng bằng IaC**: một script `infra/setup.cmd` cài công cụ còn thiếu rồi dựng xong từ đầu đến cuối; Ansible cấu hình cả 2 VM; không thao tác tay trên máy ảo.
- **Pipeline GitHub Actions 3 job** (test → build → deploy), deploy tự động chạy trên runner self-hosted đặt trong VM manager, có rollback bằng tag image.

**Ngoài phạm vi** (cố ý, để không ai chờ đợi): TLS/domain thật, Alertmanager/alerting, backup MongoDB tự động, metrics mức ứng dụng (`prom-client` trong Express), nhiều môi trường staging/prod, registry tự host.

## 2. Các quyết định kiến trúc

| Quyết định | Lý do |
|---|---|
| **CD bằng self-hosted runner trong VM manager** | Runner của GitHub là máy của GitHub, không nhìn thấy IP host-only `192.168.56.x`. Runner nằm trong VM tự kéo job về nên không phải mở port, không phụ thuộc tunnel/ngrok, và có sẵn quyền Docker tại chỗ để `stack deploy`. |
| **Ansible control node là VM manager** (`ansible_local`) | Windows không chạy Ansible native; dùng WSL2 sẽ thêm một dependency lớn. Manager điều khiển cả 2 VM qua SSH nội bộ bằng keypair sinh tại chỗ (`infra/.ssh/lab_key`, đã gitignore). |
| **Build trên runner GitHub, đẩy GHCR; deploy chỉ kéo image** | Image là artifact bất biến (`sha-xxxx`) nên rollback chỉ là deploy lại tag cũ. Máy bạn không gánh build. GHCR dùng `GITHUB_TOKEN` sẵn có, không cần secret lưu trữ. |
| **Mailpit trong stack + backend đọc SMTP từ env** | Luồng quên mật khẩu demo được trọn vẹn mà không cần credentials thật; cấu hình SMTP qua env vẫn giữ nguyên đường Gmail cũ khi `SMTP_HOST` trống. |
| **Mongo bật auth, mật khẩu sinh tự động** | `mongodb-exporter` cần tài khoản để đọc trạng thái DB; mặc định "không auth" của bản lab là điểm trừ khi chấm. |
| **Frontend là nginx phục vụ bản build CRA + proxy `/api`** | Cùng origin với backend → hết CORS, hết `REACT_APP_API_URL` trỏ vào máy người dùng, và `nginx` lo SPA fallback cho `BrowserRouter`. |

## 3. Sơ đồ tổng thể

```
Windows 11 (D:\capstone-project)
│
├─ infra/setup.cmd ──► cài VirtualBox + Vagrant (winget) nếu thiếu
│                      sinh keypair lab, lấy runner token (gh), rồi:
│                      vagrant up  +  vagrant provision --provision-with ansible
│
└─ Vagrant (VirtualBox, host-only 192.168.56.0/24)
   │
   ├─ VM swarm-manager · 192.168.56.10 · 4GB/2CPU
   │  ├─ docker swarm manager — Ansible control node (ansible_local)
   │  ├─ frontend (nginx :80)  backend (2 replica trải 2 node)
   │  ├─ prometheus (:9090) · grafana (:3001) · mailpit (:8025)
   │  ├─ mongodb-exporter · blackbox-exporter
   │  ├─ node-exporter + cAdvisor (mode: global)
   │  └─ GitHub self-hosted runner (systemd, labels: self-hosted, swarm-manager)
   │
   └─ VM swarm-worker · 192.168.56.11 · 4GB/2CPU
      ├─ docker swarm worker
      ├─ mongo + volume capstone_mongo_data
      ├─ frontend · backend (task thứ 2)
      └─ node-exporter + cAdvisor (mode: global)
```

Cổng truy cập từ máy bạn (qua mạng host-only): **80** app · **9090** Prometheus · **3001** Grafana · **8025** Mailpit.

## 4. Bố trí service trong stack

| Service | Image | Replica / mode | Ghim vào | Cổng publish | Volume |
|---|---|---|---|---|---|
| `frontend` | `ghcr.io/tynab/capstone-project-frontend:${IMAGE_TAG}` | 2 | trải 2 node | 80 | — |
| `backend` | `ghcr.io/tynab/capstone-project-backend:${IMAGE_TAG}` | 2 | trải 2 node | — | — |
| `mongo` | `mongo:6` | 1 | `node.role == worker` | — | `capstone_mongo_data` |
| `mongodb-exporter` | `percona/mongodb_exporter` | 1 | worker | — | — |
| `prometheus` | `prom/prometheus` | 1 | `node.role == manager` | 9090 | `capstone_prom_data` |
| `grafana` | `grafana/grafana` | 1 | manager | 3001→3000 | `capstone_grafana_data` |
| `mailpit` | `axllent/mailpit` | 1 | manager | 8025 | — |
| `blackbox-exporter` | `prom/blackbox-exporter` | 1 | manager | — | — |
| `node-exporter` | `prom/node-exporter` | `global` | mọi node | — | mount `/proc`, `/sys` |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` | `global` | mọi node | — | mount `/`, `/var/run/docker.sock` |

`backend` và `frontend` có `deploy.update_config` (`order: start-first`, `failure_action: rollback`) và `restart_policy`; các service còn lại có `restart_policy` (riêng `mongo`, export và các service ghim một node không cần update_config vì chỉ chạy 1 replica). Healthcheck mức container chỉ có ở 2 image tự build (`backend` gọi `/api/health`, `frontend` gọi `/`) — các image bên thứ ba (mongo, prometheus, grafana, exporter, mailpit) không khai báo healthcheck mà được giám sát từ bên ngoài: Prometheus `up`, blackbox `probe_success`, `mongodb_up`.

Mạng chung là overlay `capstone`; UFW được bật trên cả hai node với đúng các cổng cần thiết (22, 2377, 7946/tcp+udp, 4789/udp, 80, 9090, 3001, 8025, 9100, 8080) — thiếu 9100/8080 là mất 4/7 target Prometheus.

Ghi chú triển khai cho bảng trên:

- `backend`/`frontend` khai báo `placement.preferences: [{ spread: node.id }]` để 2 replica thực sự trải ra 2 node thay vì dồn một chỗ.
- `mongo` bật auth ngay từ lần khởi tạo bằng `MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD`; `MONGO_URI` của backend và `MONGODB_URI` của exporter dùng chính tài khoản đó với `authSource=admin`.
- `node-exporter`/`cAdvisor` chạy `mode: global` với bind mount (`/proc`, `/sys` cho node-exporter; `/`, `/var/run/docker.sock` cho cAdvisor). `docker stack deploy` không hỗ trợ `pid: host`/`privileged` — nếu bị từ chối thì bỏ các tuỳ chọn đó và **chấp nhận thiếu vài chỉ số chi tiết** (ví dụ số tiến trình trong container); không đánh đổi bằng cách bỏ giám sát 2 node.
- Cổng publish của service replicated dùng routing mesh của swarm, nên 2 replica `frontend` cùng publish cổng 80 là hợp lệ và rolling update không đụng nhau.

## 5. Cấu trúc thư mục và vai trò

```
infra/
├─ setup.cmd                  # entry point: cài công cụ còn thiếu → vagrant up → provision ansible
├─ setup.ps1                  # phần logic của setup.cmd (kiểm tra winget/VT-x/Hyper-V/firewall)
├─ destroy.cmd                # vagrant destroy -f (XOÁ luôn dữ liệu Mongo)
├─ Vagrantfile                # 2 VM, IP tĩnh, key lab, provisioner ansible_local gắn cho manager
├─ .ssh/                      # lab_key + lab_key.pub (gitignore)
└─ ansible/
   ├─ inventory.ini           # swarm_manager, swarm_worker
   ├─ site.yml                # play common → swarm_manager → swarm_worker
   ├─ group_vars/all.yml      # IP, tên stack, đường dẫn /opt/capstone
   └─ roles/
      ├─ common/              # apt, Docker Engine + compose plugin, python3, ufw, user
      ├─ swarm_manager/       # swarm init, network capstone, secrets, deploy.sh, stack lần đầu
      ├─ swarm_worker/        # swarm join (token lấy từ manager)
      ├─ runner/              # tải bản runner mới nhất qua GitHub Releases API, đăng ký,
      │                       # cài systemd service, chạy dưới user riêng `ghrunner` (trong group docker)
      └─ monitoring/          # prometheus.yml, Grafana provisioning + dashboard JSON
infra/stack/
├─ docker-stack.yml           # định nghĩa toàn bộ service ở bảng trên
├─ prometheus.yml             # scrape: node-exporter ×2, cadvisor ×2, mongodb-exporter, backend /api
├─ blackbox.yml               # probe http://192.168.56.10/ và http://backend:8000/api/health
└─ grafana/                   # datasource.yml + dashboards/capstone-overview.json
```

File trên Windows dùng CRLF sẽ làm script `.sh` và `site.yml` hỏng khi chạy trong Linux — repo đã có `.gitattributes`; phần `infra/` sẽ được khai báo `text eol=lf` cho `*.sh`, `*.yml`, `*.ini`, `Vagrantfile`.

## 6. Luồng chạy

### 6.1 Dựng hạ tầng (một lần, `infra/setup.cmd`)

1. Kiểm tra `winget`, `VBoxManage`, `vagrant`. Thiếu thì cài bằng winget (`Oracle.VirtualBox`, `Hashicorp.Vagrant`) và kiểm tra lại. Nếu VirtualBox cần khởi động lại máy → dừng, in hướng dẫn, không tự reboot.
2. Cảnh báo (không tự đổi) nếu Hyper-V/WSL2 đang bật; thử thêm firewall rule cho `192.168.56.0/24` các cổng 80/9090/3001/8025, không đủ quyền thì in lệnh chạy tay.
3. Sinh `infra/.ssh/lab_key` nếu chưa có.
4. Lấy runner registration token bằng `gh api` → truyền vào Vagrant qua biến môi trường `RUNNER_TOKEN` (rỗng thì bỏ qua bước đăng ký runner, phần còn lại vẫn chạy).
5. `vagrant up` (tạo + boot 2 VM) rồi `vagrant provision --provision-with ansible`.
6. Ansible: cài Docker 2 node → `swarm init` (manager) → `swarm join` (worker) → sinh secrets vào `/opt/capstone/.env` (600, dùng `lookup('password')` để **giữ nguyên qua các lần provision lại**) → deploy stack lần đầu bằng `/opt/capstone/deploy.sh` → cài runner.

Bước Ansible tách khỏi `vagrant up` là có chủ đích: Ansible phải chạy **sau khi cả hai VM đã lên**, mà Vagrant provision từng VM ngay khi VM đó boot xong.

### 6.2 Vòng đời phát triển (mỗi lần push)

| Job | Runner | Việc | Điều kiện |
|---|---|---|---|
| `test` | GitHub-hosted | `npm ci` backend/frontend/e2e, chạy `npm run test:api` (40 ca, cache binary mongod) | mọi push và PR |
| `build` | GitHub-hosted | build 2 image, push `sha-<7 ký tự>` + `latest` lên GHCR, cache layer qua GHA | chỉ `main` |

Tên image trên GHCR **phải viết thường toàn bộ** (`ghcr.io/tynab/capstone-project-backend`) — GitHub trả `Tynab` ở `github.repository`, nên workflow phải hạ chữ thường trước khi dùng, nếu không build sẽ đỏ ngay ở bước push.
| `deploy` | self-hosted `[swarm-manager]` | `docker login ghcr.io` bằng `GITHUB_TOKEN` (`packages: read`) → `/opt/capstone/deploy.sh sha-xxxx` → chờ service ổn định → `curl /api/health` | chỉ `main`, sau `build`, `concurrency` chặn chồng nhau, `timeout-minutes: 15` |

`/opt/capstone/deploy.sh <tag>` là script do Ansible đặt: `set -a; . /opt/capstone/.env; set +a`, export `IMAGE_TAG`, `docker stack deploy -c docker-stack.yml capstone`. Nguồn env tường minh thay vì dựa vào việc `docker stack deploy` có tự đọc `.env` hay không (hành vi này khác nhau giữa các bản Docker).

Thêm `workflow_dispatch` với input `image_tag`: chọn tag cũ và bấm chạy — đó là **nút rollback**.

## 7. Secrets và cấu hình

Sinh một lần bởi Ansible, lưu `/opt/capstone/.env` (quyền 600) trong VM manager — không có secret nào nằm trong repo hay trong GitHub Secrets.

| Biến | Nguồn | Ai đọc |
|---|---|---|
| `JWT_SECRET` | sinh ngẫu nhiên | backend |
| `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD` | sinh ngẫu nhiên | mongo, backend, mongodb-exporter |
| `GRAFANA_ADMIN_PASSWORD` | sinh ngẫu nhiên | grafana |
| `FRONTEND_URL` | `http://192.168.56.10` | backend (link reset trong mail) |
| `CORS_ORIGIN` | `http://192.168.56.10` | backend |
| `TRUST_PROXY` | `1` | backend — bắt buộc vì có nginx phía trước |
| `SMTP_HOST/PORT/SECURE` | `mailpit` / `1025` / `false` | backend |
| `IMAGE_TAG` | do job `deploy` truyền vào | `deploy.sh` |

Xem lại secret trong lab: `vagrant ssh manager -c 'sudo cat /opt/capstone/.env'` (script không in secret ra log).

## 8. Thay đổi mã ứng dụng (chỉ 3 nhóm)

1. **`GET /api/health`** — endpoint công khai trả `{status:'ok'}`; dùng cho healthcheck của swarm và cho blackbox-exporter. Không lộ thông tin nội bộ.
2. **SMTP đọc từ env** — `backend/services/mailService.js` và `backend/controllers/forgotPasswordController.js` dựng transport từ `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`; **khi `SMTP_HOST` trống thì giữ nguyên hành vi cũ** (`service: 'gmail'` + `GMAIL_*`), nên cấu hình Gmail hiện tại vẫn chạy. Điều kiện `hasCredentials()` mở rộng thành "có SMTP_HOST **hoặc** có GMAIL_*".
3. **Đóng gói** — `backend/Dockerfile` (2 stage, `node:20-slim`, user `node`, healthcheck gọi `/api/health`), `frontend/Dockerfile` (build `node:20-alpine` với `ARG REACT_APP_API_URL=/api`, chạy `nginx:alpine`), `frontend/nginx.conf` (SPA fallback, `location /api/ → backend:8000`, `X-Forwarded-For`).

Không sửa: reducer/context/component, guard bảo mật backend (kiểm kiểu, rate limit, `toSafeUser`, thứ tự validate trong `registerUser`), envelope API, `e2e/lib/stack.mjs`.

Kiểm thử kèm theo: thêm khẳng định cho `/api/health` vào `e2e/api.e2e.mjs` (39 → 40) và giữ 40/40 xanh; phần SMTP kiểm chứng end-to-end trong lab bằng Mailpit (xem mục 9, bước 5).

## 9. Kiểm chứng — định nghĩa "xong"

1. `vagrant status` → 2 VM `running`; qua `vagrant ssh manager`: `docker node ls` → 1 leader + 1 worker `Ready`.
2. `docker stack services capstone` → mọi service đủ replica, không service nào `0/x`.
3. `http://192.168.56.10` → app chạy; **F5 ở `/active` không 404**.
4. Đăng ký → thêm task → F5 → task còn nguyên (ghi thật xuống Mongo).
5. Quên mật khẩu → mail hiện ở `http://192.168.56.10:8025` → bấm link → đổi mật khẩu → đăng nhập bằng mật khẩu mới.
6. Grafana `:3001` → dashboard "Capstone overview" có dữ liệu: 2 node, container, Mongo, up của FE/BE.
7. `e2e`: `npm run test:api` → **40/40 PASS** (39 cũ + health).
8. Push một thay đổi nhỏ lên `main` → 3 job xanh → app đổi theo, không chạm tay vào VM.
9. `workflow_dispatch` với tag `sha` cũ → app quay về bản trước.
10. `vagrant provision --provision-with ansible` chạy lại → idempotent: không mất dữ liệu, không đổi secret.

## 10. Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|---|---|
| VirtualBox cần reboot sau khi cài driver | Script phát hiện, dừng, in hướng dẫn chạy lại; không tự reboot |
| Máy bật Hyper-V/WSL2 | Cảnh báo VirtualBox chạy qua WHPX sẽ chậm hơn; không tự tắt tính năng Windows |
| Windows Firewall chặn adapter host-only | Script thử thêm rule; không đủ quyền thì in lệnh chạy tay — chỗ duy nhất có thể phải làm thủ công |
| `gh` chưa đăng nhập / token hết hạn | Bỏ qua bước runner, phần còn lại vẫn xong, kèm hướng dẫn đăng ký lại |
| VM tắt → job `deploy` chờ vô hạn | `timeout-minutes: 15`; hết giờ thì đỏ kèm thông báo runner offline |
| `vagrant destroy` xoá dữ liệu Mongo | Ghi rõ trong README hạ tầng; hướng dẫn `mongodump` thủ công trước khi destroy |
| Deploy hỏng | Swarm `failure_action: rollback` + job đỏ + `docker service ps --no-trunc` trong log |
| `bcrypt` (native addon) lỗi trên alpine | Dùng `node:20-slim` cho backend |
| File Windows xuống Linux sai EOL | `.gitattributes` khai báo `text eol=lf` cho `infra/` |
| Runner self-hosted là điểm chết đơn | Job `deploy` chỉ xếp hàng khi VM tắt (không fail ngay) → `timeout-minutes` + hướng dẫn `infra\setup.cmd` để dựng lại; CI vẫn xanh cho các job `test`/`build` |

## 11. Vận hành thường gặp

| Việc | Lệnh |
|---|---|
| Dựng lại từ đầu | `infra\destroy.cmd` rồi `infra\setup.cmd` |
| Cập nhật cấu hình hạ tầng | sửa `infra/`, chạy `vagrant provision --provision-with ansible` |
| Xem log một service | `vagrant ssh manager -c "docker service logs -f capstone_backend"` |
| Deploy tay một tag | `vagrant ssh manager -c "sudo /opt/capstone/deploy.sh sha-xxxx"` |
| Lấy mật khẩu lab | `vagrant ssh manager -c "sudo cat /opt/capstone/.env"` |
