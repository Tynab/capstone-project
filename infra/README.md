# Hạ tầng lab — Docker Swarm 2 node

Toàn bộ hạ tầng dựng bằng IaC: một lệnh trên Windows tạo 2 VM, cài Docker, khởi tạo
swarm, sinh secret và deploy stack. Không thao tác tay trong máy ảo.

## Sơ đồ

```
Windows 11 (D:\capstone-project)
│  infra\setup.cmd  → cài VirtualBox + Vagrant nếu thiếu → vagrant up → provision
│
└─ Vagrant (VirtualBox, host-only 192.168.56.0/24)
   ├─ VM swarm-manager · 192.168.56.10 · 4GB/2CPU
   │   ├─ docker swarm manager + control node Ansible (ansible_local)
   │   ├─ frontend(nginx:80) · backend · prometheus(:9090) · grafana(:3001)
   │   ├─ mailpit(:8025) · mongodb-exporter · blackbox-exporter
   │   ├─ portainer(:9000) + portainer-agent (global) · cloudflared (khi bật tunnel)
   │   ├─ node-exporter + cAdvisor (global)
   │   └─ GitHub self-hosted runner (systemd, nhãn swarm-manager)
   └─ VM swarm-worker · 192.168.56.11 · 4GB/2CPU
       ├─ docker swarm worker
       ├─ mongo + volume capstone_mongo_data · mongodb-exporter
       └─ node-exporter + cAdvisor (global)
```

Truy cập từ máy bạn: **80** app · **9000** Portainer · **9090** Prometheus · **3001** Grafana ·
**8025** Mailpit. Công khai (chỉ khi bật tunnel): **capstone.yamiannephilim.com** (app) và
**capstone-api.yamiannephilim.com** (API).

Stack có **13 service** khi bật tunnel, **12** khi không (xem mục Cloudflare Tunnel).

**Vì sao Ansible chạy trong VM manager chứ không trên Windows:** Ansible không chạy
native trên Windows; phương án WSL2 thêm một dependency lớn. Dùng provisioner
`ansible_local` của Vagrant thì manager vừa là control node vừa là node đầu tiên,
và chỉ cần đúng một lệnh `vagrant up`.

## Yêu cầu máy

- Windows 10/11, có `winget` (App Installer).
- Ảo hoá bật trong BIOS/UEFI. Nếu bật Hyper-V/WSL2 thì VirtualBox chạy qua WHPX —
  chậm hơn, và VM có thể boot lâu (đã nâng `boot_timeout` lên 900s cho việc này).
- Khoảng 20GB đĩa trống (box Ubuntu + 2 ổ đĩa VM).
- `gh` CLI đã đăng nhập nếu muốn tự đăng ký GitHub runner (không bắt buộc).

## Quy trình

> **Lưu ý về PATH và cách gọi lệnh:** trình cài Vagrant không thêm thư mục của nó vào PATH, nên gõ
> `vagrant ...` sẽ báo "không tìm thấy lệnh". Phải gọi bằng đường dẫn đầy đủ, và **cmd.exe với
> PowerShell viết khác nhau** (PowerShell cần call operator `&` và biến `$env:`):
>
> ```bat
> :: cmd.exe
> "%ProgramFiles%\Vagrant\bin\vagrant.exe" ssh manager -c "sudo cat /opt/capstone/.env"
> ```
>
> ```powershell
> # PowerShell (lỗi "Unexpected token" nếu thiếu dấu &)
> & "$env:ProgramFiles\Vagrant\bin\vagrant.exe" ssh manager -c "sudo cat /opt/capstone/.env"
> ```
>
> Hoặc đơn giản nhất: chạy `infra\start.cmd` — script tự dò đường dẫn, không phải gõ lệnh dài.

```bash
# Lần đầu (cài thiếu gì tự cài, sẽ hiện UAC vài lần)
infra\setup.cmd

# Sau khi tắt/mở lại máy Windows — chỉ BẬT LẠI 2 VM đã dựng (không cài, không provision)
infra\start.cmd

# Những lần sau (cập nhật cấu hình hạ tầng)
cd infra && vagrant provision --provision-with ansible

# Dựng lại từ đầu — XOÁ CẢ DỮ LIỆU MONGODB trong VM
infra\destroy.cmd
```

