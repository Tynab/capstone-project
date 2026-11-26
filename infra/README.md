# Hạ tầng lab — Docker Swarm 2 node

Toàn bộ hạ tầng dựng bằng IaC: một lệnh trên Windows tạo 2 VM, cài Docker, khởi tạo
swarm, sinh secret và deploy stack. Không thao tác tay trong máy ảo.

## Sơ đồ

```
Windows 11 (D:\capstone-project)
│  infra\setup.cmd  → cài VirtualBox + Vagrant nếu thiếu → vagrant up → provision
│
└─ Vagrant (VirtualBox, host-only 192.168.56.0/24)
   ├─ VM swarm-manager · 192.168.56.10 · 4GB · 1 vCPU khi Windows bật Hyper-V, 2 nếu không
   │   ├─ docker swarm manager + control node Ansible (ansible_local)
   │   ├─ frontend(nginx:80) · backend · prometheus(:9090) · grafana(:3001)
   │   ├─ mailpit(:8025) · mongodb-exporter · blackbox-exporter
   │   ├─ portainer(:9000) + portainer-agent (global) · cloudflared (khi bật tunnel)
   │   ├─ node-exporter + cAdvisor (global)
   │   └─ GitHub self-hosted runner (systemd, nhãn swarm-manager)
   └─ VM swarm-worker · 192.168.56.11 · 4GB · cùng quy tắc vCPU
       ├─ docker swarm worker
       ├─ mongo + volume capstone_mongo_data · mongodb-exporter
       └─ node-exporter + cAdvisor (global)
```

Truy cập từ máy bạn: **80** app · **9000** Portainer · **9090** Prometheus · **3001** Grafana ·
**8025** Mailpit. Công khai (chỉ khi bật tunnel): **capstone.yamiannephilim.com** (app) và
**capstone-api.yamiannephilim.com** (API).

Stack có **13 service** khi bật tunnel, **12** khi không (xem mục Cloudflare Tunnel).

Sơ đồ tương tác (bấm vào từng node để đọc chi tiết): [kiến trúc hệ thống](../docs/diagrams/kien-truc-he-thong.html) ·
[quy trình giao hàng](../docs/diagrams/quy-trinh-giao-hang.html) ·
[luồng dữ liệu](../docs/diagrams/luong-du-lieu.html) ·
[chuỗi gọi API](../docs/diagrams/chuoi-goi-api.html) ·
[vòng đời tài khoản](../docs/diagrams/vong-doi-tai-khoan.html) ·
[mô hình dữ liệu](../docs/diagrams/mo-hinh-du-lieu.html) — danh mục và cách vẽ lại: [docs/diagrams/](../docs/diagrams/README.md).

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

