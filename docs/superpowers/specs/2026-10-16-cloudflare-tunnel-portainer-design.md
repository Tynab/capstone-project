# Thiết kế: Cloudflare Tunnel + Portainer cho lab Docker Swarm

> Bổ sung cho [2026-10-16-docker-swarm-capstone-design.md](2026-10-16-docker-swarm-capstone-design.md)
> (hạ tầng đã dựng xong và đang chạy). Spec này chỉ mô tả **phần thêm vào**; những gì đã có
> (2 node Vagrant, swarm, Mongo/BE/FE, Prometheus/Grafana, CICD, Ansible) không nhắc lại.

## 1. Mục tiêu và phạm vi

**Mục tiêu**

1. Ứng dụng ra Internet qua **Cloudflare Tunnel** trên domain thật `yamiannephilim.com`:
   `capstone.yamiannephilim.com` → frontend, `capstone-api.yamiannephilim.com` → backend.
2. Thêm **Portainer** để quản trị swarm, truy cập bằng `ip:port` từ máy Windows.
3. Giữ nguyên tắc của dự án: **mọi thứ bằng IaC hoặc script** — sau khi có token, không thao
   tác tay trong VM, kể cả ca thêm/đổi/gỡ tunnel.

**Trong phạm vi**

- 3 service mới trong stack: `portainer`, `portainer-agent`, `cloudflared`.
- Sửa nginx của frontend để backend vẫn thấy **IP thật của client** khi request đi qua tunnel
  (nếu không, rate limit gộp chung một bucket — xem mục 6).
- Sửa `deploy.sh` (`--prune`), `Vagrantfile` (đọc `infra/.env`), `setup.ps1` (firewall + tạo
  `infra/.env`), UFW (cổng 9000), tài liệu (README gốc, `infra/README.md`, `CLAUDE.md`).

**Ngoài phạm vi** (cố ý — YAGNI)

Cloudflare Access/Zero Trust policy cho hostname, TLS giữa cloudflared và service (traffic
trong overlay), metrics của cloudflared vào Prometheus (sẽ đổi số target 7 → 8 và phá mục
kiểm chứng cũ), đưa Portainer/Grafana ra Internet, backup dữ liệu Portainer, alerting.

## 2. Các quyết định kiến trúc

| Quyết định | Lý do |
|---|---|
| **Tunnel remotely-managed, tạo trên dashboard; connector là service trong stack** | Người dùng chọn cách này: ít mảnh nhất, không cài `cloudflared` trên Windows. Connector chạy trong chính stack nên vào thẳng overlay network, gọi được tên service `frontend`/`backend`, và **chỉ kết nối ra ngoài** (cổng 7844) nên không phải mở thêm cổng vào. |
| **Token đi qua `/opt/capstone/.env`, không dùng Docker secret** | Secret của swarm **bất biến**: `docker stack deploy` không cập nhật nội dung secret đã tồn tại, nên đổi token sẽ im lặng giữ token cũ ⇒ vi phạm nguyên tắc "mọi thứ tự động". Đi qua `.env` thì đổi token = sửa 1 dòng + provision, `deploy.sh` cập nhật service, task tự khởi động lại. Đây cũng là chỗ mọi secret khác của lab đang nằm. |
| **Portainer chạy kèm `portainer/agent` (`mode: global`)** | Không có agent thì chỉ thấy container/image/volume của node manager — mongo và replica backend/frontend trên worker sẽ biến mất khỏi UI. Có agent: thấy đủ cả 2 node. Không publish cổng 9001 ra host; Portainer nối agent qua overlay. |
| **Mật khẩu admin Portainer sinh tự động + Docker secret** | Cùng chuẩn với JWT/Mongo/Grafana: không có bước tạo user bằng tay trên UI. Docker secret là cách chính docs Portainer mô tả; bất biến của secret không gây hại vì Portainer **chỉ đọc file lúc tạo admin lần đầu**. |
| **`frontend/nginx.conf` lấy IP thật qua `real_ip`** | Bắt buộc, không phải tối ưu: nginx đang nối thêm IP của chính nó vào `X-Forwarded-For`, nên qua tunnel backend sẽ thấy IP container `cloudflared` cho **mọi** người dùng ⇒ 10 lần đăng nhập sai là khoá cả hệ thống. Chi tiết ở mục 6. |
| **File stack thành template Jinja `docker-stack.yml.j2`** | Swarm không hỗ trợ compose `profiles`, nên muốn "không có token thì không dựng cloudflared" thì phải cắt khối đó lúc render. |
| **Thêm `--prune` vào `deploy.sh`** | `docker stack deploy` mặc định **không xoá** service bị bỏ khỏi file. Có `--prune` thì gỡ tunnel = xoá token + provision, không phải gõ `docker service rm` bằng tay. |
| **Tunnel là tuỳ chọn** | Không có token thì stack vẫn dựng đủ 12 service còn lại (người chấm clone repo về không cần Cloudflare account). Có token thì 13 service. |
| **Frontend vẫn gọi `/api` tương đối** | Same-origin qua nginx ⇒ không CORS, không mixed content (trang chạy https gọi https), không phải build lại bundle. `capstone-api` là cửa vào trực tiếp cho backend, dùng để `curl`/demo. |
| **Không thêm `--trusted-origins` cho Portainer** | Portainer chỉ cần cờ đó khi chạy sau reverse proxy có domain riêng; ở đây truy cập thẳng `http://192.168.56.10:9000` (HTTP qua IP), không qua tunnel. |