`start.cmd` chỉ chạy `vagrant up` rồi chờ app trả lời (tối đa 3 phút) — swarm giữ nguyên trạng
thái trên đĩa nên các service tự lên lại, GitHub runner là systemd enabled nên cũng tự chạy.
Máy Windows khởi động lại thì VM **không** tự bật; phải chạy script này (hoặc bật VirtualBox
cho từng VM bằng tay).

`setup.cmd` làm tuần tự: kiểm/cài VirtualBox + Vagrant → cảnh báo Hyper-V/VT-x →
thêm rule firewall cho mạng host-only → sinh khoá SSH lab (`infra/.ssh/lab_key`) →
lấy runner token bằng `gh` → `vagrant up` → `vagrant provision --provision-with ansible`.
Chạy lại nhiều lần vô hại.

## Cloudflare Tunnel (đưa app ra Internet)

Tunnel là **tuỳ chọn**: không có token thì stack vẫn dựng đủ 12 service còn lại. Khi bật, app ở
`https://capstone.yamiannephilim.com`, API ở `https://capstone-api.yamiannephilim.com`. Connector
**chủ động kết nối ra ngoài** (7844 TCP/UDP) nên không phải mở thêm cổng vào, và lab không cần IP
công khai.

⚠️ **Phải là tunnel RIÊNG của lab.** Một tunnel chia sẻ đúng một config cho mọi connector: nếu dán
token của tunnel đang phục vụ site khác (ví dụ `portfolio.yamiannephilim.com`), connector trong lab
thành replica thứ hai của tunnel đó, mà lab không với tới origin của site kia → site kia bị 502 lúc
có lúc không. Đã gặp thật ngày 2026-10-16.

Bật một lần (phần bấm trên dashboard không script hoá được):

1. Dashboard Cloudflare → domain `yamiannephilim.com` → **Networking → Tunnels** (giao diện mới nằm
   ở `one.dash.cloudflare.com` → **Networks → Tunnels**) → **Create Tunnel** → **Cloudflared** →
   tên `capstone`.
2. Ở bước "Install and run": **không chạy lệnh**, chỉ copy chuỗi `eyJ...` (token là một khối base64
   duy nhất, dài ~180 ký tự).
3. Tab **Routes** → **Add route** → **Published application**, khai 2 lần:

   | Subdomain | Domain | Service URL |
   |---|---|---|
   | `capstone` | `yamiannephilim.com` | `http://frontend:80` |
   | `capstone-api` | `yamiannephilim.com` | `http://backend:8000` |

   Type chọn **HTTP**; để trống `HTTP Host Header` và `Origin Server Name`. DNS record do Cloudflare
   tự tạo khi bấm Add route.
4. Dán token vào `infra/.env` (file này bị `.gitignore` chặn) rồi chạy lại `infra\setup.cmd` hoặc
   `cd infra && vagrant provision --provision-with ansible`.

| Việc | Cách làm |
|---|---|
| Đổi/rotate token | Sửa `infra/.env` → provision. `deploy.sh` cập nhật env của service và thay task |
| Gỡ tunnel | Xoá token trong `infra/.env` → provision. `deploy.sh --prune` xoá luôn service |
| Xem config Cloudflare gửi về | `vagrant ssh manager -c "sudo docker logs capstone_cloudflared"` — dòng `Updated to new configuration` liệt kê đúng các hostname đang route |
| Tìm log của app/connector | Replica có thể dồn về một node (spread chỉ là *preference*): xem chỗ thật bằng `sudo docker stack ps capstone --filter desired-state=running` rồi đọc log **trên cả hai node** |

## Portainer

`http://192.168.56.10:9000` — chỉ trong mạng host-only, **không** ra Internet. Đăng nhập `admin`
với `PORTAINER_ADMIN_PASSWORD` trong `/opt/capstone/.env`
(`vagrant ssh manager -c "sudo cat /opt/capstone/.env"`).

`portainer-agent` chạy `mode: global` (một container mỗi node) nên UI thấy được container/image/volume
của **cả hai** node; không có agent thì chỉ thấy của node manager. Mật khẩu admin sinh tự động và
**chỉ được đọc ở lần tạo admin đầu tiên** — xoá volume `capstone_portainer_data` thì Portainer tạo lại
admin với đúng mật khẩu đó.

## Vận hành

