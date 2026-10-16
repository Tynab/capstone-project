# Cloudflare Tunnel + Portainer — kế hoạch thi công

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa app ra Internet qua Cloudflare Tunnel trên `yamiannephilim.com` và thêm Portainer
(kèm agent) để quản trị swarm — toàn bộ bằng IaC/script, không thao tác tay trong VM.

**Architecture:** 3 service mới nằm trong chính stack `capstone` (portainer + portainer-agent +
cloudflared). File stack chuyển thành template Jinja để cắt khối cloudflared khi chưa có token.
Token đi từ `infra/.env` (đã gitignore) → Vagrantfile → extra_vars → `/opt/capstone/.env`.
nginx của frontend dùng `real_ip` + `CF-Connecting-IP` để backend vẫn thấy IP thật của khách.
`deploy.sh` thêm `--prune` để gỡ tunnel không để lại service mồ côi.

**Tech Stack:** Vagrant 2 + VirtualBox, Ansible (ansible_local), Docker Swarm, Jinja2, nginx
(`ngx_http_realip_module`), cloudflared, Portainer CE 2.45.2.

**Spec:** [docs/superpowers/specs/2026-10-16-cloudflare-tunnel-portainer-design.md](../specs/2026-10-16-cloudflare-tunnel-portainer-design.md)

## Global Constraints

- **Không gõ lệnh tay để đổi trạng thái.** Mọi thay đổi phải đi qua `infra\setup.cmd` hoặc
  `cd infra && vagrant provision --provision-with ansible`. Lệnh `docker ...` chỉ được dùng để
  **kiểm chứng** (đọc trạng thái), không dùng để sửa.
- Máy Windows **không có Docker**: mọi lệnh docker chạy trong VM qua
  `cd infra && vagrant ssh manager -c "sudo docker ..."`.
- `vagrant` **không có trong PATH** của Git Bash — dùng
  `"/c/Program Files/Vagrant/bin/vagrant.exe"`. Luôn `cd /d/capstone-project` trước khi chạy.
- **Idempotent:** provision chạy **lần thứ hai** phải báo `changed=0`. Đây là điều kiện nghiệm thu
  của mọi task đụng vào Ansible.
- **Secret không bao giờ vào repo**: `infra/.env` phải bị `.gitignore` chặn; không in giá trị
  secret ra chat/log (chỉ in **tên biến**).
- **Tag image đã kiểm chứng, không đổi**: `portainer/portainer-ce:2.45.2`, `portainer/agent:2.45.2`,
  `cloudflare/cloudflared:2026.10.1`.
- **Tên miền**: `capstone.yamiannephilim.com` → `http://frontend:80`;
  `capstone-api.yamiannephilim.com` → `http://backend:8000`.
- **Không sửa**: `backend/`, `.github/workflows/ci-cd.yml`, `infra/destroy.cmd`.
- Comment/tài liệu **tiếng Việt có dấu**, kèm lý do "vì sao" khi hành vi không hiển nhiên.
  Commit subject viết **không dấu** theo nếp repo, kết thúc bằng trailer
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- `infra/setup.ps1` phải giữ **UTF-8 CÓ BOM** và chuỗi in ra console **không dấu** (console
  PowerShell 5.1 dùng codepage ibm850).

## Review Focus

Năm tình huống spec có nhắc nhưng không task nào tự kiểm — mỗi dòng dưới đây đã được gắn một
bước kiểm chứng ở task tương ứng:

1. **Token sai/hết hiệu lực** → cloudflared **không được hỏng trong im lặng**: log phải có lỗi xác
   thực, và nếu service rơi về `0/1` thì `deploy.sh` phải báo đỏ. (Task 4, bước 7)
2. **Giả mạo header để né rate limit** → 11 lần đăng nhập sai với `X-Forwarded-For` giả khác nhau
   vẫn phải chạm 429. (Task 5, bước 5)
3. **`--prune` xoá nhầm service đang cần** → deploy hai lần liên tiếp không đổi file thì danh
   sách service phải y nguyên. (Task 6, bước 5)
4. **Provision lại khi đã có dữ liệu** → mật khẩu Portainer và volume `portainer_data` không được
   đổi/mất. (Task 2, bước 7)
5. **`infra/.env` lọt vào git** khi thêm file mới. (Task 1, bước 6)

---

### Task 1: Đường đi của token — `infra/.env` → Vagrantfile → Ansible → `/opt/capstone/.env`

**Files:**
- Create: `infra/.env.example`
- Modify: `.gitignore` (mục `infra/`)
- Modify: `infra/Vagrantfile:12-13` (cạnh `RUNNER_TOKEN`) và `:68` (`extra_vars`)
- Modify: `infra/ansible/roles/app/tasks/main.yml` (thêm `set_fact` chuẩn hoá)
- Modify: `infra/ansible/roles/app/templates/env.j2` (thêm 1 dòng)

**Interfaces:**
- Consumes: không.
- Produces: biến Ansible `cloudflare_tunnel_token` (string, rỗng nếu chưa cấu hình) và
  `cloudflare_tunnel_enabled` (bool) — Task 3/4 dùng lại đúng hai tên này; dòng
  `CLOUDFLARE_TUNNEL_TOKEN` trong `/opt/capstone/.env` — Task 4 nội suy vào file stack.

- [ ] **Step 1: Tạo `infra/.env.example`**

```bash
# Token của Cloudflare Tunnel (tunnel kiểu "remotely-managed", tạo trên dashboard).
# Lấy ở: Cloudflare dashboard -> Networking -> Tunnels -> tunnel của bạn -> Add a replica
#        -> copy chuỗi "eyJ..." nằm trong lệnh cài đặt (ĐỪNG chạy lệnh đó).
# Bỏ trống = stack KHÔNG dựng service cloudflared; phần còn lại của lab chạy bình thường.
# File thật là infra/.env — đã bị .gitignore chặn, KHÔNG commit.
CLOUDFLARE_TUNNEL_TOKEN=
```

- [ ] **Step 2: Chặn `infra/.env` trong `.gitignore`**

Thêm ngay dưới dòng `infra/.ssh/` (mục "hạ tầng lab"):

```gitignore
# File .env của hạ tầng: chỉ chứa token Cloudflare Tunnel (mẫu ở infra/.env.example).
infra/.env
```

- [ ] **Step 3: Đọc token trong `infra/Vagrantfile`**

Thêm ngay dưới khối `RUNNER_TOKEN` (sau dòng `RUNNER_TOKEN = ENV.fetch("RUNNER_TOKEN", "")`):