## 3. Sơ đồ tổng thể

```
                       Internet (người dùng, curl, điện thoại)
                                     │ HTTPS
                                     ▼
                    Cloudflare edge  (DNS + TLS cho yamiannephilim.com)
                                     ▲
                                     │ tunnel: connector CHỦ ĐỘNG kết nối RA
                                     │ (7844 TCP/UDP) — KHÔNG mở cổng vào, không cần IP công khai
   ┌─────────────────────────────────┴──────────────────────────────────────┐
   │ Docker Swarm (host-only 192.168.56.0/24)                               │
   │                                                                        │
   │  capstone.yamiannephilim.com      capstone-api.yamiannephilim.com      │
   │            │                                  │                        │
   │            ▼                                  ▼                        │
   │   cloudflared (service, ghim manager, không publish cổng)              │
   │            │                                  │                        │
   │            ▼                                  ▼                        │
   │   frontend:80 (nginx, 2 replica)        backend:8000 (2 replica)       │
   │      ├─ SPA + /api proxy ─────────────────────┘                        │
   │      └─ real_ip: lấy IP thật từ CF-Connecting-IP                       │
   │                                                                        │
   │   portainer:9000 (ghim manager) ──tcp://tasks.agent:9001──▶ portainer-agent (global)
   │        └─ http://192.168.56.10:9000 cho máy Windows                     │
   └────────────────────────────────────────────────────────────────────────┘
```

Truy cập: app `http://192.168.56.10` · Portainer `http://192.168.56.10:9000` ·
Prometheus `:9090` · Grafana `:3001` · Mailpit `:8025` ·
công khai `https://capstone.yamiannephilim.com` và `https://capstone-api.yamiannephilim.com`.

## 4. Ba service thêm vào stack

```yaml
volumes:
  portainer_data:            # thêm vào khối volumes ở đầu file

secrets:
  portainer_admin:
    file: ./secrets/portainer_admin   # file do Ansible sinh, quyền 0640 group docker

services:
  # Quản trị swarm. Ghim manager, nối agent qua overlay (KHÔNG mount docker.sock ở đây:
  # có agent thì agent là bên giữ socket).
  portainer:
    image: portainer/portainer-ce:2.45.2
    command: -H tcp://tasks.agent:9001 --tlsskipverify
             --admin-password-file /run/secrets/portainer_admin
    volumes:
      - portainer_data:/data
    secrets:
      # target tường minh: mặc định swarm mount theo tên ĐÃ GHÉP STACK
      # (capstone_portainer_admin), không phải tên trong file.
      - source: portainer_admin
        target: portainer_admin
    ports:
      - target: 9000
        published: 9000
        mode: ingress
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == manager]
      restart_policy:
        condition: on-failure

  # Một container mỗi node: nối docker.sock của node đó vào cụm Portainer.
  portainer-agent:
    image: portainer/agent:2.45.2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/lib/docker/volumes:/var/lib/docker/volumes
    networks: [capstone]
    deploy:
      mode: global
      restart_policy:
        condition: on-failure

  # Chỉ render khi có token (xem mục 5). Không publish cổng nào.
  cloudflared:
    image: cloudflare/cloudflared:2026.10.1
    # Image đã có ENTRYPOINT ["cloudflared","--no-autoupdate"] -> không lặp lại cờ đó.
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == manager]
      restart_policy:
        condition: on-failure
```

Ingress khai trên dashboard (không nằm trong repo):