# Dọn hạ tầng theo 3 mức độ (state / vm / full) — xem mục "Dọn dẹp" bên dưới
infra\destroy.cmd -Mode vm
```

Máy Windows khởi động lại thì VM **không** tự bật; phải chạy `start.cmd`. Điều dễ hiểu nhầm: khi
Windows tắt máy, VirtualBox **lưu trạng thái** (save state) các VM đang chạy chứ không tắt chúng —
log VM của chính máy này ghi `VBoxHeadless: WM_ENDSESSION: waiting for VM termination...` đúng lúc
Windows tắt, và mã nguồn VBoxHeadless (đọc ở nhánh `main`) gọi `SaveState` ở đường đó mà không đọc
cấu hình nào. Nên lần bật sau là **resume**, và resume có lúc rất lâu: đo thật 2026-11-20, manager
đứng hình **~28 phút** (journal trống tuyệt đối) rồi tự tỉnh, còn worker (cùng 33 ngày ở trạng thái
lưu) có SSH sau 28 giây; một lần lưu-rồi-resume thử lại ngay sau đó thì cả hai lên trong vài giây.
**Treo khi KHỞI ĐỘNG LẠNH — đã tìm ra nguyên nhân gốc và sửa (2026-11-25).** Trước khi sửa, manager kẹt ở
`Begin: Loading essential drivers ...` 4/7 lần boot lạnh, mỗi lần ~2,5–38 phút. Kernel log của **mọi** lần treo
dừng ở cùng một chỗ: module `raid6_pq` đang chạy benchmark chọn thuật toán (`raid6_choose_gen`: tắt preempt, quay
vòng AVX2 chờ `jiffies` nhảy) — `rcu_sched self-detected stall ... RIP: raid6_avx24_gen_syndrome`, `clocksource: Long
readout interval` dài đúng bằng thời gian treo, và dòng vô lý `raid6: avx2x4 gen() 45424276 MB/s` (lần boot bình
thường: ~18 000 MB/s ở giây 13). Máy này chạy VirtualBox qua Hyper-V (VBox.log: `HM: HMR3Init: Attempting fall back
to NEM: VT-x is not available`); ở chế độ NEM, vCPU quay vòng không VM-exit thì không nhận được ngắt timer, đồng hồ ảo
*virtual-sync* đứng yên (VBox.log: `TM: Giving up catch-up attempt at a <lag> ns`) nên vòng chờ `jiffies` không thoát.
`raid6_pq` bị kéo vào initramfs bởi `mdadm` (`conf/modules` nạp `raid456`) và `btrfs-progs` (`local-premount/btrfs`
nạp `btrfs`) — lab không dùng cả hai (root là ext4 trên LVM, `/proc/mdstat` trống). Role `common` giờ gỡ hai gói đó
và dựng lại initramfs. Sau khi sửa: **0/6** lần boot lạnh manager liên tiếp bị treo (SSH sau 60–85 s, VBox.log không
còn "Giving up catch-up"), cộng 2 lần `start.cmd` boot lạnh thật cả hai VM (exit 0 sau ~100 s) — log ở
`presentation/_tools/raw/thi-nghiem-sau-sua-raid6.log`.

**Lỗi timer của VirtualBox chạy qua Hyper-V — đã sửa bằng 1 vCPU (2026-11-25).** Benchmark `raid6_pq` chỉ là thứ
kích hoạt; lỗi thật là: VM 2 vCPU chạy qua NEM, một vCPU đang nghỉ (`hlt`) còn vCPU kia quay vòng không VM-exit thì
ngắt timer không tới, guest đứng hàng phút (đo được cả lúc đang chạy: 54 s lúc container khởi động; worker bị bỏ lại
một mình có lúc vài phút). Phép thử nhanh `presentation/_tools/thu-loi-timer-nem.mjs` (nạp `raid6_pq` lúc VM đang chạy):
2 vCPU **2/5** lần treo, mỗi lần 15–20 phút; đổi halt method của VirtualBox (`VBoxInternal/VM/HaltMethod`) chỉ làm nhẹ đi
(`old`: 2/13 lần khựng 27–40 s) hoặc không giúp (`method1`: 2/5); **1 vCPU: 0/40** (20 lần mỗi node), VBox.log không còn
"Giving up catch-up". Vì vậy Vagrantfile tự phát hiện hypervisor của Windows (WMI `HypervisorPresent`) và khi có thì
cấp **1 vCPU** cho mỗi VM; stack 13 service vẫn rảnh ~90% CPU, `deploy.sh` 39 s. Ép số khác bằng `VM_CPUS=<n>` trong
`infra/.env`. Tắt hypervisor Windows (`bcdedit /set hypervisorlaunchtype off`, quyền admin + khởi động lại) thì
VirtualBox dùng VT-x và Vagrantfile tự quay về 2 vCPU. Lần resume đứng hình 28 phút ngày 2026-11-20 (VBox.log:
`Giving up catch-up` 1 687 905 205 748 ns ≈ 28,1 phút) là cùng lỗi này khi VM còn 2 vCPU.

Bản `start.cmd` cũ chỉ gọi `vagrant up` nên hỏng đúng ca này: Vagrant resume
**tuần tự** và bỏ cuộc ở `boot_timeout` 900s → báo `Timed out while waiting for the machine to boot`
và **không bao giờ bật worker**.

`start.cmd` hiện làm:

1. Đọc trạng thái **từng** VM. VM đang lưu → resume ngay (`VBoxManage startvm`, không chặn); VM đang
   tắt → khởi động lạnh bằng `vagrant up <tên>` chạy **nền, mỗi VM một tiến trình** (để mount `/vagrant`;
   bản trước gọi tuần tự nên một VM kẹt là VM kia chờ hết 900s, và `vagrant up` hết `boot_timeout` làm
   script exit 1 dù VM sau đó có SSH — đã tái hiện bằng mock); VM đang chạy → giữ nguyên. Sau khi có SSH,
   script kiểm `/vagrant` đã mount chưa và nhắc `vagrant reload <tên>` nếu chưa (provision cần nó).
2. Chờ SSH của cả hai **song song**, tối đa 45 phút (`-WaitMinutes`), báo tiến độ mỗi phút. "Sẵn
   sàng" là sshd **trả banner** — chỉ mở được TCP thì chưa đủ, vì bộ chuyển NAT của VirtualBox luôn
   nhận kết nối ở phía host kể cả khi guest đang đứng hình.
3. Sau resume, đồng hồ guest còn ở ngày bị lưu (đo thật: lùi 33 ngày) → lệch quá 2 phút thì khởi
   động lại `systemd-timesyncd` để đồng bộ ngay. Swarm dùng TLS nên lệch giờ giữa hai node là hỏng.
4. Chờ app trả `/api/health` (tối đa 3 phút) — swarm giữ nguyên trạng thái trên đĩa nên các service
   tự lên lại, GitHub runner là systemd enabled nên cũng tự chạy. Sau **resume**, GitHub còn báo
   runner `offline` thêm vài phút: phiên long-poll cũ của nó đã chết trong lúc VM bị lưu, runner
   tự kết nối lại (đo thật: `√ Connected to GitHub` ~1,5 phút sau resume). Không cần làm gì.

Hết 45 phút mà VM vẫn chưa trả lời: VM **vẫn đang chạy**, chạy lại `start.cmd` là chờ tiếp (an toàn).
`start.cmd -ColdBoot` (có hỏi xác nhận) bỏ trạng thái lưu / tắt cứng VM chưa sẵn sàng rồi khởi động
lạnh — **tương đương rút điện**, MongoDB ở worker phải tự phục hồi từ journal — nên chỉ dùng khi
guest thật sự treo. Muốn lần sau không phải resume: trước khi tắt Windows chạy
`cd infra && vagrant halt` (tắt sạch — Vagrant chờ guest tắt tới 10 phút chứ không rút điện sau 60 s như mặc định), lần bật sau là khởi động lạnh.

`setup.cmd` làm tuần tự: kiểm/cài VirtualBox + Vagrant → cảnh báo Hyper-V/VT-x →
thêm rule firewall cho mạng host-only → sinh khoá SSH lab (`infra/.ssh/lab_key`) →
lấy runner token bằng `gh` → `vagrant up` → `vagrant provision --provision-with ansible`.
Chạy lại nhiều lần vô hại.

## Dọn dẹp (destroy.cmd)

`infra\destroy.cmd` dọn hạ tầng theo 3 mức độ, tự sao lưu MongoDB trước khi xoá
(ở Mode vm/full) và tự in checklist kiểm chứng sau khi xong. **Luôn chạy `-DryRun`
trước** mỗi lần dọn thật — chế độ đó chỉ in ra việc sẽ làm, không chạy lệnh nào.

```bat
infra\destroy.cmd -DryRun
infra\destroy.cmd -Mode state
infra\destroy.cmd -Mode vm
infra\destroy.cmd -Mode full -PurgeRepoFiles -KeepBox remove
```

| Mode | Làm gì | Giữ lại |
|---|---|---|
| `vm` (mặc định) | Xoá 2 VM (thu hồi dung lượng thật của 2 VM — `-DryRun` in số đo hiện tại; ngày 2026-11-25 là manager 15.6GB + worker 7.9GB), xoá `.vagrant/`, `vagrant global-status --prune`, gỡ đăng ký runner trên GitHub | Box `bento/ubuntu-22.04` (~811MB), file repo (`.ssh`, `.env`) |
| `state` | **GIỮ 2 VM**, dọn bên trong: `docker stack rm capstone`; xoá volume `capstone_*` + volume vô danh; `rm -rf /opt/capstone`; gỡ systemd unit runner + `/home/ghrunner/actions-runner`; `docker swarm leave --force` (worker trước, manager sau); xoá network rác `smoke-net` | VM, image docker |
| `full` | Như `vm`, cộng: `-PurgeRepoFiles` xoá `infra/.ssh/` + `infra/.env`, `-RemoveFirewallRule` gỡ rule `capstone-lab-hostonly`, `-KeepBox remove` xoá box | Không gì (toàn bộ) |

> Mode `state` **vẫn gỡ đăng ký runner trên GitHub** (giống `vm`/`full`): mọi mode đều làm runner
> ngừng tồn tại, để GitHub không giữ mãi một runner "offline" mồ côi. Muốn giữ lại thì thêm
> `-DeregisterRunner no` — chạy xong nhớ tắt/xoá runner đó trên GitHub bằng tay.

Tham số:

| Tham số | Ý nghĩa |
|---|---|
| `-Mode vm\|state\|full` | Mức độ dọn (mặc định `vm`) |
| `-DryRun` | Chỉ in ra việc sẽ làm, không chạy lệnh thật |
| `-Yes` | Bỏ qua mọi prompt xác nhận (script vẫn in rõ là đang bỏ qua) |
| `-KeepBox no` | (chỉ Mode `full`) xoá luôn box `bento/ubuntu-22.04` (~811MB). Mặc định **BẬT** (giữ box) |
| `-DeregisterRunner no` | Giữ runner `swarm-manager-1` đăng ký trên GitHub. Mặc định **BẬT** (gỡ đăng ký) |
| `-PurgeRepoFiles` | (chỉ Mode `full`) xoá cả `infra/.ssh/` (khoá lab) và `infra/.env` (token tunnel thật) |
| `-RemoveFirewallRule` | (chỉ Mode `full`) gỡ rule firewall `capstone-lab-hostonly` (hiện UAC) |
| `-SkipBackup` | Bỏ qua bước sao lưu MongoDB tự động |

Chú ý khi dùng:

- **Xác nhận:** script liệt kê hậu quả rồi bắt gõ đúng chữ `XOA` (Mode `state` cũng hỏi vì
  nó xoá dữ liệu Mongo). `-PurgeRepoFiles` và việc xoá box được hỏi xác nhận **riêng lần hai**.
- **Sao lưu Mongo tự động** (Mode `vm`/`full`, trừ khi `-SkipBackup`): mongodump chạy trong
  VM → `infra/backup-mongo-<ngày>.gz`, kiểm `gzip -t` trong VM rồi scp ra Windows. **Backup
  lỗi thì script DỪNG, không destroy.** Mode `state` **không** tự backup — nếu cần dữ liệu
  hãy chạy tay lệnh trong mục "Vận hành" trước.
- ⚠️ `-PurgeRepoFiles` xoá `infra/.env` (token Cloudflare thật). Trước khi dựng lại bằng
  `infra\setup.cmd` phải dán lại token tunnel (mục Cloudflare Tunnel) nếu muốn domain công
  khai hoạt động — `setup.cmd` chỉ tạo lại file từ mẫu đang để trống token.
- Script **không đụng**: adapter host-only của VirtualBox và DHCP server `192.168.56.0/24`
  (dùng chung, xoá có thể ảnh hưởng project khác), `~/.ssh/known_hosts`, dịch vụ nền
  VBoxSVC/VBoxSDS.
- Dựng lại từ đầu sau khi dọn: chạy `infra\setup.cmd` (tự cài thiếu, tạo VM, provision).

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
| Tắt script Cloudflare tự chèn vào HTML (JavaScript Detections — làm CSP chặt báo lỗi console) | `infra\cloudflare-jsd.cmd` xem trạng thái, `infra\cloudflare-jsd.cmd -Apply` để tắt. Chi tiết + lý do không có nút trên dashboard: mục "Bảo mật trong lab" |

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

**Sao lưu MongoDB trước khi `destroy`** — `destroy.ps1` (Mode vm/full) tự chạy bước này
và ghi kết quả về `infra/backup-mongo-<ngày>.gz`; lệnh dưới dành cho khi cần chạy tay
(cũng cần trước khi dọn Mode `state`, vốn không tự backup). Chạy từ Git Bash, file ghi
thẳng về máy Windows (KHÔNG ghi vào `/tmp` của VM: `destroy` xoá luôn, tưởng có backup mà mất):

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
| `Timed out while waiting for the machine to boot` khi **resume** (`Resuming suspended VM...`) | VM bị lưu trạng thái lúc Windows tắt máy; resume qua WHPX có lúc đứng hình rất lâu (đo thật ~28 phút) | Dùng `infra\start.cmd` bản hiện tại (resume từng VM, chờ tới 45 phút) — **đừng** gọi `vagrant up` trần. Xem mục "Quy trình" |
| `Timed out while waiting for the machine to boot` khi **khởi động lạnh** | Trước 2026-11-25 thường là VM kẹt ở `Loading essential drivers` (dòng ngay dưới — đã sửa); `vagrant up` hết `boot_timeout` 900s nhưng VM **vẫn chạy** | Dùng `infra\start.cmd` (chờ SSH tới 45 phút, không bỏ cuộc theo `vagrant up`); có SSH rồi mà `/vagrant` chưa mount thì `vagrant reload <tên>` trước khi provision |
| VM boot tới `Begin: Loading essential drivers ...` rồi đứng (không SSH, ping host-only không trả lời) | Benchmark của module `raid6_pq` (do `mdadm`/`btrfs-progs` kéo vào initramfs) quay vòng chờ `jiffies`; VirtualBox chạy qua Hyper-V (NEM) không đưa ngắt timer vào vCPU đang quay → treo tới khi VirtualBox bỏ đuổi đồng hồ. Xác nhận: `sudo journalctl -k -b -1 \| grep -E "raid6: avx2x4\|Long readout"` ra số MB/s vô lý | **Đã sửa** từ 2026-11-25: role `common` gỡ `mdadm` + `btrfs-progs` và dựng lại initramfs — chạy `vagrant provision --provision-with ansible` một lần trên lab cũ. Còn gặp thì `lsmod \| grep raid6_pq` phải rỗng |
| Guest khựng/đứng hàng phút lúc đang chạy (`soft lockup ... stuck for Ns`, `clocksource: Long readout interval` dài trong `dmesg`), tắt máy lâu | Lỗi timer của VirtualBox khi chạy qua **Hyper-V (NEM)** với **2 vCPU** — VBox.log có `TM: Giving up catch-up` | **Đã sửa** từ 2026-11-25: Vagrantfile cấp 1 vCPU khi phát hiện hypervisor Windows. Kiểm: `VBoxManage showvminfo capstone-manager --machinereadable \| findstr cpus` phải ra `cpus=1`; VM tạo trước đó nhận cấu hình mới ở lần `vagrant up`/`reload` kế tiếp. Lưu ý: "Long readout interval" ~1 s khi nạp module có benchmark là bình thường trên guest 1 CPU |
| Sau khi tắt/bật VM, một service đứng `0/1` (hay `1/2`) mà `docker service ps` chỉ thấy task cũ `Shutdown Complete`, không có lỗi | Bản stack trước 2026-11-25 đặt `restart_policy: condition: on-failure`: swarm chỉ thay task thoát mã **khác 0**, mà nginx/mailpit/mongod nhận SIGTERM lúc node tắt sạch đều thoát mã 0 | Đã đổi sang `condition: any` trong template — chạy `vagrant provision --provision-with ansible` để áp. Gỡ tạm: `sudo docker service update --force capstone_<tên>` |
| node-exporter log `level=ERROR ... collected metric "node_filesystem_*" ... mountpoint="/vagrant" ... was collected before with the same name and label values` ở MỌI lần scrape | `/vagrant` bị mount **chồng 2 lớp** (`findmnt -t vboxsf` ra 2 dòng): Vagrant 2.3+ tự ghi `/vagrant` vào `/etc/fstab` (khối `#VAGRANT-BEGIN`) nên systemd mount lúc boot, rồi `vagrant up` mount thêm lần nữa | **Đã sửa** 2026-11-25: Vagrantfile `config.vm.allow_fstab_modification = false` — lần `vagrant up` sau Vagrant tự gỡ khối fstab; từ lần boot kế tiếp chỉ còn 1 lớp. Gỡ tạm không cần reboot: `sudo umount /vagrant` một lần (bóc lớp trên) |
| `start.cmd` khởi động lạnh: một VM không lên, log `%TEMP%\capstone-up-<vm>.err.log` có `An unexpected process ... has tried to lock the machine 'capstone-<vm khác>' ... E_ACCESSDENIED` | Hai `vagrant up` song song: Vagrant của VM sau đọc `showvminfo` của MỌI VM (dò cổng trùng) đúng lúc VirtualBox đang khởi chạy VM trước → bị từ chối → `vagrant up` chết trước khi bật VM (còn kịp xoá port-forward SSH) | **Đã sửa** 2026-11-25 trong `start.ps1`: chờ VM trước `running` rồi mới `vagrant up` VM sau; `vagrant up` lỗi thì đọc VMState thật — VM không chạy thì thử lại 1 lần, vẫn hỏng thì báo `[LOI]` ngay (bản trước in "VM VAN CHAY" rồi chờ 45 phút); VM tắt mất port-forward vẫn bật được |
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
| Portainer đăng nhập được nhưng **Environments trống** ("No items available") | `-H` trỏ sai tên agent. Stack chính thức của Portainer đặt service tên `agent` nên ở đó là `tasks.agent`; lab đặt tên `portainer-agent` nên endpoint phải là `tasks.portainer-agent:9001` — viết sai thì tên không phân giải, Portainer vẫn chạy nhưng không có environment nào (đã gặp thật). **Portainer chỉ tạo environment ở lần khởi tạo ĐẦU TIÊN** — sửa `-H` thôi chưa đủ, phải cho nó khởi tạo lại | `docker service inspect capstone_portainer --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}'` xem `-H`; `docker run --rm --network capstone nginx:alpine nslookup tasks.portainer-agent` phải phân giải được. Khởi tạo lại: đổi tên volume (`portainer_state` → tên khác) trong stack rồi provision — admin được tạo lại từ secret với **đúng mật khẩu cũ**; volume `capstone_portainer_data` còn lại là rác, xoá được bằng `docker volume rm capstone_portainer_data` |
| Access log nginx toàn `10.0.x.x` | Request đi qua tunnel mà `real_ip` không chạy, hoặc ảnh frontend cũ chưa được CI deploy | Kiểm 3 dòng `set_real_ip_from` / `real_ip_header` / `real_ip_recursive` trong `frontend/nginx.conf` và ảnh đang chạy của service `frontend` |