```ruby
# Token Cloudflare đọc từ infra/.env (đã gitignore) chứ KHÔNG lấy từ biến môi trường:
# `vagrant provision` còn chạy tay nhiều lần sau này, biến môi trường sẽ mất và tunnel
# lặng lẽ biến mất khỏi stack. File thiếu = token rỗng = không dựng cloudflared.
INFRA_ENV_PATH = File.join(__dir__, ".env")
INFRA_ENV = if File.exist?(INFRA_ENV_PATH)
  File.readlines(INFRA_ENV_PATH, chomp: true)
      .map(&:strip)
      .reject { |line| line.empty? || line.start_with?("#") }
      .map { |line| line.split("=", 2) }
      .to_h
      .transform_values { |value| value.to_s.gsub(/\A"|"\z/, "") }
else
  {}
end
CLOUDFLARE_TUNNEL_TOKEN = INFRA_ENV.fetch("CLOUDFLARE_TUNNEL_TOKEN", "")
```

và sửa `extra_vars` của provisioner `ansible` (dòng 68) thành:

```ruby
      a.extra_vars = { runner_token: RUNNER_TOKEN, cloudflare_tunnel_token: CLOUDFLARE_TUNNEL_TOKEN }
```

- [ ] **Step 4: Chuẩn hoá biến trong role `app`**

Trong `infra/ansible/roles/app/tasks/main.yml`, thêm ngay **sau** task "Sinh secret (giữ nguyên nếu có)":

```yaml
# Token tunnel đến từ ngoài (infra/.env -> Vagrantfile -> extra_vars), không sinh tự động.
# Rỗng nghĩa là "không có tunnel": role vẫn chạy bình thường, chỉ bỏ service cloudflared.
- name: Chuẩn hoá token tunnel thành cờ bật/tắt
  set_fact:
    cloudflare_tunnel_token: "{{ cloudflare_tunnel_token | default('', true) }}"
    cloudflare_tunnel_enabled: "{{ (cloudflare_tunnel_token | default('', true) | length) > 0 }}"
```

- [ ] **Step 5: Ghi token vào `/opt/capstone/.env`**

Trong `infra/ansible/roles/app/templates/env.j2`, thêm ngay dưới dòng `JWT_SECRET=...`:

```
# Token Cloudflare Tunnel. Rỗng = không dựng service cloudflared (xem infra/.env.example).
# Token là chuỗi base64url (chữ, số, '-', '_', có thể có '=') nên vẫn an toàn khi bọc
# trong ngoặc kép như các biến khác — không chứa ", $ hay khoảng trắng.
CLOUDFLARE_TUNNEL_TOKEN="{{ cloudflare_tunnel_token }}"
```

Đồng thời sửa dòng đầu file (comment) cho đúng sự thật: giá trị trong file này **không chỉ** là
chữ và số, token Cloudflare là ngoại lệ đã kiểm chứng ở trên — giữ nguyên câu cảnh báo về
`set -a; . .env`.

- [ ] **Step 6: Chạy provision và kiểm chứng đường đi của token**

```bash
cd /d/capstone-project
git check-ignore -v infra/.env        # phải in ra dòng rule trong .gitignore (Review Focus 5)
cp infra/.env.example infra/.env       # file thật, KHÔNG commit
cd infra && "/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
```

Expected: provision xanh; trong output có dòng `cloudflare_tunnel_enabled` (Ansible in ra khi debug)
hoặc không có task nào failed.

```bash
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c 'sudo grep -c "^CLOUDFLARE_TUNNEL_TOKEN=" /opt/capstone/.env'
```

Expected: `1` (biến đã vào `.env`, giá trị rỗng).

- [ ] **Step 7: Provision lần hai để chắc idempotent**

Run: `cd /d/capstone-project/infra && "/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible`
Expected: dòng cuối có `changed=0` (lần này file `.env` đã giống hệt nên handler "deploy stack" không chạy).

- [ ] **Step 8: Commit**

```bash
cd /d/capstone-project
git add infra/.env.example infra/Vagrantfile infra/ansible/roles/app/tasks/main.yml infra/ansible/roles/app/templates/env.j2 .gitignore
git commit -m "feat(infra): doc token cloudflare tu infra/.env -> extra_vars -> /opt/capstone/.env

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Portainer server + agent (12 service)

**Files:**
- Modify: `infra/stack/docker-stack.yml` (thêm volume, secret, 2 service)
- Modify: `infra/ansible/roles/app/tasks/main.yml` (secret + quyền thư mục/file secret)
- Modify: `infra/ansible/roles/app/templates/env.j2` (thêm `PORTAINER_ADMIN_PASSWORD`)
- Modify: `infra/ansible/roles/common/tasks/main.yml` (UFW 9000)
- Modify: `infra/setup.ps1` (firewall Windows + in URL + tạo `infra/.env`)

**Interfaces:**
- Consumes: `app_dir`, `lab_manager_ip` từ `group_vars/all.yml` (đã có).
- Produces: service `capstone_portainer` (9000) + `capstone_portainer-agent` (global);
  file `/opt/capstone/secrets/portainer_admin` quyền `0640 vagrant:docker`;
  biến `.env` `PORTAINER_ADMIN_PASSWORD`. Task 8 kiểm chứng lại cả hai.

- [ ] **Step 1: Sinh mật khẩu admin Portainer**

Trong `infra/ansible/roles/app/tasks/main.yml`, sửa task "Sinh secret (giữ nguyên nếu có)" để thêm
dòng cuối (Portainer yêu cầu mật khẩu **>= 12 ký tự**, sinh 24 cho chắc):

```yaml
- name: Sinh secret (giữ nguyên nếu đã có)
  set_fact:
    jwt_secret: "{{ lookup('password', app_dir + '/secrets/jwt_secret chars=ascii_letters,digits length=48') }}"
    mongo_root_password: "{{ lookup('password', app_dir + '/secrets/mongo_root chars=ascii_letters,digits length=32') }}"
    grafana_admin_password: "{{ lookup('password', app_dir + '/secrets/grafana_admin chars=ascii_letters,digits length=24') }}"
    # Portainer từ chối mật khẩu < 12 ký tự; --admin-password-file đọc bản PLAINTEXT này.
    portainer_admin_password: "{{ lookup('password', app_dir + '/secrets/portainer_admin chars=ascii_letters,digits length=24') }}"
```

và sửa task "Tạo thư mục secrets" thành (thêm `group` + đổi `0700` → `0750`):

```yaml
# Secret nằm ngoài repo và ngoài GitHub: sinh tại chỗ.
# 0750 + group docker (không phải 0700): user ghrunner của job deploy CI phải ĐI QUA
# được thư mục này để `docker stack deploy` đọc file secret tạo secret trong swarm.
- name: Tạo thư mục secrets
  file:
    path: "{{ app_dir }}/secrets"
    state: directory
    owner: vagrant
    group: docker
    mode: "0750"