| Hostname | Service URL |
|---|---|
| `capstone.yamiannephilim.com` | `http://frontend:80` |
| `capstone-api.yamiannephilim.com` | `http://backend:8000` |

Cloudflare tự tạo 2 DNS record CNAME trỏ về `<tunnel-id>.cfargotunnel.com`. Tên service
`frontend`/`backend` phân giải được vì cloudflared nằm trong chính overlay network `capstone`.

## 5. Giá trị đã kiểm chứng (không đoán)

| Giá trị | Bằng chứng |
|---|---|
| `portainer/portainer-ce:2.45.2`, `portainer/agent:2.45.2` | Docker Hub API trả HTTP 200 cho cả hai; `portainer-ce:lts` cùng digest `sha256:0dff5781…` |
| `cloudflare/cloudflared:2026.10.1` | Docker Hub API HTTP 200; cùng digest với tag `latest` |
| `--admin-password-file` nhận **plaintext**, chỉ dùng **lần đầu** tạo admin, mật khẩu tối thiểu **12** ký tự | docs.portainer.io/advanced/cli + mã nguồn `api/cmd/portainer/main.go` (log "instance already has an administrator user defined, skipping admin password related flags") + issue #12823 (maintainer xác nhận plaintext) |
| File secret quyền `0444` không gây lỗi | Mã nguồn chỉ `os.ReadFile` rồi bcrypt-hash, không kiểm tra quyền file; docs Portainer có mục riêng mô tả dùng với Docker Secrets |
| Endpoint kiểm tra sống: `/api/system/status` (public) | `/api/status` đã deprecated trong openapi + handler có cảnh báo |
| `TUNNEL_TOKEN` (mọi bản) và `TUNNEL_TOKEN_FILE` (≥ `2025.4.0`) | developers.cloudflare.com/tunnel/reference/run-parameters |
| cloudflared cần **7844 TCP/UDP** đi ra | docs tunnel-with-firewall; UFW của lab chỉ chặn chiều vào nên không phải mở gì |
| Dashboard: **Networking → Tunnels → Create Tunnel**; thêm hostname ở tab **Routes → Add route → Published application**; DNS record tự tạo; Zero Trust Free $0 | docs get-started + create-remote-tunnel; terraform guide còn cho thấy service URL là tên service Docker (`http://httpbin:80`) |
| `docker stack deploy` **không** xoá service bị bỏ khỏi file; `--prune` mới xoá | help của CLI 27/28 (`Prune services that are no longer referenced`, mặc định tắt) + moby/moby#29898 |
| `nginx:alpine` có `--with-http_realip_module` | `docker run --rm nginx:alpine nginx -V` trong chính VM manager |

## 6. Chuỗi hop và IP thật của client

Chuỗi khi request đi qua tunnel:

```
browser → Cloudflare edge → cloudflared → nginx (frontend) → backend
                                         └─ hoặc → backend (đường capstone-api)
```

Cloudflare ghi `CF-Connecting-IP` (đúng 1 IP, và theo tài liệu Cloudflare nó chỉ được gửi trên
đường từ edge tới origin — trang lỗi 1000 còn liệt kê "request chứa header CF-Connecting-IP"
là một nguyên nhân lỗi, tức client tự gửi header này không đi lọt) và `X-Forwarded-For`.
cloudflared **không sửa** `X-Forwarded-For` (đã kiểm trong mã nguồn `ingress/origin_proxy.go`).

**Vấn đề:** `frontend/nginx.conf` đang đặt `X-Forwarded-For: $proxy_add_x_forwarded_for`, tức
nối thêm `$remote_addr` của nginx (là IP container `cloudflared`). Backend cấu hình
`TRUST_PROXY=1` nên `req.ip` = phần tử gần nhất không nằm trong hop được tin = **IP của
cloudflared** cho mọi người dùng ⇒ rate limit (đăng nhập 10/15 phút) gộp một bucket chung:
một người gõ sai 10 lần là tất cả cùng bị 429.

**Cách sửa** (thêm vào `frontend/nginx.conf`, trước `server {`):

```nginx
# Chỉ tin CF-Connecting-IP khi peer nằm trong overlay của swarm (cloudflared là container
# cùng overlay, IP 10.0.0.0/8). Client trong lab gửi header này sẽ bị bỏ qua.
set_real_ip_from 10.0.0.0/8;
real_ip_header CF-Connecting-IP;
real_ip_recursive off;
```

và trong `location /api/` đổi thành `proxy_set_header X-Forwarded-For $remote_addr;` — sau khi
`real_ip` viết lại, `$remote_addr` chính là IP thật; ghi đè hẳn header nên **không giả mạo
được** (khác `$proxy_add_x_forwarded_for` ở chỗ giữ lại phần client tự thêm).