| Việc | Lệnh |
|---|---|
| Xem log một service | `cd infra && vagrant ssh manager -c "sudo docker service logs -f capstone_backend"` |
| Trạng thái stack | `vagrant ssh manager -c "sudo docker stack services capstone"` |
| Deploy tay một tag (rollback) | `vagrant ssh manager -c "sudo /opt/capstone/deploy.sh sha-abc1234"` |
| Provision có kéo ảnh về `:latest` không | **Có** — `deploy.sh` không truyền tag sẽ deploy `${BACKEND_REPO}:latest`; CI thì luôn ghim `sha-xxxx`. Muốn giữ đúng bản đang chạy thì truyền tag như dòng trên |
| Lấy mật khẩu lab (Grafana, Portainer, Mongo, JWT, token tunnel) | cmd: `"%ProgramFiles%\Vagrant\bin\vagrant.exe" ssh manager -c "sudo cat /opt/capstone/.env"` · PowerShell: `& "$env:ProgramFiles\Vagrant\bin\vagrant.exe" ssh manager -c "sudo cat /opt/capstone/.env"` |
| Đăng ký lại runner khi token cũ hết hạn | `$env:RUNNER_TOKEN = (gh api -X POST repos/Tynab/capstone-project/actions/runners/registration-token --jq .token); cd infra; vagrant provision --provision-with ansible` |

**Sao lưu MongoDB trước khi `destroy`** — chạy từ Git Bash, file ghi thẳng về máy
Windows (KHÔNG ghi vào `/tmp` của VM: `destroy` xoá luôn, tưởng có backup mà mất):

```bash
cd infra
vagrant ssh manager -c 'sudo bash -c ". /opt/capstone/.env; docker run --rm --network capstone mongo:6 mongodump --uri=\"\$MONGO_URI\" --archive --gzip"' > backup-mongo.gz
gzip -t backup-mongo.gz && echo "backup hop le, kich thuoc: $(du -h backup-mongo.gz | cut -f1)"
```