```

thêm task mới ngay sau đó:

```yaml
# lookup('password') tạo file 0600 của user vagrant; đổi sang 0640 group docker để
# `docker stack deploy` (chạy bằng vagrant hoặc ghrunner) đọc được. Nội dung không đổi
# qua các lần provision nên task này chỉ áp quyền.
- name: Đặt quyền cho file secret Portainer
  file:
    path: "{{ app_dir }}/secrets/portainer_admin"
    owner: vagrant
    group: docker
    mode: "0640"
  notify: deploy stack
```

- [ ] **Step 2: Thêm biến môi trường cho `.env`**

Trong `infra/ansible/roles/app/templates/env.j2`, thêm dưới dòng `GRAFANA_ADMIN_PASSWORD=...`:

```
PORTAINER_ADMIN_PASSWORD="{{ portainer_admin_password }}"
```

- [ ] **Step 3: Thêm 2 service vào stack**

Trong `infra/stack/docker-stack.yml`:

(a) thêm `portainer_data:` vào khối `volumes:` (sau `grafana_data:`),

(b) thêm khối `secrets:` ngay trước `services:`:

```yaml
secrets:
  portainer_admin:
    # File do Ansible sinh và đặt quyền 0640 group docker (xem role app).
    file: ./secrets/portainer_admin
```

(c) thêm 2 service vào cuối khối `services:` (trước khối `configs:`):

```yaml
  # ------------------------------- quản trị -------------------------------
  # UI + API Portainer. CHỈ mở trên mạng host-only (http://192.168.56.10:9000),
  # KHÔNG đưa ra Internet. Ghim manager.
  portainer:
    image: portainer/portainer-ce:2.45.2
    # -H ...: dùng agent (mount docker.sock nằm ở agent) nên bản thân service này
    # KHÔNG cần socket. --admin-password-file đọc bản plaintext, CHỈ có tác dụng ở
    # lần tạo admin đầu tiên; các lần sau Portainer ghi log "instance already has an
    # administrator user defined" rồi bỏ qua (đã đối chiếu mã nguồn 2.45.2).
    command:
      - -H
      - tcp://tasks.agent:9001
      - --tlsskipverify
      - --admin-password-file
      - /run/secrets/portainer_admin
    volumes:
      - portainer_data:/data
    secrets:
      # target tường minh: mặc định swarm mount theo tên ĐÃ GHÉP STACK
      # (capstone_portainer_admin) chứ không phải tên viết trong file này.
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

  # Một container mỗi node: đưa docker.sock + volume của node đó vào cụm Portainer.
  # Không có agent thì UI chỉ thấy container/image/volume của node manager (mongo và
  # replica backend/frontend nằm trên worker sẽ biến mất).
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
```

- [ ] **Step 4: Mở cổng 9000 trong UFW**

Trong `infra/ansible/roles/common/tasks/main.yml`, thêm vào cuối danh sách `loop` của task
"UFW — cho phép các cổng của lab":

```yaml
    - { port: "9000", proto: tcp }   # portainer (chỉ dùng trong mạng host-only)
```

- [ ] **Step 5: Firewall Windows + tạo `infra/.env` + in URL trong `setup.ps1`**

(a) Thay khối "== 3/6 Firewall cho mang host-only ==" bằng (chú ý: rule cũ tạo trước khi có
Portainer **thiếu cổng 9000**, kiểm tra "rule có tồn tại" là chưa đủ):

```powershell
Write-Host "== 3/7 Firewall cho mang host-only ==" -ForegroundColor Cyan
# Truy cập từ trình duyệt trên Windows vào 192.168.56.x đi qua adapter host-only,
# mà Windows Firewall thường coi mạng đó là "Public" và chặn vào.
$rule = "capstone-lab-hostonly"
$rulePorts = "80,9090,3001,8025,9000"
$ruleCmd = "netsh advfirewall firewall add rule name=$rule dir=in action=allow protocol=TCP localport=$rulePorts remoteip=192.168.56.0/24"
$show = (& netsh advfirewall firewall show rule name=$rule 2>&1 | Out-String)
$ruleExists = ($LASTEXITCODE -eq 0)
# Portainer thêm sau -> rule cũ (chỉ 80,9090,3001,8025) phải được tạo lại, nếu chỉ kiểm
# tra "rule có tồn tại" thì cổng 9000 vẫn bị chặn và trình duyệt không mở được.
if ((-not $ruleExists) -or ($show -notmatch "9000")) {
    if ($ruleExists) {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @("-NoProfile", "-Command", "netsh advfirewall firewall delete rule name=$rule")
    }
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @("-NoProfile", "-Command", $ruleCmd)
        Write-Host "Da them rule firewall '$rule' (cong: $rulePorts)."
    } catch {
        Write-Warning "Khong them duoc rule firewall. Neu trinh duyet khong mo duoc 192.168.56.10, chay tay (admin):"
        Write-Warning "  $ruleCmd"
    }
} else {
    Write-Host "Rule firewall '$rule' da du cong."
}
```

(b) Thêm bước tạo `infra/.env` **trước** bước dựng VM (đổi số thứ tự các bước còn lại thành `/7`):

```powershell
Write-Host "== 6/7 Cau hinh Cloudflare Tunnel (infra\.env) ==" -ForegroundColor Cyan
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $PSScriptRoot ".env.example") $envFile
    Write-Host "Da tao infra\.env tu mau (dang de trong token)."
}
if ((Get-Content $envFile -Raw) -match "CLOUDFLARE_TUNNEL_TOKEN=\s*$") {
    Write-Warning "Chua co CLOUDFLARE_TUNNEL_TOKEN -> stack se KHONG dung cloudflared."
    Write-Warning "Muon bat: mo https://dash.cloudflare.com -> Networking -> Tunnels -> Add a replica,"
    Write-Warning "copy chuoi eyJ... roi dan vao infra\.env, sau do chay lai script nay."
}
```

(c) Thêm cổng 9000 vào danh sách in cuối script:

```powershell
Write-Host "  Portainer  http://192.168.56.10:9000  (mat khau: PORTAINER_ADMIN_PASSWORD trong /opt/capstone/.env)"
```

- [ ] **Step 6: Provision và kiểm chứng Portainer sống**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone"
```

