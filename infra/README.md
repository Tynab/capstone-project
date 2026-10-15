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
   │   ├─ node-exporter + cAdvisor (global)
   │   └─ GitHub self-hosted runner (systemd, nhãn swarm-manager)
   └─ VM swarm-worker · 192.168.56.11 · 4GB/2CPU
       ├─ docker swarm worker
       ├─ mongo + volume capstone_mongo_data · mongodb-exporter
       └─ node-exporter + cAdvisor (global)
```

Truy cập từ máy bạn: **80** app · **9090** Prometheus · **3001** Grafana · **8025** Mailpit.

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

```bash
# Lần đầu (cài thiếu gì tự cài, sẽ hiện UAC vài lần)
infra\setup.cmd

# Những lần sau (cập nhật cấu hình hạ tầng)
cd infra && vagrant provision --provision-with ansible

# Dựng lại từ đầu — XOÁ CẢ DỮ LIỆU MONGODB trong VM
infra\destroy.cmd
```

`setup.cmd` làm tuần tự: kiểm/cài VirtualBox + Vagrant → cảnh báo Hyper-V/VT-x →
thêm rule firewall cho mạng host-only → sinh khoá SSH lab (`infra/.ssh/lab_key`) →
lấy runner token bằng `gh` → `vagrant up` → `vagrant provision --provision-with ansible`.
Chạy lại nhiều lần vô hại.

## Vận hành

| Việc | Lệnh |
|---|---|
| Xem log một service | `cd infra && vagrant ssh manager -c "sudo docker service logs -f capstone_backend"` |
| Trạng thái stack | `vagrant ssh manager -c "sudo docker stack services capstone"` |
| Deploy tay một tag (rollback) | `vagrant ssh manager -c "sudo /opt/capstone/deploy.sh sha-abc1234"` |
| Lấy mật khẩu lab | `vagrant ssh manager -c "sudo cat /opt/capstone/.env"` |
| Đăng ký lại runner khi token cũ hết hạn | `$env:RUNNER_TOKEN = (gh api -X POST repos/Tynab/capstone-project/actions/runners/registration-token --jq .token); cd infra; vagrant provision --provision-with ansible` |

**Sao lưu MongoDB trước khi `destroy`:**

```bash
vagrant ssh manager -c 'sudo bash -c ". /opt/capstone/.env; docker exec \$(docker ps -q -f name=capstone_mongo) mongodump --archive --gzip -u \$MONGO_ROOT_USERNAME -p \$MONGO_ROOT_PASSWORD --authenticationDatabase admin > /tmp/backup.gz"'
vagrant ssh manager -c "sudo docker cp \$(vagrant ssh manager -c 'sudo docker ps -q -f name=capstone_mongo'):/tmp/backup.gz /tmp/backup.gz"
```

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
| Job `deploy` trên GitHub treo ở `queued` | Runner offline (VM tắt) | `gh api repos/Tynab/capstone-project/actions/runners`; dựng lại bằng `infra\setup.cmd`; job sẽ đỏ sau `timeout-minutes: 15` |
| F5 ở `/active` trả 404 | Thiếu SPA fallback trong nginx | Kiểm `frontend/nginx.conf` rồi build lại image |
| Job `deploy` lỗi `Permission denied` (exit 126) | `/opt/capstone` hoặc `.env` không cho user `ghrunner` đi qua/đọc | Role `app` đặt thư mục 0755 và `.env` 0640 group `docker`; kiểm bằng `sudo -u ghrunner sh -c '. /opt/capstone/.env'` |
| Runner không đăng ký được: `minimum runner version ... is now X` | GitHub chặn runner cũ đăng ký | Role `runner` để `runner_version` rỗng = tự lấy bản mới nhất; đừng ghim cứng số phiên bản |

## Kiểm chứng

Chạy sau mỗi lần đổi hạ tầng (mọi bước đều kiểm được bằng lệnh):

```bash
cd infra
vagrant status                                              # 2 VM running
vagrant ssh manager -c "sudo docker node ls"                # 1 Leader + 1 Ready
vagrant ssh manager -c "sudo docker stack services capstone" # 10 service đủ replica
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/active   # 200 (SPA fallback)
curl -s http://192.168.56.10/api/health                     # {"status":"ok"}
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | grep -c '"health":"up"'   # 7
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

- Secret sinh tự động, chỉ chữ và số, lưu `/opt/capstone/.env` (quyền 600) trong VM
  manager — không nằm trong repo, không nằm trong GitHub Secrets, không in ra log.
- Mongo bật auth với tài khoản `capstone`; exporter dùng cùng tài khoản đó.
- Cổng 9090/3001/8025 chỉ mở trên mạng host-only, không ra internet.
- `TRUST_PROXY=1` bắt buộc vì backend nằm sau nginx — thiếu nó thì rate limit
  đếm chung một IP cho mọi request.