## Kiểm chứng

Chạy sau mỗi lần đổi hạ tầng (mọi bước đều kiểm được bằng lệnh):

```bash
cd infra
vagrant status                                              # 2 VM running
vagrant ssh manager -c "sudo docker node ls"                # 1 Leader + 1 Ready
vagrant ssh manager -c "sudo docker stack services capstone" # 13 service đủ replica (12 nếu chưa bật tunnel)
curl -s http://192.168.56.10:9000/api/system/status                         # JSON Portainer: {"Version":"2.45.2",...}
# Portainer SỐNG chưa đủ — phải kiểm nó có nối được agent (endpoint đúng tên service):
vagrant ssh manager -c "sudo docker service inspect capstone_portainer --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}'"   # phải thấy tcp://tasks.portainer-agent:9001
vagrant ssh manager -c "sudo docker run --rm --network capstone nginx:alpine nslookup tasks.portainer-agent"                        # phải phân giải ra IP
curl -s https://capstone-api.yamiannephilim.com/api/health                  # {"status":"ok"} — xuyên tunnel
curl -s -o /dev/null -w "%{http_code}\n" https://capstone.yamiannephilim.com/active   # 200 (SPA fallback qua tunnel)
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/active   # 200 (SPA fallback)
curl -s http://192.168.56.10/api/health                     # {"status":"ok"}
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | grep -o '"health":"up"' | wc -l   # 7
# Cổng publish bị chặn theo nguồn (xem mục Bảo mật): luật phải nằm trong DOCKER-USER và
# phải ĐỨNG TRƯỚC chuỗi ufw trong FORWARD; bộ đếm cho thấy luật đang thực sự chạy.
vagrant ssh manager -c "sudo iptables -S DOCKER-USER | head -6"
vagrant ssh manager -c "sudo iptables -S FORWARD | head -3"     # -j DOCKER-USER trước -j ufw-before-*
vagrant ssh manager -c "sudo iptables -L DOCKER-USER -v -n | head -8"   # pkts > 0 ở nhánh 192.168.56.0/24
# Header bảo mật phải có trên HTML; CSP cũng phải có (kiểm ở origin, đừng qua Cloudflare
# vì Cloudflare có thể trả bản cache cũ):
curl -sI http://192.168.56.10/ | grep -iE "content-security-policy|x-frame-options|x-content-type|referrer-policy"
# Cloudflare có chèn thêm script nào vào HTML không (phải là 0; nếu >0 xem mục Bảo mật —
# chạy infra\cloudflare-jsd.cmd):
curl -s "https://capstone.yamiannephilim.com/?cb=$$" | grep -c "jsd/main.js"
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
- **Cổng publish chỉ cho mạng host-only — nhưng KHÔNG phải bằng UFW.** Đây là chỗ dễ hiểu sai nhất
  trong repo, đọc kỹ:
  - Với port mapping kiểu `ingress`, Docker DNAT gói tin ở bảng `nat` rồi đẩy qua chuỗi `FORWARD`,
    nơi nó chèn jump tới `DOCKER-USER` **trước** các chuỗi `ufw-*`. Gói tin không đi qua `INPUT`
    nên **UFW không thấy** — quy tắc `ufw allow from 192.168.56.0/24` cho cổng publish là vô hiệu.
    Đo thật trên máy: `iptables -S FORWARD` cho thấy `-A FORWARD -j DOCKER-USER` đứng trước
    `-j ufw-before-forward`, và `iptables -t nat -S DOCKER` cho thấy DNAT không kèm điều kiện nguồn.
  - Cách đúng và đang dùng: luật trong chuỗi **`DOCKER-USER`** do role `common` cài
    ([docker-user-rules.sh.j2](ansible/roles/common/templates/docker-user-rules.sh.j2)): cho qua
    traffic hồi đáp + các dải nội bộ (`192.168.56.0/24`, `10.0.0.0/8` của overlay,
    `172.16.0.0/12` của docker_gwbridge — thiếu hai dải sau là Prometheus mất 4 target), rồi **DROP**
    các cổng publish `80, 3001, 8025, 9000, 9090, 9100, 8080` từ mọi nguồn khác. Luật được nạp bởi
    unit systemd `capstone-docker-user-rules.service` chạy **sau** `docker.service` (không dùng
    `iptables-persistent`: file rules được nạp trước khi Docker tạo chuỗi `DOCKER-USER` nên sẽ lỗi).
  - **Thêm cổng publish mới thì phải thêm vào `lab_publish_ports`** trong `ansible/group_vars/all.yml`,
    nếu không cổng đó mở cho mọi nguồn.
  - Cách bind thẳng vào IP host-only (`host_ip` trong long syntax của `ports`) **không dùng được**:
    `docker stack deploy` từ chối với `additional property 'host_ip' is not allowed` (đã thử thật).
  - Riêng **cổng 80 để kiểu ingress** là cố ý: frontend chạy 2 replica trên cả 2 node nên không bind
    được vào một IP host-only. Bản thân app vốn công khai qua Cloudflare Tunnel, và tunnel +
    blackbox-exporter đi vào qua overlay (`http://frontend:80`) chứ không qua cổng publish này.