Expected: **12 service** đủ replica, trong đó có `capstone_portainer` (1/1) và
`capstone_portainer-agent` (2/2, mode global).

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.56.10:9000/api/system/status   # 200
curl -s http://192.168.56.10:9000/api/system/status                                     # {"Version":"2.45.2",...}
```

Expected: `200` và JSON có `"Version":"2.45.2"`.

Agent phải có mặt ở **cả hai** node (nó nối Portainer với docker.sock của từng node qua overlay):

```bash
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker ps --format '{{.Names}}' | grep -c portainer-agent"   # 1
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh worker  -c "sudo docker ps --format '{{.Names}}' | grep -c portainer-agent"   # 1
```

Expected: `1` và `1`. Nếu Portainer không nối được agent qua overlay (`tasks.agent:9001`), áp dụng
phương án lùi ở spec mục 11: publish cổng 9001 bằng routing mesh vào service `portainer-agent` và
thêm `{ port: "9001", proto: tcp }` vào UFW trong role `common`.

- [ ] **Step 7: Provision lần hai — không được đổi mật khẩu, không mất dữ liệu (Review Focus 4)**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo md5sum /opt/capstone/secrets/portainer_admin"
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible     # changed=0
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo md5sum /opt/capstone/secrets/portainer_admin"
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker volume ls | grep portainer_data"
```

Expected: `changed=0`; **hai mã md5 giống nhau** (mật khẩu không bị sinh lại — `lookup('password')`
ghi file ở lần chạy đầu rồi đọc lại); volume `capstone_portainer_data` còn nguyên.

- [ ] **Step 8: Commit**

```bash
cd /d/capstone-project
git add infra/stack/docker-stack.yml infra/ansible/roles/app/tasks/main.yml infra/ansible/roles/app/templates/env.j2 infra/ansible/roles/common/tasks/main.yml infra/setup.ps1
git commit -m "feat(infra): portainer + agent cho ca 2 node, UFW 9000, firewall Windows 9000

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Chuyển `docker-stack.yml` thành template Jinja (không đổi hành vi)

**Files:**
- Rename: `infra/stack/docker-stack.yml` → `infra/stack/docker-stack.yml.j2` (thêm 2 dòng comment)
- Modify: `infra/ansible/roles/app/tasks/stack.yml`

**Interfaces:**
- Consumes: `cloudflare_tunnel_enabled` (Task 1) — task này chưa dùng, Task 4 mới dùng.
- Produces: `/opt/capstone/docker-stack.yml` là bản **đã render** (deploy.sh đọc đúng đường dẫn này,
  không phải sửa `deploy.sh.j2`); không còn file `.j2` thô trong `/opt/capstone`.

- [ ] **Step 1: Đổi tên file và ghi rõ nó là template**

```bash
cd /d/capstone-project && git mv infra/stack/docker-stack.yml infra/stack/docker-stack.yml.j2
```

Sửa 2 dòng đầu của file thành:

```
# Stack của bài cuối khóa. Các biến ${...} được nội suy từ /opt/capstone/.env
# mà deploy.sh đã `source` trước khi gọi `docker stack deploy`.
# ĐÂY LÀ TEMPLATE Jinja: Ansible render thành /opt/capstone/docker-stack.yml. Sửa file
# này rồi provision, đừng sửa bản trong VM (lần provision sau ghi đè).
# (Chú thích không được chứa cặp ngoặc nhọn — Jinja sẽ hiểu là biểu thức.)
```

- [ ] **Step 2: Render template trong role `app`**

Thay toàn bộ `infra/ansible/roles/app/tasks/stack.yml` bằng:

```yaml
---
# Đẩy cấu hình giám sát (prometheus.yml, blackbox.yml, grafana/) vào /opt/capstone.
# docker-stack.yml KHÔNG copy thô mà render từ template ở bước dưới.
- name: Copy cấu hình giám sát
  copy:
    # playbook_dir là /vagrant/infra/ansible -> lên MỘT cấp là /vagrant/infra,
    # nên đường dẫn đúng là ../stack/ (không phải ../../stack/).
    src: "{{ playbook_dir }}/../stack/"
    dest: "{{ app_dir }}/"
    owner: vagrant
    mode: "0644"

# Bước copy ở trên kéo theo cả file .j2; nó không được dùng để deploy nên xoá đi
# cho khỏi lẫn với bản đã render.
- name: Xoá bản template thô trong /opt/capstone
  file:
    path: "{{ app_dir }}/docker-stack.yml.j2"
    state: absent

# deployment đọc /opt/capstone/docker-stack.yml (đã render). src là đường dẫn tuyệt
# đối tới repo: ansible_local chạy ngay trên manager nên đọc được /vagrant.
- name: Render docker-stack.yml từ template
  template:
    src: "{{ playbook_dir }}/../stack/docker-stack.yml.j2"
    dest: "{{ app_dir }}/docker-stack.yml"
    owner: vagrant
    mode: "0644"
  notify: deploy stack
```

- [ ] **Step 3: Provision và kiểm chứng bản render khớp bản cũ**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "ls -l /opt/capstone/docker-stack.yml*"
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "head -6 /opt/capstone/docker-stack.yml"
```

Expected: chỉ có `docker-stack.yml` (không còn `.j2`); 6 dòng đầu là comment của template rồi
`version: "3.8"`.

```bash
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone"
```

Expected: vẫn **12 service** đủ replica (hành vi không đổi).

- [ ] **Step 4: Provision lần hai — render phải ổn định**

Run: `"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible`
Expected: `changed=0` (template render cho ra nội dung y hệt ⇒ không trigger handler).

- [ ] **Step 5: Commit**

```bash
cd /d/capstone-project
git add infra/stack/ infra/ansible/roles/app/tasks/stack.yml
git commit -m "refactor(infra): docker-stack.yml thanh template Jinja, Ansible render trong /opt/capstone

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Service cloudflared + 2 route công khai

**Files:**
- Modify: `infra/stack/docker-stack.yml.j2` (khối `{% if cloudflare_tunnel_enabled %}`)
- Modify: `infra/ansible/group_vars/all.yml` (3 biến tên miền)
- Modify: `infra/ansible/roles/app/templates/env.j2` (`FRONTEND_URL` / `CORS_ORIGIN` theo điều kiện)
- Modify: `infra/ansible/roles/app/tasks/main.yml` (in hướng dẫn khi tunnel tắt)

**Interfaces:**
- Consumes: `cloudflare_tunnel_enabled`, `CLOUDFLARE_TUNNEL_TOKEN` trong `.env` (Task 1);
  `/opt/capstone/docker-stack.yml` là bản render (Task 3).
- Produces: service `capstone_cloudflared` (chỉ khi có token); `FRONTEND_URL` =
  `https://capstone.yamiannephilim.com` khi tunnel bật.

- [ ] **Step 1: Khai tên miền một chỗ**

Trong `infra/ansible/group_vars/all.yml`, thêm dưới `app_url`:

```yaml
# Tên miền công khai qua Cloudflare Tunnel. Đổi domain chỉ sửa 3 dòng này rồi
# provision (route trên dashboard vẫn phải khai lại cho khớp).
public_domain: yamiannephilim.com
frontend_host: "capstone.{{ public_domain }}"
api_host: "capstone-api.{{ public_domain }}"
```

- [ ] **Step 2: Thêm service cloudflared vào template**