Hai đường vào đều đúng với `TRUST_PROXY=1`:

- qua nginx: socket = nginx (1 hop được tin) → `req.ip` = phần tử phải nhất trong XFF = IP thật;
- gọi thẳng `capstone-api`: socket = cloudflared → `req.ip` = IP thật do Cloudflare ghi.

Trong lab (không qua Cloudflare) hành vi **không đổi**: không có peer nào thuộc `10.0.0.0/8`
theo nghĩa tin cậy của realip ⇒ `$remote_addr` vẫn là IP client như trước.

## 7. Biến môi trường và secret

| Biến | Nơi khai | Ai đọc | Ghi chú |
|---|---|---|---|
| `CLOUDFLARE_TUNNEL_TOKEN` | `infra/.env` (không commit) → Vagrantfile → extra_vars → `/opt/capstone/.env` | cloudflared (env) + `deploy.sh` | Rỗng = không dựng service cloudflared |
| `PORTAINER_ADMIN_PASSWORD` | sinh tự động (`lookup('password')`, 24 ký tự) | người đọc `/opt/capstone/.env` | Chỉ dùng ở lần tạo admin đầu tiên |
| `FRONTEND_URL` | Ansible | backend | `https://capstone.yamiannephilim.com` khi tunnel bật, ngược lại `http://192.168.56.10` |
| `CORS_ORIGIN` | Ansible | backend | Thêm origin công khai khi tunnel bật (giữ `http://192.168.56.10`) |
| `TRUST_PROXY` | Ansible | backend | Giữ `1` — đúng cho cả hai đường (mục 6) |

File secret `/opt/capstone/secrets/portainer_admin`: thư mục `secrets/` đổi `0700` → **`0750`
group `docker`**, file **`0640` group `docker`** — vì `docker stack deploy` của job CI (user
`ghrunner`) phải đọc được file để tạo secret (đã từng dính lỗi 126 đúng kiểu này).

## 8. Thay đổi trong repo

| File | Việc |
|---|---|
| `infra/stack/docker-stack.yml` → **`docker-stack.yml.j2`** | Thành template; bọc khối `cloudflared` bằng `{% if cloudflare_tunnel_enabled %}`. Các `${...}` compose giữ nguyên |
| `infra/ansible/roles/app/tasks/stack.yml` | Copy `stack/` → xoá bản `.j2` thô trong `/opt/capstone` → render template thành `/opt/capstone/docker-stack.yml` |
| `infra/ansible/roles/app/tasks/main.yml` | Sinh secret `portainer_admin`; sửa quyền `secrets/`; ghi thêm env; cờ `cloudflare_tunnel_enabled`; in hướng dẫn khi tunnel tắt |
| `infra/ansible/roles/app/templates/env.j2` | `CLOUDFLARE_TUNNEL_TOKEN`, `PORTAINER_ADMIN_PASSWORD`, `FRONTEND_URL`/`CORS_ORIGIN` theo điều kiện |
| `infra/ansible/roles/app/templates/deploy.sh.j2` | Thêm `--prune` |
| `infra/ansible/group_vars/all.yml` | `public_domain`, `frontend_host`, `api_host` |
| `infra/ansible/roles/common/tasks/main.yml` | UFW thêm `9000/tcp` |
| `infra/Vagrantfile` | Đọc `infra/.env`, truyền `cloudflare_tunnel_token` qua `extra_vars` |
| `infra/setup.ps1` | Tạo `infra/.env` từ mẫu nếu thiếu; firewall Windows thêm 9000 (rule cũ thiếu cổng thì tạo lại); in URL Portainer |
| **`infra/.env.example`** (mới) | Mẫu chỉ có `CLOUDFLARE_TUNNEL_TOKEN` |
| `.gitignore` | Ghi rõ `infra/.env` (đã được mẫu `.env` chặn, thêm cho tường minh) |
| `frontend/nginx.conf` | Khối `real_ip` + `X-Forwarded-For $remote_addr` (mục 6) — **phải build lại image frontend** |
| `infra/README.md`, `README.md`, `CLAUDE.md` | Sơ đồ, bảng thành phần, cách bật tunnel, Portainer, cổng UFW, xử lý sự cố, mục kiểm chứng |

Không đổi: `.github/workflows/ci-cd.yml` (deploy vẫn đi qua `deploy.sh`), `destroy.cmd`,
`backend/`.