Chú ý **đừng** đi tìm container `capstone_mongo` trên manager để `docker exec`: service này bị
ghim vào **worker**, nên `docker ps` trên manager không thấy nó (đã gặp thật khi thử lệnh này).
Cách trên chạy một container `mongo:6` tạm trong overlay network và trỏ thẳng vào service `mongo`.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `vagrant up` lỗi `VERR_INTNET_FLT_IF_NOT_FOUND` | Adapter host-only của VirtualBox hỏng trạng thái (gặp thật trên VBox 7.2.20 + Win11): nó nằm ở cả danh sách host-only lẫn bridged | `setup.ps1` tự phát hiện và chạy `infra/fix-hostonly.ps1` rồi thử lại; chạy tay script đó nếu cần (cần UAC) |
| `Timed out while waiting for the machine to boot` | Máy chạy qua WHPX boot chậm, hoặc VM treo ở giai đoạn kernel load | `VBoxManage controlvm capstone-worker reset` rồi chạy lại; `boot_timeout` đã đặt 900s trong Vagrantfile |
| VM boot tới `Begin: Loading essential drivers ...` rồi đứng | Treo kernel khi khởi động nguội (không ổn định, đã gặp 2 lần) | `VBoxManage controlvm capstone-worker reset` — boot lại là qua |
| Worker không có IP `192.168.56.11` | Lần `up` đầu hết thời gian chờ nên bước "configure networks" của Vagrant không chạy | `vagrant reload worker`; hoặc ghi `/etc/netplan/50-vagrant.yaml` với `eth1: 192.168.56.11/24` rồi `netplan apply` |
| `docker swarm join` báo `certificate ... is not yet valid` | Đồng hồ hai VM lệch nhau (VM không có Guest Additions nên trôi giờ) | Role `common` đã bật NTP và chờ đồng bộ trước khi join; chạy lại provision |
| Node join với tên `vagrant` | Bước đặt hostname của Vagrant không chạy (lần `up` hết thời gian chờ) | Role `common` đặt hostname theo `lab_hostnames`; cho node rời rồi join lại: `docker swarm leave` rồi provision |
| Prometheus target `down` | Prometheus/target không cùng overlay network, hoặc exporter chưa lên ở node đó | `docker stack services capstone`, `docker service logs capstone_prometheus` |
| Service `0/1` hoặc `0/2` | Thiếu RAM/CPU, kéo image lỗi, hoặc constraint không khớp node | `docker service ps --no-trunc <service>` xem cột `ERROR` |
| Job `deploy` trên GitHub đứng ở `queued` mãi | Runner offline (VM tắt). **`timeout-minutes` KHÔNG cứu ca này** — nó chỉ đếm từ lúc job bắt đầu chạy, còn job đang chờ runner thì GitHub chỉ tự huỷ sau ~24h | `gh api repos/Tynab/capstone-project/actions/runners` xem runner; dựng lại VM bằng `infra\setup.cmd`, hoặc huỷ tay `gh run cancel <id>` |
| F5 ở `/active` trả 404 | Thiếu SPA fallback trong nginx | Kiểm `frontend/nginx.conf` rồi build lại image |
| Deploy báo lỗi "service KHÔNG chạy đúng ảnh được yêu cầu" | Swarm đã rollback: task mới bị coi là hỏng trước khi kịp healthy | Kiểm `docker service inspect <svc> --format '{{json .UpdateStatus}}'`; `update_config.monitor` phải LỚN HƠN `start-period` + `interval` của healthcheck (đang là 45s) |
| Job `deploy` lỗi `Permission denied` (exit 126) | `/opt/capstone` hoặc `.env` không cho user `ghrunner` đi qua/đọc | Role `app` đặt thư mục 0755 và `.env` 0640 group `docker`; kiểm bằng `sudo -u ghrunner sh -c '. /opt/capstone/.env'` |
| Runner không đăng ký được: `minimum runner version ... is now X` | GitHub chặn runner cũ đăng ký | Role `runner` để `runner_version` rỗng = tự lấy bản mới nhất; đừng ghim cứng số phiên bản |
| Domain công khai trả 502/1033 | Connector chưa chạy (VM manager tắt), **token sai**, hoặc route trên dashboard trỏ sai | `docker logs capstone_cloudflared`: token sai thì log có `ERR Register tunnel error ... "Failed to get tunnel"`; kiểm Service URL phải là `http://frontend:80` / `http://backend:8000` |
| Domain công khai chết mà `docker stack services` vẫn báo `cloudflared 1/1` và deploy vẫn xanh | **Token đúng định dạng nhưng sai** — cloudflared KHÔNG thoát, nó retry mãi (đo thật 2026-10-16). Chỉ token sai định dạng mới làm container thoát (`0/1`) | Xem log connector như dòng trên; sửa `infra/.env` rồi provision. Không healthcheck được: image distroless nên trong container không có `wget`/`curl` |
| Site khác trên cùng domain bị 502 lúc có lúc không | Dán token của tunnel đang phục vụ site đó → connector lab thành replica thứ hai, mà lab không với tới origin của site kia | Tạo tunnel RIÊNG cho lab (xem mục Cloudflare Tunnel); xoá token trong `infra/.env` rồi provision để gỡ connector ngay |
| Portainer `0/1` rồi restart liên tục | Không đọc được file secret, hoặc không nối được agent | `docker service logs capstone_portainer`; file `/opt/capstone/secrets/portainer_admin` phải là `0640 vagrant:docker` |
| Portainer UI chỉ thấy 1 node | `portainer-agent` không lên ở node kia | `docker service ps capstone_portainer-agent`; agent là service `global` nên phải `2/2` |
| Portainer đăng nhập được nhưng **Environments trống** ("No items available") | `-H` trỏ sai tên agent. Stack chính thức của Portainer đặt service tên `agent` nên ở đó là `tasks.agent`; lab đặt tên `portainer-agent` nên endpoint phải là `tasks.portainer-agent:9001` — viết sai thì tên không phân giải, Portainer vẫn chạy nhưng không có environment nào (đã gặp thật) | `docker service inspect capstone_portainer --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}'` xem `-H`; và `docker run --rm --network capstone nginx:alpine nslookup tasks.portainer-agent` phải phân giải được |
| Access log nginx toàn `10.0.x.x` | Request đi qua tunnel mà `real_ip` không chạy, hoặc ảnh frontend cũ chưa được CI deploy | Kiểm 3 dòng `set_real_ip_from` / `real_ip_header` / `real_ip_recursive` trong `frontend/nginx.conf` và ảnh đang chạy của service `frontend` |

## Kiểm chứng

Chạy sau mỗi lần đổi hạ tầng (mọi bước đều kiểm được bằng lệnh):