Trong `infra/stack/docker-stack.yml.j2`, chèn **cuối khối `services:`** (ngay trước khối `configs:`
nếu có, sau service `cadvisor`):

```
{% if cloudflare_tunnel_enabled %}
  # Connector của Cloudflare Tunnel. CHỦ ĐỘNG kết nối ra ngoài (7844 TCP/UDP) nên
  # không publish cổng nào và không cần mở thêm gì trên UFW. Nằm trong overlay
  # capstone nên phân giải được tên service `frontend` / `backend` mà route trên
  # dashboard trỏ tới. Token lấy từ .env (đổi token = sửa infra/.env + provision).
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
{% endif %}
```

- [ ] **Step 3: `FRONTEND_URL` / `CORS_ORIGIN` theo trạng thái tunnel**

Trong `infra/ansible/roles/app/templates/env.j2`, thay 2 dòng `FRONTEND_URL=...` và `CORS_ORIGIN=...` bằng:

```
{% if cloudflare_tunnel_enabled %}
# Tunnel đang bật -> link reset trong mail trỏ về domain công khai.
FRONTEND_URL="https://{{ frontend_host }}"
# Giữ cả origin trong lab để test nội bộ vẫn chạy.
CORS_ORIGIN="{{ app_url }},https://{{ frontend_host }}"
{% else %}
FRONTEND_URL="{{ app_url }}"
CORS_ORIGIN="{{ app_url }}"
{% endif %}
```

- [ ] **Step 4: In hướng dẫn khi tunnel tắt**

Trong `infra/ansible/roles/app/tasks/main.yml`, thêm task cuối file (sau `include_tasks: stack.yml`):

```yaml
# Không có token thì stack vẫn đủ phần còn lại; in cách bật để không ai phải đi tìm.
- name: Nhắc cách bật Cloudflare Tunnel
  debug:
    msg: >-
      Chưa có CLOUDFLARE_TUNNEL_TOKEN (infra/.env) -> KHÔNG dựng service cloudflared.
      Muốn bật: tạo tunnel trên Cloudflare dashboard (Networking > Tunnels > Create Tunnel),
      thêm 2 route Published application trỏ về http://frontend:80 và http://backend:8000,
      dán token "eyJ..." vào infra/.env rồi chạy lại provision.
  when: not cloudflare_tunnel_enabled
```

- [ ] **Step 5: Tạo tunnel trên dashboard và dán token (việc của con người — không script hoá được)**

1. Mở dashboard Cloudflare → chọn domain `yamiannephilim.com` → menu **Networking → Tunnels**
   (nếu không thấy mục này, vào `one.dash.cloudflare.com` → **Networks → Tunnels** — Cloudflare
   đang đổi dần tên menu).
2. **Create Tunnel** → chọn **Cloudflared** → tên `capstone` → **Save tunnel**.
3. Ở bước "Install and run", **đừng chạy lệnh nào** — copy chuỗi `eyJ...` nằm trong lệnh cài đặt.
4. Sang tab **Routes** → **Add route** → **Published application**:
   - Subdomain `capstone`, Domain `yamiannephilim.com`, Service URL `http://frontend:80` → Add route
   - Lặp lại: Subdomain `capstone-api`, Service URL `http://backend:8000` → Add route
   (DNS record CNAME do Cloudflare tự tạo, không phải thêm tay. `HTTP Host Header` và
   `Origin Server Name` để trống.)
5. Dán token vào `infra/.env`:

```bash
# Sửa dòng này trong infra/.env, chỉ dán phần token, KHÔNG dán cả lệnh:
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

- [ ] **Step 6: Provision và kiểm chứng tunnel lên**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone"
```

Expected: **13 service** đủ replica, có `capstone_cloudflared` (1/1).

```bash
curl -s https://capstone-api.yamiannephilim.com/api/health            # {"status":"ok"}
curl -s https://capstone.yamiannephilim.com/api/health                # {"status":"ok"} qua nginx
curl -s -o /dev/null -w '%{http_code}\n' https://capstone.yamiannephilim.com/active   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://capstone.yamiannephilim.com/         # 200
```

Expected: đúng như trên. Nếu 502/1033: xem `sudo docker service logs capstone_cloudflared`.

- [ ] **Step 7: Token sai thì KHÔNG được im lặng (Review Focus 1)**

```bash
cd /d/capstone-project
cp infra/.env /tmp/env-backup
# Token rác nhưng đúng định dạng (base64 của {"a":"SAI_TOKEN"}) -> Cloudflare sẽ từ chối.
sed -i 's|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiU0FJX1RPS0VOIn0=|' infra/.env
cd infra && "/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone --format '{{.Name}} {{.Replicas}}' | grep cloudflared"
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker service logs --tail 20 capstone_cloudflared 2>&1 | tail -5"
```

Expected: log của cloudflared có **lỗi xác thực** (`Unauthorized` / `Failed to ... token`) — hỏng
phải ồn ào, không im lặng. (Nếu `docker service logs` treo, đọc log container cục bộ:
`sudo docker logs --tail 20 $(sudo docker ps -q -f name=capstone_cloudflared)`.)

Kết luận theo **đúng hành vi đo được**, không theo suy đoán:

- Service ở `0/1` → `deploy.sh` phải thoát mã 1. Kiểm:
  `vagrant ssh manager -c "sudo /opt/capstone/deploy.sh"; echo "exit: $?"` → expected `exit: 1`.
- Cloudflared **retry giữ container sống** (hợp lý với connector) → deploy vẫn xanh. Khi đó phải
  **sửa câu tương ứng trong spec mục 9** cho khớp thực tế, vì spec đang viết "cloudflared thoát ⇒
  0/1 ⇒ deploy đỏ" như một suy luận chứ chưa phải điều đã đo.

Trả lại token thật:

```bash
cd /d/capstone-project && cp /tmp/env-backup infra/.env && cd infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
curl -s https://capstone-api.yamiannephilim.com/api/health    # {"status":"ok"} — đã trở lại
```

- [ ] **Step 8: Commit**