- **UFW vẫn được bật** trên cả 2 node cho các cổng KHÔNG publish (22, 2377, 7946, 4789 — SSH và
  các cổng swarm). Cổng 22 cố ý để mở mọi nguồn vì `vagrant ssh` đi qua adapter NAT của VirtualBox,
  không đi qua mạng host-only. `cloudflared` **không cần cổng nào** (chỉ kết nối ra ngoài; agent của
  Portainer cũng không cần vì nó nói chuyện với Portainer qua overlay network).
- **Header bảo mật ở `frontend/nginx.conf`**: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` và **CSP chặt** (`default-src 'self'`). CSP chặt được vì
  frontend tự host cả font Poppins lẫn hai ảnh minh hoạ — thêm bất kỳ nguồn ngoài nào là phải mở CSP.
  Lưu ý `add_header` của nginx **không thừa kế** xuống location đã có `add_header` riêng, nên hai
  location asset phải nhắc lại `nosniff`.
- **HSTS đặt ở tầng origin để kiểm chứng được, không trông vào dashboard**:
  `frontend/nginx.conf` gửi `Strict-Transport-Security: max-age=15552000; includeSubDomains`.
  Nghe qua thì lạ (nginx phục vụ HTTP, TLS do Cloudflare lo) nhưng đúng: header này chỉ có tác dụng
  khi đi kèm một response **HTTPS**, mà Cloudflare chuyển tiếp header của origin nên trình duyệt
  nhận đủ. Đo thật 2026-10-17: chỉ trông vào toggle dashboard thì hostname frontend KHÔNG có HSTS
  (còn hostname API có là nhờ helmet của backend — cùng giá trị này). Bật thêm ở dashboard
  (**SSL/TLS → Edge Certificates → HSTS**) cũng được, hai tầng không xung đột.
  `includeSubDomains` chỉ ảnh hưởng subdomain của chính `capstone.yamiannephilim.com` (không có cái
  nào), không đụng tới `portfolio.yamiannephilim.com` của site khác trong cùng zone.
- **JavaScript Detections của Cloudflare — chèn script vào HTML, và cách tắt nằm ở API chứ không
  ở dashboard** (`infra\cloudflare-jsd.cmd`, đo thật 2026-10-17). HTML ở edge dài hơn HTML ở origin
  đúng **938 byte**: Cloudflare chèn một `<script>` inline tạo `<iframe>` 1×1 ẩn rồi nạp
  `window.__CF$cv$params` + `/cdn-cgi/challenge-platform/scripts/jsd/main.js`. CSP chặt
  (`script-src 'self'`) chặn đúng đoạn inline đó, nên nó **không chạy được** mà chỉ để lại một dòng
  lỗi console ("Executing inline script violates ... script-src 'self'"); không vá được bằng CSP
  hash vì nội dung đổi theo từng request. Chỗ này dễ mất thời gian nên ghi rõ: **tắt "Bot fight
  mode" ở dashboard KHÔNG tắt nó** — Cloudflare tách JSD thành setting riêng `enable_js`, và tài
  liệu Cloudflare ghi với Bot Fight Mode thì JSD "automatically enabled and cannot be disabled",
  nên gói Free **không có** dòng "JS detections" nào để bấm (đã kiểm: toggle Bot fight mode ở trạng
  thái tắt, script vẫn được chèn với mọi User-Agent, không qua cache — `cf-cache-status: DYNAMIC`).
  Đường duy nhất là `PUT /zones/{zone_id}/bot_management` với `{"enable_js": false}`; đã đóng gói
  thành `infra\cloudflare-jsd.cmd` (mặc định chỉ đọc, `-Apply` mới đổi, token `CF_API_TOKEN` trong
  `infra/.env` đã bị gitignore). Nếu token chỉ có `Bot Management: Edit` thì **điền thêm
  `CF_ZONE_ID`** vào `infra/.env` (Zone ID nằm ở Overview → thẻ "API"): tra zone theo tên cần thêm
  quyền `Zone: Read`, và thiếu quyền đó Cloudflare **thường trả danh sách rỗng** (HTTP 200, không
  báo lỗi — dễ đọc sai thành "token sai"), còn một số tài khoản thì nhận **403 "... to list zones"**;
  cả hai cùng nguyên nhân. Đường `CF_ZONE_ID` không cần quyền nào. JSD là setting mức **zone** — nó chèn vào cả
  `portfolio.yamiannephilim.com`, nên tắt là tắt cho mọi hostname trong zone; đổi lại, trên zone này
  không còn consumer nào dùng tín hiệu JSD (Bot Fight Mode tắt, custom rules 0/5, managed rules chưa
  tạo) nên nó vốn chỉ là script fingerprint không ai tiêu thụ.
- `frontend/nginx.conf` tin `CF-Connecting-IP` từ mọi peer trong `10.0.0.0/8`, mà gateway của routing
  mesh cũng nằm trong dải đó — nên **trong mạng host-only**, một client tự gửi header này sẽ đổi được
  IP mà backend nhìn thấy (chỉ ảnh hưởng rate limit trong lab). Từ Internet thì không: đo thật
  2026-10-16, mọi request mang `CF-Connecting-IP` qua domain đều bị Cloudflare trả **403** và không
  tới được nginx. Khi **dựng lại cụm**: tạo overlay `capstone` với `--subnet` cố định trong role
  `swarm_manager` rồi đổi `set_real_ip_from` về đúng subnet đó.
- **`infra/.env` không phải chỗ cách ly secret khỏi VM**: file này (token tunnel, token API
  Cloudflare) nằm trong repo, mà Vagrantfile mount **nguyên repo** vào `/vagrant` của cả 2 VM để
  Ansible đọc playbook và để build image tại chỗ — nên `/vagrant/infra/.env` đọc được từ trong VM.
  Ansible KHÔNG chép nội dung file này vào `/opt/capstone/.env` (chỉ 2 biến được truyền qua
  `extra_vars`), nhưng đừng vì thế mà coi nó là nơi cất token kín với VM.
- Windows Firewall cần rule cho mạng host-only với các cổng 80, 9000, 9090, 3001, 8025 —
  `infra\setup.cmd` tự thêm (rule cũ thiếu cổng 9000 sẽ được tạo lại).
- `TRUST_PROXY=1` bắt buộc vì backend nằm sau nginx — thiếu nó thì rate limit
  đếm chung một IP cho mọi request.