## 9. Vòng đời tunnel và các ca vận hành

| Việc | Cách làm (không gõ lệnh tay) |
|---|---|
| Bật tunnel | Tạo tunnel + 2 route trên dashboard → dán token vào `infra/.env` → `infra\setup.cmd` (hoặc `cd infra && vagrant provision --provision-with ansible`) |
| Đổi token (rotate) | Sửa `infra/.env` → provision. `deploy.sh` cập nhật env của service, swarm thay task |
| Gỡ tunnel | Xoá token trong `infra/.env` → provision. `--prune` xoá service `capstone_cloudflared` |
| Deploy thường (CI) | Không đổi: job `deploy` gọi `/opt/capstone/deploy.sh <tag>` |
| Kiểm tra token sai | cloudflared thoát → service `0/1` → `deploy.sh` báo deploy **thất bại** (đúng: có thứ không lên thì deploy phải đỏ) |

Lưu ý vận hành: domain công khai **chỉ sống khi VM manager đang chạy**; token nằm trong lệnh
cài đặt trên dashboard, ai có token cũng chạy được tunnel nên không dán vào chat/log.

## 10. Kiểm chứng — định nghĩa "xong"

```bash
cd infra
vagrant ssh manager -c "sudo docker stack services capstone"   # 13 service đủ replica (12 nếu chưa có token)

# Portainer sống và đã tạo admin
curl -s http://192.168.56.10:9000/api/system/status            # JSON {Version, InstanceID}

# Tunnel: cả hai hostname công khai
curl -s https://capstone-api.yamiannephilim.com/api/health      # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://capstone.yamiannephilim.com/active   # 200 (SPA fallback)
curl -s https://capstone.yamiannephilim.com/api/health          # {"status":"ok"} qua nginx

# IP thật của client: 11 lần login sai với X-Forwarded-For GIẢ KHÁC NHAU mỗi lần
# -> phải ra 429 (nếu header giả tạo bucket mới thì limit đã bị vô hiệu)
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://capstone.yamiannephilim.com/api/user/login \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.9.$i" \
    -d '{"email":"khong-ton-tai@example.com","password":"sai-be-bet"}'
done; echo

# Không đổi so với trước
curl -s http://192.168.56.10/api/health                          # {"status":"ok"}
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | grep -c '"health":"up"'   # 7
vagrant provision --provision-with ansible                       # chạy LẦN HAI: changed=0
```

Bằng tay (không tự động hoá được): mở `http://192.168.56.10:9000` đăng nhập bằng mật khẩu
trong `/opt/capstone/.env`, thấy **2 node** và container của cả hai; đăng nhập app qua
`https://capstone.yamiannephilim.com`; F5 ở `/active` vẫn 200; luồng quên mật khẩu qua Mailpit
vẫn chạy và link trong mail trỏ về domain công khai.

## 11. Rủi ro và cách lùi

| Rủi ro | Cách lùi |
|---|---|
| Agent không nối được qua overlay (`tasks.agent:9001`) | Publish 9001 bằng routing mesh + UFW allow 9001 (đúng bản stack chính thức của Portainer). Kiểm bằng UI: nếu chỉ thấy node manager là agent chưa nối |
| `--prune` xoá nhầm service | Chỉ xoá service **không có trong file stack** của chính stack `capstone`; muốn chắc chắn thì xem diff của `docker stack services` trước/sau trong lần deploy đầu |
| Ảnh hưởng của `real_ip`: mọi request tới nginx từ `10.0.0.0/8` đều bị tin | `cloudflared` là container duy nhất trong overlay gọi nginx; nếu sau này thêm proxy khác trong overlay thì phải siết `set_real_ip_from` về đúng subnet |
| Token dán sai | Service `0/1` → `deploy.sh` đỏ; sửa `infra/.env` + provision, không cần đụng swarm |
| Mật khẩu Portainer sinh ra nhưng chưa dùng lần nào | Nếu xoá volume `portainer_data` mà secret vẫn còn, Portainer tạo lại admin với **đúng** mật khẩu đó (`--admin-password-file` được đọc lại khi chưa có user) |

## 12. Ngoài phạm vi (nhắc lại để không ai chờ đợi)

Cloudflare Access, WAF rules, rate limit ở tầng Cloudflare, TLS origin, đa connector (2 replica
cloudflared), Portainer Edge agent, backup/restore dữ liệu Portainer, đưa `mailpit`/`grafana`
ra Internet. Muốn thêm sau thì mỗi thứ là một spec riêng.