```bash
cd /d/capstone-project
git add infra/stack/docker-stack.yml.j2 infra/ansible/group_vars/all.yml infra/ansible/roles/app/templates/env.j2 infra/ansible/roles/app/tasks/main.yml
git commit -m "feat(infra): cloudflared trong stack, FRONTEND_URL/CORS theo trang thai tunnel

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: nginx giữ IP thật của khách khi request đi qua tunnel

**Files:**
- Modify: `frontend/nginx.conf` (khối `real_ip` + đổi `X-Forwarded-For`)

**Interfaces:**
- Consumes: tunnel đã chạy (Task 4) — cần request thật đi qua tunnel để đo.
- Produces: ảnh frontend mới (CI build từ `main`) với `X-Forwarded-For` = IP thật;
  task 8 kiểm chứng lại bằng access log.

- [ ] **Step 1: Đo trạng thái SAI hiện tại (RED) — access log thấy IP của hạ tầng, không phải IP bạn**

```bash
curl -s -o /dev/null https://capstone.yamiannephilim.com/
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c 'sudo docker logs --tail 30 $(sudo docker ps -q -f name=capstone_frontend | head -1) 2>&1 | grep "GET / HTTP" | tail -3'
```

Expected (RED): dòng log bắt đầu bằng một địa chỉ **nội bộ** — `10.0.0.x` (IP container
`cloudflared` trong overlay, hoặc `10.0.0.2` của routing mesh), **không phải** IP công khai của
kết nối Internet của bạn.

- [ ] **Step 2: Sửa `frontend/nginx.conf` — lấy IP thật qua `real_ip`**

Chèn ngay sau dòng `index index.html;`:

```nginx
    # IP thật của khách khi request đi qua Cloudflare Tunnel.
    # Chỉ tin CF-Connecting-IP khi peer nằm trong dải overlay của swarm (10.0.0.0/8 —
    # cloudflared là container cùng overlay). Cloudflare chính là bên ghi header này,
    # client tự gửi header thì Cloudflare không chuyển tiếp nguyên trạng.
    # Xem docs/superpowers/specs/2026-10-16-cloudflare-tunnel-portainer-design.md mục 6.
    set_real_ip_from 10.0.0.0/8;
    real_ip_header CF-Connecting-IP;
    real_ip_recursive off;
```

và trong `location /api/`, đổi dòng proxy header:

```nginx
        # Ghi ĐÈ hẳn XFF bằng $remote_addr (sau real_ip chính là IP khách).
        # $proxy_add_x_forwarded_for sẽ NỐI THÊM IP của chính nginx, làm backend
        # (TRUST_PROXY=1) tưởng mọi request đến từ container cloudflared -> rate
        # limit gộp một bucket cho tất cả người dùng Internet.
        proxy_set_header X-Forwarded-For $remote_addr;
```

- [ ] **Step 3: Commit + push để CI build ảnh frontend mới**

```bash
cd /d/capstone-project
git add frontend/nginx.conf
git commit -m "fix(frontend): nginx giu IP that cua khach qua cloudflare tunnel (real_ip)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 4: Theo dõi pipeline và chờ deploy xong**

```bash
gh run list --limit 3
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')   # nếu bị chặn thì dùng: gh run view <id>
```

Expected: job `test` xanh → `build` đẩy ảnh `sha-xxxx` → `deploy` chạy trên runner trong VM và
`deploy.sh` báo thành công. Nếu runner offline: `cd infra && "/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo systemctl status actions.runner.*"`.

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone --format '{{.Name}} {{.Image}}' | grep frontend"
```

Expected: ảnh frontend mang tag `sha-` mới nhất (không còn `051e1c3`).

- [ ] **Step 5: Đo lại (GREEN) + chứng minh không né được rate limit (Review Focus 2)**

```bash
curl -s -o /dev/null https://capstone.yamiannephilim.com/
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c 'sudo docker logs --tail 30 $(sudo docker ps -q -f name=capstone_frontend | head -1) 2>&1 | grep "GET / HTTP" | tail -3'
```

Expected (GREEN): dòng log bắt đầu bằng **IP công khai thật** của bạn (không còn `10.0.0.x`) —
đây là bằng chứng `real_ip` chạy trong container thật.

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://capstone.yamiannephilim.com/api/user/login \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.9.$i" \
    -d '{"email":"khong-ton-tai@example.com","password":"sai-be-bet"}'
done; echo
```

Expected: 10 lần đầu `401`, lần thứ 11 là **`429`** — header giả không tạo được bucket mới, tức
không né được rate limit. (Nếu thấy `401` cả 11 lần: nginx đang chưa ghi đè XFF → kiểm lại bước 2
và chắc chắn ảnh mới đã deploy.)

- [ ] **Step 6: Chạy lại bộ test e2e để chắc không vỡ luồng app**

```bash
cd /d/capstone-project/e2e && npm run test:api && npm run test:browser
```

Expected: `43/43` và `13/13` (bộ test tự dựng mongod riêng, không phụ thuộc lab).

---

### Task 6: `--prune` để gỡ tunnel không để lại service mồ côi

**Files:**
- Modify: `infra/ansible/roles/app/templates/deploy.sh.j2:23`

**Interfaces:**
- Consumes: `cloudflare_tunnel_enabled` (Task 1) + service `capstone_cloudflared` (Task 4).
- Produces: `deploy.sh` xoá mọi service không còn trong file stack của chính stack `capstone`.

- [ ] **Step 1: Chứng minh vấn đề có thật (RED) — bỏ token thì service cũ vẫn nằm lại**

```bash
cd /d/capstone-project
cp infra/.env /tmp/env-backup
sed -i 's|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=|' infra/.env
cd infra && "/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone --format '{{.Name}}' | grep -c cloudflared"
```

Expected (RED): `1` — token đã bỏ nhưng service `capstone_cloudflared` **vẫn còn** (Docker mặc định
không xoá service bị bỏ khỏi file).

- [ ] **Step 2: Thêm `--prune` vào `deploy.sh`**

Trong `infra/ansible/roles/app/templates/deploy.sh.j2`, sửa dòng `docker stack deploy ...` thành:

```bash
# --prune: xoá service không còn trong file stack. Bắt buộc có vì tunnel là TUỲ CHỌN:
# bỏ token trong infra/.env là khối {% if %} trong template biến mất, nhưng `docker stack
# deploy` mặc định KHÔNG xoá service đã bị bỏ khỏi file — không có cờ này thì phải gõ tay
# `docker service rm`, trái nguyên tắc "mọi thứ bằng IaC/script" của dự án.
docker stack deploy --prune -c {{ app_dir }}/docker-stack.yml {{ stack_name }}
```

- [ ] **Step 3: Provision và kiểm chứng service mồ côi biến mất (GREEN)**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone"
```

Expected: **12 service**, KHÔNG còn `capstone_cloudflared`.

- [ ] **Step 4: Trả token và kiểm chứng tunnel quay lại**

```bash
cd /d/capstone-project && cp /tmp/env-backup infra/.env && cd infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone --format '{{.Name}}' | grep -c cloudflared"
curl -s https://capstone-api.yamiannephilim.com/api/health
```

Expected: `1` service cloudflared trở lại (13 tổng) và health trả `{"status":"ok"}`.

- [ ] **Step 5: `--prune` không xoá nhầm service đang cần (Review Focus 3)**

```bash
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone --format '{{.Name}}'" > /tmp/truoc.txt
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo /opt/capstone/deploy.sh" > /dev/null
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone --format '{{.Name}}'" > /tmp/sau.txt
diff /tmp/truoc.txt /tmp/sau.txt && echo "khong service nao bi xoa nham"
```