```bash
cd infra
vagrant status                                              # 2 VM running
vagrant ssh manager -c "sudo docker node ls"                # 1 Leader + 1 Ready
vagrant ssh manager -c "sudo docker stack services capstone" # 13 service đủ replica (12 nếu chưa bật tunnel)
curl -s http://192.168.56.10:9000/api/system/status                         # JSON Portainer: {"Version":"2.45.2",...}
curl -s https://capstone-api.yamiannephilim.com/api/health                  # {"status":"ok"} — xuyên tunnel
curl -s -o /dev/null -w "%{http_code}\n" https://capstone.yamiannephilim.com/active   # 200 (SPA fallback qua tunnel)
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/active   # 200 (SPA fallback)
curl -s http://192.168.56.10/api/health                     # {"status":"ok"}
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | grep -o '"health":"up"' | wc -l   # 7
vagrant provision --provision-with ansible                  # chạy LẦN HAI: phải changed=0
```

Bằng tay trên trình duyệt (không tự động hoá được):

1. Đăng ký → thêm task → **F5** → task còn nguyên.
2. Quên mật khẩu → mở Mailpit `:8025` thấy mail → bấm link → đổi mật khẩu → đăng nhập bằng mật khẩu mới.
3. Grafana `:3001` → dashboard "Capstone overview" có 7 panel đều có dữ liệu.

## Ghi chú về image trên GHCR

Package để **public** (`ghcr.io/tynab/capstone-project-backend`, `...-frontend`) vì cả
**hai** node đều phải kéo được image, mà job deploy chỉ đăng nhập được trên manager.

Muốn chuyển sang private:

1. `gh api -X PATCH /user/packages/container/<tên>/visibility -f visibility=private`
2. Thêm `--with-registry-auth` vào `docker stack deploy` trong `/opt/capstone/deploy.sh`
   (để credential được truyền cho các node khi kéo image).
3. Cho runner đăng nhập GHCR trước khi deploy (thêm bước `docker login` bằng
   `GITHUB_TOKEN` trong job `deploy`).

## Bảo mật trong lab

- Secret sinh tự động, chỉ chữ và số, lưu `/opt/capstone/.env` (quyền **0640**, group
  `docker`) trong VM manager — không nằm trong repo, không nằm trong GitHub Secrets,
  không in ra log. Group `docker` là để user `ghrunner` (job deploy của CI) đọc được;
  trên VM này group `docker` vốn tương đương quyền root nên không mở thêm mặt tấn công.
- Mongo bật auth với tài khoản `capstone`; exporter dùng cùng tài khoản đó.
- Cổng 9090/3001/8025 chỉ mở trên mạng host-only, không ra internet.
- **UFW được bật** trên cả 2 node, chỉ mở các cổng cần thiết (22, 2377, 7946, 4789, 80, 9000, 9090,
  3001, 8025, 9100, 8080). Thêm service publish cổng mới thì phải thêm cổng đó vào role `common`,
  nếu không Prometheus/truy cập sẽ mất. `cloudflared` **không cần cổng nào** (chỉ kết nối ra ngoài;
  agent của Portainer cũng không cần vì nó nói chuyện với Portainer qua overlay network).
- `frontend/nginx.conf` tin `CF-Connecting-IP` từ mọi peer trong `10.0.0.0/8`, mà gateway của routing
  mesh cũng nằm trong dải đó — nên **trong mạng host-only**, một client tự gửi header này sẽ đổi được
  IP mà backend nhìn thấy (chỉ ảnh hưởng rate limit trong lab). Từ Internet thì không: đo thật
  2026-10-16, mọi request mang `CF-Connecting-IP` qua domain đều bị Cloudflare trả **403** và không
  tới được nginx. Khi **dựng lại cụm**: tạo overlay `capstone` với `--subnet` cố định trong role
  `swarm_manager` rồi đổi `set_real_ip_from` về đúng subnet đó.
- Windows Firewall cần rule cho mạng host-only với các cổng 80, 9000, 9090, 3001, 8025 —
  `infra\setup.cmd` tự thêm (rule cũ thiếu cổng 9000 sẽ được tạo lại).
- `TRUST_PROXY=1` bắt buộc vì backend nằm sau nginx — thiếu nó thì rate limit
  đếm chung một IP cho mọi request.