Expected: không có khác biệt + dòng `khong service nao bi xoa nham`; `deploy.sh` kết thúc thành công.

- [ ] **Step 6: Commit**

```bash
cd /d/capstone-project
git add infra/ansible/roles/app/templates/deploy.sh.j2
git commit -m "feat(infra): deploy.sh dung --prune de go tunnel khong de lai service mo coi

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Tài liệu

**Files:**
- Modify: `infra/README.md` (sơ đồ, mục truy cập, 2 mục mới, UFW, xử lý sự cố, kiểm chứng)
- Modify: `README.md` (sơ đồ, bảng thành phần, mục truy cập)
- Modify: `CLAUDE.md` (đoạn hạ tầng + quy ước mới)

**Interfaces:**
- Consumes: mọi thứ đã chạy ở Task 1–6.
- Produces: tài liệu khớp trạng thái thật; Task 8 dựa vào mục "Kiểm chứng" của `infra/README.md`.

- [ ] **Step 1: `infra/README.md` — sơ đồ + truy cập**

Trong sơ đồ ASCII, thêm vào nhánh manager 2 dòng:

```
   │   ├─ cloudflared (ghim manager) ─▶ Cloudflare Tunnel ─▶ capstone.yamiannephilim.com
   │   ├─ portainer(:9000) + portainer-agent (global)          capstone-api.yamiannephilim.com
```

và đổi dòng "Truy cập từ máy bạn" thành:

```
Truy cập từ máy bạn: **80** app · **9000** Portainer · **9090** Prometheus · **3001** Grafana ·
**8025** Mailpit. Công khai (khi bật tunnel): **capstone.yamiannephilim.com** (app) và
**capstone-api.yamiannephilim.com** (API).
```

- [ ] **Step 2: `infra/README.md` — mục "Cloudflare Tunnel" và "Portainer"**

Chèn ngay sau mục "Quy trình":

````markdown
## Cloudflare Tunnel (đưa app ra Internet)

Tunnel là **tuỳ chọn**: không có token thì stack vẫn dựng đủ 12 service còn lại. Khi bật,
app công khai ở `https://capstone.yamiannephilim.com`, API ở `https://capstone-api.yamiannephilim.com`.
Connector **chủ động kết nối ra ngoài** (7844 TCP/UDP) nên không phải mở thêm cổng vào.

Bật một lần (phần bấm trên dashboard không script hoá được):

1. Dashboard Cloudflare → domain `yamiannephilim.com` → **Networking → Tunnels** (giao diện mới
   nằm ở `one.dash.cloudflare.com` → **Networks → Tunnels**) → **Create Tunnel** → Cloudflared →
   tên `capstone`.
2. Ở bước "Install and run": **không chạy lệnh**, chỉ copy chuỗi `eyJ...`.
3. Tab **Routes** → **Add route** → **Published application**, khai 2 lần:

   | Subdomain | Domain | Service URL |
   |---|---|---|
   | `capstone` | `yamiannephilim.com` | `http://frontend:80` |
   | `capstone-api` | `yamiannephilim.com` | `http://backend:8000` |

   DNS record do Cloudflare tự tạo. `HTTP Host Header` / `Origin Server Name` để trống.
4. Dán token vào `infra/.env` (file này bị `.gitignore` chặn) rồi chạy lại
   `infra\setup.cmd` hoặc `cd infra && vagrant provision --provision-with ansible`.

| Việc | Cách làm |
|---|---|
| Đổi/rotate token | Sửa `infra/.env` → provision. Swarm sẽ cập nhật env của service và thay task |
| Gỡ tunnel | Xoá token trong `infra/.env` → provision. `deploy.sh --prune` xoá luôn service |
| Domain không truy cập được | VM manager phải đang chạy (connector nằm trong stack); xem `sudo docker service logs capstone_cloudflared` |

## Portainer

`http://192.168.56.10:9000` — chỉ trong mạng host-only, **không** ra Internet.
Đăng nhập `admin` với `PORTAINER_ADMIN_PASSWORD` in trong `/opt/capstone/.env`
(`vagrant ssh manager -c "sudo cat /opt/capstone/.env"`).

`portainer-agent` chạy `mode: global` (một container mỗi node) nên UI thấy được container/image/volume
của **cả hai** node; thiếu agent thì chỉ thấy của node manager. Mật khẩu admin sinh tự động, chỉ
được đọc ở lần tạo admin đầu tiên — xoá volume `capstone_portainer_data` thì Portainer tạo lại admin
với đúng mật khẩu đó.
````

- [ ] **Step 3: `infra/README.md` — UFW, xử lý sự cố, kiểm chứng**

Trong mục "Bảo mật trong lab", sửa dòng UFW thành:

```markdown
- **UFW được bật** trên cả 2 node, chỉ mở các cổng cần thiết (22, 2377, 7946, 4789, 80, 9000,
  9090, 3001, 8025, 9100, 8080). Thêm service publish cổng mới thì phải thêm cổng đó vào role
  `common`, nếu không Prometheus/truy cập sẽ mất. `cloudflared` không cần cổng nào (chỉ đi ra).
```

Thêm 4 dòng vào bảng "Xử lý sự cố":

```markdown
| Domain công khai trả 502/1033 | Connector chưa chạy: VM manager tắt, token sai, hoặc route trên dashboard trỏ sai host | `docker service logs capstone_cloudflared`; kiểm `docker stack services capstone`, và Service URL phải là `http://frontend:80` / `http://backend:8000` |
| Portainer `0/1` rồi restart liên tục | Không đọc được file secret hoặc không nối được agent | `docker service logs capstone_portainer`; file `/opt/capstone/secrets/portainer_admin` phải là `0640 vagrant:docker` |
| Portainer UI chỉ thấy 1 node | `portainer-agent` không lên ở node kia | `docker service ps capstone_portainer-agent`; agent là service `global` nên phải có 2/2 |
| Access log nginx toàn `10.0.0.x` | Request đi qua tunnel mà `real_ip` không chạy (hoặc ảnh frontend cũ chưa deploy) | Kiểm 3 dòng `set_real_ip_from`/`real_ip_header` trong `frontend/nginx.conf` và ảnh đang chạy của service `frontend` |
```

Trong mục "Kiểm chứng", thay dòng `# 10 service đủ replica` bằng `# 13 service đủ replica (12 nếu chưa bật tunnel)`
và thêm:

```bash
curl -s http://192.168.56.10:9000/api/system/status            # JSON Portainer: {"Version":"2.45.2",...}
curl -s https://capstone-api.yamiannephilim.com/api/health      # {"status":"ok"} — xuyên tunnel
curl -s -o /dev/null -w "%{http_code}\n" https://capstone.yamiannephilim.com/active   # 200 (SPA fallback)
```

- [ ] **Step 4: `README.md` (gốc)**

Trong sơ đồ ASCII, thêm vào khối manager:

```
   │  portainer(:9000) · cloudflared   │  │  portainer-agent              │
```

và sau dòng "Truy cập từ máy dev: ..." thêm:

```markdown
Công khai qua **Cloudflare Tunnel** (khi bật): <https://capstone.yamiannephilim.com> cho app và
<https://capstone-api.yamiannephilim.com> cho API — bật/gỡ bằng một biến trong `infra/.env`.
```

Trong bảng "Thành phần", thêm 2 dòng trước dòng `[docs/](docs/)`:

```markdown
| Cloudflare Tunnel | cloudflared trong stack | Đưa app/API ra domain thật, không mở cổng vào |
| Portainer | portainer-ce + agent (global) | Quản trị swarm, xem container/volume của cả 2 node |
```

- [ ] **Step 5: `CLAUDE.md` (gốc)**

Trong đoạn "Dự án này là gì", sau câu giới thiệu `infra/`, thêm:

```markdown
Stack hiện có **13 service** (12 khi chưa bật Cloudflare Tunnel): thêm `portainer` +
`portainer-agent` (quản trị, `http://192.168.56.10:9000`) và `cloudflared` (domain công khai
`capstone(.api).yamiannephilim.com`). Hai điểm phải nhớ khi sửa `infra/`:

- `infra/stack/docker-stack.yml.j2` là **template Jinja** do Ansible render thành
  `/opt/capstone/docker-stack.yml` — sửa bản trong VM là vô ích, lần provision sau ghi đè.
- Token tunnel nằm ở `infra/.env` (bị gitignore); không có token thì stack vẫn đủ phần còn lại.
```

- [ ] **Step 6: Kiểm chứng tài liệu khớp sự thật**

```bash
cd /d/capstone-project
grep -rn "10 service" README.md infra/README.md CLAUDE.md        # phải KHÔNG ra kết quả
grep -c "13 service" infra/README.md                              # >= 1
grep -o "http://192.168.56.10:9000/api/system/status" infra/README.md | wc -l   # 1
```

Expected: lệnh 1 không in gì; lệnh 2 `>= 1`; lệnh 3 `1`.

- [ ] **Step 7: Commit**

```bash
cd /d/capstone-project
git add README.md infra/README.md CLAUDE.md
git commit -m "docs: cloudflare tunnel + portainer trong README, infra/README, CLAUDE.md

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Nghiệm thu cuối — đúng mục 10 của spec

**Files:**
- Không sửa file (chỉ chạy kiểm chứng). Nếu phát hiện sai, quay lại task tương ứng.

**Interfaces:**
- Consumes: toàn bộ Task 1–7.
- Produces: kết luận "xong" có bằng chứng cho từng dòng.

- [ ] **Step 1: Trạng thái cụm và Portainer**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker node ls"
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c "sudo docker stack services capstone"
curl -s http://192.168.56.10:9000/api/system/status
```

Expected: 2 node `Ready`; **13 service** đủ replica; JSON Portainer có `"Version":"2.45.2"`.

- [ ] **Step 2: Đường công khai**

```bash
curl -s https://capstone-api.yamiannephilim.com/api/health
curl -s https://capstone.yamiannephilim.com/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://capstone.yamiannephilim.com/active
```

Expected: `{"status":"ok"}` hai lần và `200`.

- [ ] **Step 3: IP thật + rate limit xuyên tunnel**

```bash
curl -s -o /dev/null https://capstone.yamiannephilim.com/
"/c/Program Files/Vagrant/bin/vagrant.exe" ssh manager -c 'sudo docker logs --tail 30 $(sudo docker ps -q -f name=capstone_frontend | head -1) 2>&1 | grep "GET / HTTP" | tail -3'
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://capstone.yamiannephilim.com/api/user/login \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.9.$i" \
    -d '{"email":"khong-ton-tai@example.com","password":"sai-be-bet"}'
done; echo
```

Expected: log hiện **IP công khai thật** (không phải `10.0.0.x`); chuỗi mã trạng thái kết thúc bằng `429`.

- [ ] **Step 4: Không hồi quy phần cũ**

```bash
curl -s http://192.168.56.10/api/health
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | grep -c '"health":"up"'   # 7
cd /d/capstone-project && npm --prefix backend test
cd e2e && npm run test:api && npm run test:browser
```

Expected: `{"status":"ok"}`; `7`; unit test backend xanh; `43/43` và `13/13`.

- [ ] **Step 5: Idempotent + cây git sạch**

```bash
cd /d/capstone-project/infra
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible   # changed=0
"/c/Program Files/Vagrant/bin/vagrant.exe" provision --provision-with ansible   # changed=0 lần nữa
cd /d/capstone-project && git status --short && git log --oneline -8
```

Expected: hai lần `changed=0`; `git status` sạch (không có `infra/.env` lọt vào).

- [ ] **Step 6: Kiểm bằng mắt (không tự động hoá được) — ghi kết quả vào báo cáo cuối**

1. Mở `http://192.168.56.10:9000` → đăng nhập bằng mật khẩu trong `/opt/capstone/.env` → thấy
   **2 node** và container của cả hai.
2. Mở `https://capstone.yamiannephilim.com` → đăng ký → thêm task → **F5** → task còn nguyên.
3. Quên mật khẩu trên domain công khai → Mailpit `http://192.168.56.10:8025` thấy mail → link
   trong mail trỏ về `https://capstone.yamiannephilim.com` → đổi mật khẩu → đăng nhập lại được.
4. Grafana `http://192.168.56.10:3001` → dashboard "Capstone overview" vẫn có dữ liệu.

---

## Ghi chú thi hành

- Thứ tự task là **bắt buộc**: Task 1 (token) → Task 2 (Portainer) → Task 3 (template) →
  Task 4 (tunnel) → Task 5 (nginx) → Task 6 (`--prune`) → Task 7 (docs) → Task 8 (nghiệm thu).
  Task 5 cần tunnel đã chạy để đo được trạng thái SAI; Task 6 cần service cloudflared tồn tại
  để chứng minh service mồ côi.
- Task 4 bước 5 và Task 8 bước 6 là việc **con người** phải làm (bấm dashboard / mở trình duyệt).
  Mọi bước còn lại đều chạy bằng lệnh.
- Nếu `vagrant provision` đỏ ở bất kỳ đâu: đọc task `failed` trong output Ansible, sửa file trong
  repo rồi chạy lại — **không** sửa trực tiếp file trong VM (lần provision sau ghi đè).
- Nếu CI (`gh run watch`) bị chặn bởi phân loại lệnh: dùng `gh run list` rồi `gh run view <id>`.
