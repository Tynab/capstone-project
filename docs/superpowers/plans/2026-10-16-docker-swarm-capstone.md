# Kế hoạch thi công: Docker Swarm 2 node + giám sát + CICD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng hạ tầng Docker Swarm 2 node bằng Vagrant + Ansible chạy MongoDB/backend/frontend/Prometheus/Grafana, kèm pipeline GitHub Actions tự build và deploy lên swarm.

**Architecture:** Windows host → `infra/setup.cmd` cài VirtualBox/Vagrant rồi `vagrant up` tạo 2 VM Ubuntu 22.04 (host-only 192.168.56.10/.11). Ansible chạy ngay trong VM manager (`ansible_local`) và SSH sang cả 2 VM: cài Docker, `swarm init`/`join`, sinh secrets vào `/opt/capstone/.env`, deploy stack bằng `/opt/capstone/deploy.sh`. GitHub-hosted runner build image đẩy lên GHCR; runner self-hosted trong VM manager kéo image và deploy.

**Tech Stack:** Vagrant + VirtualBox, Ansible, Docker Swarm, Ubuntu 22.04, Node 20, nginx, MongoDB 6, Prometheus + Grafana + node-exporter + cAdvisor + mongodb-exporter + blackbox-exporter + Mailpit, GitHub Actions + GHCR.

**Spec:** [docs/superpowers/specs/2026-10-16-docker-swarm-capstone-design.md](../specs/2026-10-16-docker-swarm-capstone-design.md)

## Global Constraints

- Máy đích: Windows 11, Git Bash. Repo tại `D:\capstone-project`; mọi lệnh trong plan chạy từ thư mục gốc repo.
- IP/ports cố định: manager `192.168.56.10`, worker `192.168.56.11`; app **80**, Prometheus **9090**, Grafana **3001**, Mailpit **8025**.
- Box `bento/ubuntu-22.04`, mỗi VM 4096MB RAM / 2 CPU. Node image `node:20-slim` (backend) và `node:20-alpine` (build frontend) + `nginx:alpine`.
- Tên image GHCR **viết thường toàn bộ**: `ghcr.io/tynab/capstone-project-backend`, `ghcr.io/tynab/capstone-project-frontend`.
- KHÔNG sửa logic ứng dụng ngoài 3 nhóm ở spec §8. Giữ nguyên guard bảo mật, envelope API, và toàn bộ `e2e/lib/stack.mjs`. Bộ e2e phải xanh (40/40 sau Task 5).
- Mọi giá trị sinh tự động phải chỉ dùng `ascii_letters,digits` (không ký tự đặc biệt) vì được nhúng vào `.env` rồi `source` bằng shell và nội suy vào compose.
- File trong `infra/` phải là LF (trừ `*.cmd` là CRLF) — khai báo trong `.gitattributes` ở Task 1.
- Secret không bao giờ nằm trong repo, trong log Ansible, hay trong output lệnh của plan này.
- Comment/tài liệu viết bằng tiếng Việt, nêu lý do "vì sao" — theo văn phong sẵn có của repo.
- Docker **chưa cài trên Windows** và sẽ không cài: mọi lệnh `docker`/`docker build` trong plan chạy **bên trong VM** qua `vagrant ssh`.
- GHCR package để **public** (khác spec §6.2 một chi tiết): như vậy cả 2 node kéo được image mà không cần credential. Nếu sau này chuyển sang private, thêm `--with-registry-auth` vào `deploy.sh` và `docker login` cho runner.

## Review Focus

Năm kiểu lỗi dễ cắn người dùng mà test thường không chạm tới, mỗi dòng đều có bước kiểm ở task tương ứng:

1. **Secret sinh ra chứa ký tự đặc biệt** (`$`, `"`, `\`, khoảng trắng) → `.env` vỡ khi `set -a; . .env`, hoặc `MONGO_URI` sai vì password không URL-safe. Kiểm ở Task 11.
2. **Provision lại lần hai** → đổi secret (người dùng mất đăng nhập, mail reset vô hiệu) hoặc xoá dữ liệu Mongo. Kiểm ở Task 11 và Task 12.
3. **`setup.cmd` chạy khi máy đã cài một nửa** (có VirtualBox, thiếu Vagrant hoặc ngược lại) → script phải xử lý từng công cụ độc lập và chạy lại lần hai không lỗi. Kiểm ở Task 1.
4. **Push lên nhánh khác `main`/PR** → chỉ được chạy `test`, tuyệt đối không build/push image hay deploy. Kiểm ở Task 10 và Task 17.
5. **Runner offline (VM tắt)** → job `deploy` phải đỏ sau `timeout-minutes` kèm thông báo rõ, không treo vô hạn và không để stack nửa vời. Kiểm ở Task 17.

---

## Phase 1 — Công cụ và 2 VM

### Task 1: Bộ script dựng hạ tầng

**Files:**
- Create: `infra/setup.ps1`, `infra/setup.cmd`, `infra/destroy.cmd`
- Modify: `.gitignore` (thêm `infra/.ssh/`), `.gitattributes` (thêm quy tắc EOL cho `infra/`)

**Interfaces:**
- Consumes: không (task đầu).
- Produces: `infra/setup.cmd` (entry point duy nhất người dùng gọi), `infra/setup.ps1`, `infra/destroy.cmd`; biến môi trường `RUNNER_TOKEN` được truyền cho Vagrant ở Task 2; file `infra/.ssh/lab_key` + `lab_key.pub` cho Task 2.

- [ ] **Step 1: Cập nhật `.gitignore` và `.gitattributes`**

Thêm vào cuối `.gitignore`:

```
# Khoá SSH của lab (sinh bởi infra/setup.ps1, không bao giờ commit)
infra/.ssh/
# Vagrant sinh trong quá trình chạy
.vagrant/
```

Thêm vào cuối `.gitattributes`:

```
# Script/Linux chạy trong VM: bắt buộc LF
infra/**/*.sh   text eol=lf
infra/**/*.yml  text eol=lf
infra/**/*.j2   text eol=lf
infra/**/*.ini  text eol=lf
infra/Vagrantfile text eol=lf
# File .cmd phải CRLF
infra/*.cmd text eol=crlf
```

- [ ] **Step 2: Viết `infra/setup.ps1`**

```powershell
# Dựng hạ tầng lab từ con số 0. Chạy lại nhiều lần vô hại: mỗi công cụ được
# kiểm tra độc lập nên máy cài thiếu một nửa vẫn xử lý đúng.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Have([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Winget([string]$id) {
    # VirtualBox cần quyền admin -> chạy tiến trình riêng có UAC.
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
        "-NoProfile", "-Command",
        "winget install --id $id -e --accept-package-agreements --accept-source-agreements")
    if ($p.ExitCode -ne 0) { throw "winget install $id that bai (exit $($p.ExitCode))" }
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path","User")
}

Write-Host "== 1/6 Kiem tra cong cu ==" -ForegroundColor Cyan
if (-not (Have winget)) { throw "Thieu winget (App Installer). Cai tu Microsoft Store roi chay lai." }

if (-not (Have VBoxManage)) { Write-Host "Chua co VirtualBox -> cai..."; Winget "Oracle.VirtualBox"; Refresh-Path }
if (-not (Have vagrant))    { Write-Host "Chua co Vagrant -> cai...";    Winget "Hashicorp.Vagrant"; Refresh-Path }

if (-not (Have VBoxManage)) {
    Write-Warning "VirtualBox chua san sang. Thuong do ban can KHOI DONG LAI may (driver kernel)."
    Write-Warning "Khoi dong lai roi chay lai script nay. Script khong tu reboot may ban."
    exit 2
}
if (-not (Have vagrant)) { throw "Vagrant chua co trong PATH. Mo terminal moi roi chay lai." }

Write-Host "== 2/6 Canh bao Hyper-V/VT-x ==" -ForegroundColor Cyan
$hv = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
if ($hv) { Write-Warning "Hyper-V/WSL2 dang bat: VirtualBox se chay qua WHPX, cham hon. Script khong tu tat tinh nang Windows." }
$vt = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
if ($vt -eq $false) { Write-Warning "VT-x co ve dang tat trong BIOS/UEFI." }

Write-Host "== 3/6 Firewall cho mang host-only ==" -ForegroundColor Cyan
$rule = "capstone-lab-hostonly"
& netsh advfirewall firewall show rule name=$rule *> $null
if ($LASTEXITCODE -ne 0) {
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @("-NoProfile","-Command",
            "netsh advfirewall firewall add rule name=$rule dir=in action=allow protocol=TCP localport=80,9090,3001,8025 remoteip=192.168.56.0/24")
        Write-Host "Da them rule firewall '$rule'."
    } catch {
        Write-Warning "Khong them duoc rule firewall. Neu trinh duyet khong mo duoc 192.168.56.10, chay tay (admin):"
        Write-Warning "  netsh advfirewall firewall add rule name=$rule dir=in action=allow protocol=TCP localport=80,9090,3001,8025 remoteip=192.168.56.0/24"
    }
}

Write-Host "== 4/6 Khoa SSH cua lab ==" -ForegroundColor Cyan
$keyDir = Join-Path $PSScriptRoot ".ssh"
$key = Join-Path $keyDir "lab_key"
if (-not (Test-Path $key)) {
    New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    & ssh-keygen -t ed25519 -N '""' -C "capstone-lab" -f $key | Out-Null
    Write-Host "Da sinh $key"
} else { Write-Host "Da co $key" }

Write-Host "== 5/6 Token dang ky GitHub runner ==" -ForegroundColor Cyan
$env:RUNNER_TOKEN = ""
if (Have gh) {
    try {
        $env:RUNNER_TOKEN = (& gh api -X POST repos/Tynab/capstone-project/actions/runners/registration-token --jq .token) 2>$null
        if ($env:RUNNER_TOKEN) { Write-Host "Da lay token runner (het han sau ~1 gio)." }
    } catch { Write-Warning "Khong lay duoc token runner; bo qua buoc dang ky runner." }
}
if (-not $env:RUNNER_TOKEN) { Write-Warning "Thieu RUNNER_TOKEN -> Task 16 phai dang ky runner sau." }

Write-Host "== 6/6 Dung VM va provision ==" -ForegroundColor Cyan
Push-Location $repoRoot
& vagrant up
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "vagrant up that bai" }
# Ansible phai chay SAU khi ca hai VM da len, nen tach khoi `vagrant up`.
& vagrant provision --provision-with ansible
Pop-Location

Write-Host ""
Write-Host "Xong. Truy cap:" -ForegroundColor Green
Write-Host "  App        http://192.168.56.10"
Write-Host "  Prometheus http://192.168.56.10:9090"
Write-Host "  Grafana    http://192.168.56.10:3001"
Write-Host "  Mailpit    http://192.168.56.10:8025"
Write-Host "Mat khau lab: vagrant ssh manager -c 'sudo cat /opt/capstone/.env'"
```

- [ ] **Step 3: Viết `infra/setup.cmd` và `infra/destroy.cmd`**

`infra/setup.cmd`:

```bat
@echo off
REM Wrapper: chay setup.ps1 voi ExecutionPolicy phu hop, khong can go tay.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
pause
```

`infra/destroy.cmd`:

```bat
@echo off
REM XOA TOAN BO VM va du lieu Mongo trong do. Khong the hoan tac.
echo CANH BAO: lenh nay xoa ca 2 VM va du lieu MongoDB ben trong.
set /p ok=Go "yes" de tiep tuc: 
if /i not "%ok%"=="yes" exit /b 1
pushd "%~dp0.."
vagrant destroy -f
popd
pause
```

- [ ] **Step 4: Kiểm chứng — chạy khi đã có đủ công cụ, và chạy lại lần hai**

Sau khi Task 2 có Vagrantfile mới chạy được toàn bộ; ở task này kiểm phần "công cụ":

```bash
# Trong Git Bash, tại gốc repo
cmd //c "infra\setup.cmd" 2>&1 | tail -20   # lan dau: cai thieu, bao ket qua tung cong cu
```

Kỳ vọng lần chạy thứ hai (đã có đủ công cụ): in "Da co ..." cho từng mục, **không** cài lại, không lỗi. Kiểm đúng tình huống Review Focus #3 bằng cách chạy script 2 lần liên tiếp.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .gitattributes infra/setup.ps1 infra/setup.cmd infra/destroy.cmd
git commit -m "feat(infra): bo script dung ha tang lab (cai VirtualBox/Vagrant, khoa, token runner)"
```

### Task 2: Vagrantfile — 2 VM Ubuntu

**Files:**
- Create: `infra/Vagrantfile`

**Interfaces:**
- Consumes: `infra/.ssh/lab_key{,.pub}` (Task 1), `RUNNER_TOKEN` (Task 1, tùy chọn).
- Produces: 2 VM chạy được (`vagrant ssh manager`, `vagrant ssh worker`), tên máy trong inventory Ansible `swarm_manager`/`swarm_worker` (Task 3), key lab nằm ở `/home/vagrant/.ssh/lab_key` trong cả 2 VM, thư mục repo mount tại `/vagrant`, provisioner tên `ansible` (dùng ở Task 3 trở đi).

- [ ] **Step 1: Viết `infra/Vagrantfile`**

```ruby
# -*- mode: ruby -*-
# 2 VM cho lab: manager (control node Ansible + runner) và worker.
# Vòng đời: setup.cmd -> vagrant up -> vagrant provision --provision-with ansible.
VAGRANTFILE_API_VERSION = "2"

REPO_ROOT = File.expand_path("..", __dir__)
LAB_KEY   = File.join(__dir__, ".ssh", "lab_key.pub")
# RUNNER_TOKEN do setup.ps1 dat; rong thi bo qua dang ky runner.
RUNNER_TOKEN = ENV.fetch("RUNNER_TOKEN", "")

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box = "bento/ubuntu-22.04"
  config.vm.synced_folder REPO_ROOT, "/vagrant"

  NODES = {
    "manager" => { ip: "192.168.56.10", name: "swarm-manager" },
    "worker"  => { ip: "192.168.56.11", name: "swarm-worker" },
  }

  NODES.each do |key, node|
    config.vm.define key do |vm|
      vm.vm.hostname = node[:name]
      vm.vm.network "private_network", ip: node[:ip]
      vm.vm.provider "virtualbox" do |vb|
        vb.memory = 4096
        vb.cpus = 2
        vb.name = "capstone-#{key}"
      end

      # Key lab duoc tiem vao ca 2 VM: manager dung no de SSH sang worker.
      vm.vm.provision "file", source: LAB_KEY, destination: "/home/vagrant/lab_key.pub"
      vm.vm.provision "shell", inline: <<-SHELL
        cat /home/vagrant/lab_key.pub >> /home/vagrant/.ssh/authorized_keys
        rm -f /home/vagrant/lab_key.pub
      SHELL
    end
  end

  # Ansible chay TU TRONG manager va dieu khien ca 2 VM. Vi vay no phai chay sau
  # khi ca hai VM da len -> dat run: "never" va goi rieng bang
  # `vagrant provision --provision-with ansible`.
  config.vm.define "manager" do |vm|
    vm.vm.provision "ansible", type: "ansible_local", run: "never" do |a|
      a.playbook = "/vagrant/infra/ansible/site.yml"
      a.inventory_path = "/vagrant/infra/ansible/inventory.ini"
      # Mac dinh ansible_local gioi han vao chinh may dang provision -> phai mo rong.
      a.limit = "all"
      a.extra_vars = { runner_token: RUNNER_TOKEN }
    end
  end
end
```

- [ ] **Step 2: Dựng VM**

```bash
vagrant up
```

Kỳ vọng: tải box ~600MB lần đầu, sau đó 2 VM boot xong.

- [ ] **Step 3: Kiểm chứng 2 VM và key lab**

```bash
vagrant status                       # ca hai: running
vagrant ssh manager -c "hostname -I" # phai co 192.168.56.10
vagrant ssh worker  -c "hostname -I" # phai co 192.168.56.11
# Key lab da duoc tiem (can cho Ansible o Task 3):
vagrant ssh manager -c "test -f /home/vagrant/.ssh/lab_key && echo CHUA_CO_KEY || echo OK_DA_CO_PUB"
vagrant ssh manager -c "grep -c capstone-lab /home/vagrant/.ssh/authorized_keys"
# Ansible chua chay (run: never) — phai bao chua co docker:
vagrant ssh manager -c "command -v docker || echo CHUA_CO_DOCKER"
```

- [ ] **Step 4: Commit**

```bash
git add infra/Vagrantfile
git commit -m "feat(infra): Vagrantfile 2 VM Ubuntu 22.04 cho swarm"
```

### Task 3: Ansible — play chung và cài Docker

**Files:**
- Create: `infra/ansible/inventory.ini`, `infra/ansible/site.yml`, `infra/ansible/group_vars/all.yml`, `infra/ansible/roles/common/tasks/main.yml`

**Interfaces:**
- Consumes: 2 VM ở Task 2, key lab tại `/home/vagrant/.ssh/lab_key`.
- Produces: Docker Engine + compose plugin trên cả 2 node; play `common` trong `site.yml`; biến nhóm `lab_manager_ip`/`lab_worker_ip` cho các role sau; provisioner tên `ansible` chạy được toàn bộ `site.yml`.

- [ ] **Step 1: Viết `infra/ansible/inventory.ini`**

```ini
# Ansible chay tu trong VM manager (ansible_local) va SSH sang ca 2 VM.
[swarm_manager]
swarm_manager ansible_host=192.168.56.10

[swarm_worker]
swarm_worker ansible_host=192.168.56.11

[swarm:children]
swarm_manager
swarm_worker

[swarm:vars]
ansible_user=vagrant
ansible_ssh_private_key_file=/home/vagrant/.ssh/lab_key
ansible_python_interpreter=/usr/bin/python3
ansible_become=true
ansible_become_method=sudo
# May manager chua bao gio SSH sang worker -> bo qua xac nhan host key lan dau.
ansible_ssh_common_args=-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
```

- [ ] **Step 2: Viết `infra/ansible/group_vars/all.yml`**

```yaml
---
stack_name: capstone
lab_manager_ip: "192.168.56.10"
lab_worker_ip: "192.168.56.11"
app_dir: /opt/capstone
app_url: "http://192.168.56.10"
```

- [ ] **Step 3: Viết `infra/ansible/roles/common/tasks/main.yml`**

```yaml
---
- name: Cai goi nen
  apt:
    name: [ca-certificates, curl, gnupg, python3-pip, ufw, acl]
    state: present
    update_cache: true

- name: Tao /etc/apt/keyrings
  file:
    path: /etc/apt/keyrings
    state: directory
    mode: "0755"

- name: Tai GPG key cua Docker
  get_url:
    url: https://download.docker.com/linux/ubuntu/gpg
    dest: /etc/apt/keyrings/docker.asc
    mode: "0644"

- name: Them repo Docker
  apt_repository:
    repo: "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu jammy stable"
    filename: docker
    state: present

- name: Cai Docker Engine + compose plugin
  apt:
    name: [docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin, docker-compose-plugin]
    state: present
    update_cache: true

- name: Bat docker
  service:
    name: docker
    state: started
    enabled: true

# Ansible dang chay bang user vagrant; them group docker chi co tac dung cho
# phien dang nhap MOI, nen cac lenh docker ve sau dung become: true.
- name: Them vagrant vao group docker
  user:
    name: vagrant
    groups: docker
    append: true

- name: UFW — cho phep cac cong cua lab
  ufw:
    rule: allow
    port: "{{ item.port }}"
    proto: "{{ item.proto }}"
  loop:
    - { port: "22",   proto: tcp }
    - { port: "2377", proto: tcp }   # quan ly swarm
    - { port: "7946", proto: tcp }   # gossip
    - { port: "7946", proto: udp }
    - { port: "4789", proto: udp }   # overlay network
    - { port: "80",   proto: tcp }
    - { port: "9090", proto: tcp }
    - { port: "3001", proto: tcp }
    - { port: "8025", proto: tcp }
```

- [ ] **Step 4: Viết `infra/ansible/site.yml` (khung, các play swarm thêm ở Task 4–5)**

```yaml
---
# Thu tu QUAN TRONG: manager phai xong truoc de worker co token de join.
- name: Cau hinh chung cho ca 2 node
  hosts: swarm
  gather_facts: true
  roles:
    - common
```

- [ ] **Step 5: Chạy provision lần đầu**

```bash
vagrant provision --provision-with ansible
```

Kỳ vọng: play `Cau hinh chung cho ca 2 node` chạy trên 2 host, không task nào `failed`, kết thúc bằng `PLAY RECAP` với `failed=0` cho cả `swarm_manager` và `swarm_worker`.

- [ ] **Step 6: Kiểm chứng Docker trên cả 2 VM**

```bash
vagrant ssh manager -c "sudo docker --version && sudo docker compose version"
vagrant ssh worker  -c "sudo docker --version && sudo docker compose version"
# Chay lai provision lan hai: khong duoc bao changed (idempotent)
vagrant provision --provision-with ansible | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add infra/ansible/
git commit -m "feat(ansible): inventory + role common cai Docker cho 2 node"
```

### Task 4: Ansible — khởi tạo swarm ở manager

**Files:**
- Create: `infra/ansible/roles/swarm_manager/tasks/main.yml`
- Modify: `infra/ansible/site.yml` (thêm play manager)

**Interfaces:**
- Consumes: Docker (Task 3), biến `lab_manager_ip`, `stack_name`.
- Produces: swarm `active` ở manager với `advertise-addr=192.168.56.10`; overlay network `capstone`; token worker lấy được bằng `docker swarm join-token -q worker` (Task 5 dùng).

- [ ] **Step 1: Viết `infra/ansible/roles/swarm_manager/tasks/main.yml`**

```yaml
---
# Dung `docker node ls` thay vi doc chuoi {{.Swarm...}} de tranh xung dot
# cu phap template giua Jinja va Go template.
- name: Swarm da init chua
  shell: docker node ls >/dev/null 2>&1 && echo yes || echo no
  register: swarm_ready
  changed_when: false
  failed_when: false
  become: true

- name: Khoi tao swarm
  command: docker swarm init --advertise-addr {{ lab_manager_ip }}
  register: swarm_init
  when: swarm_ready.stdout == "no"
  become: true

- name: Lay token worker (worker can o Task 5)
  command: docker swarm join-token -q worker
  register: swarm_worker_token
  changed_when: false
  become: true

- name: Tao overlay network
  shell: docker network create --driver overlay --attachable {{ stack_name }}
  register: net_create
  changed_when: net_create.rc == 0
  failed_when: net_create.rc != 0 and 'already exists' not in net_create.stderr
  become: true

- name: Cho manager san sang
  command: docker node ls --format "{% raw %}{{.Hostname}} {{.ManagerStatus}}{% endraw %}"
  register: nodes
  changed_when: false
  until: "'Leader' in nodes.stdout"
  retries: 10
  delay: 3
  become: true
```

Lưu ý: trong file thật dùng đúng `{% raw %}...{% endraw %}` như trên (đã ghi rõ để agent copy chính xác).

- [ ] **Step 2: Thêm play manager vào `site.yml`**

```yaml
- name: Khoi tao swarm o manager
  hosts: swarm_manager
  gather_facts: false
  roles:
    - swarm_manager
```

- [ ] **Step 3: Chạy và kiểm chứng**

```bash
vagrant provision --provision-with ansible
vagrant ssh manager -c "sudo docker node ls"
```

Kỳ vọng: một dòng `swarm-manager  Ready  Active  Leader`. Chạy provision lần hai: task `Khoi tao swarm` bị **skip** (không init lại).

- [ ] **Step 4: Commit**

```bash
git add infra/ansible/
git commit -m "feat(ansible): role swarm_manager (init swarm + overlay network)"
```

### Task 5: Ansible — worker join swarm

**Files:**
- Create: `infra/ansible/roles/swarm_worker/tasks/main.yml`
- Modify: `infra/ansible/site.yml` (thêm play worker)

**Interfaces:**
- Consumes: token worker (Task 4, lấy qua `delegate_to: swarm_manager`), `lab_manager_ip`.
- Produces: worker ở trạng thái `Ready` trong `docker node ls` — điều kiện để Task 12 trải replica ra 2 node.

- [ ] **Step 1: Viết `infra/ansible/roles/swarm_worker/tasks/main.yml`**

```yaml
---
- name: Node da join swarm chua
  shell: docker info >/dev/null 2>&1 && (docker node ls >/dev/null 2>&1; echo $?)
  # 0 = da la thanh vien (lenh node ls chay duoc); khac 0 = chua join
  register: join_state
  changed_when: false
  failed_when: false
  become: true

- name: Lay token worker tu manager
  command: docker swarm join-token -q worker
  delegate_to: swarm_manager
  register: swarm_worker_token
  changed_when: false
  become: true
  when: join_state.stdout != "0"

- name: Join swarm
  command: docker swarm join --token {{ swarm_worker_token.stdout }} {{ lab_manager_ip }}:2377
  when: join_state.stdout != "0"
  become: true
```

- [ ] **Step 2: Thêm play worker vào `site.yml` (đặt sau play manager)**

```yaml
- name: Cho worker join swarm
  hosts: swarm_worker
  gather_facts: false
  roles:
    - swarm_worker
```

- [ ] **Step 3: Chạy và kiểm chứng 2 node Ready**

```bash
vagrant provision --provision-with ansible
vagrant ssh manager -c "sudo docker node ls"
```

Kỳ vọng: **2 dòng** — `swarm-manager ... Leader` và `swarm-worker ... Ready`. Chạy lại provision: task `Join swarm` bị skip (Review Focus #2 — idempotent).

- [ ] **Step 4: Commit**

```bash
git add infra/ansible/
git commit -m "feat(ansible): role swarm_worker join swarm (idempotent)"
```

---

## Phase 2 — Đóng gói ứng dụng

### Task 6: Endpoint `/api/health`

**Files:**
- Modify: `backend/server.js` (thêm route, cạnh các `app.use("/api/...")` khác)
- Modify: `e2e/api.e2e.mjs` (thêm khẳng định)
- Modify: `backend/CLAUDE.md` (bảng route + số khẳng định e2e)

**Interfaces:**
- Consumes: không.
- Produces: `GET /api/health` → `200 {"status":"ok"}`; được dùng bởi `HEALTHCHECK` của backend image (Task 8), healthcheck swarm (Task 12) và blackbox-exporter (Task 13). `e2e/api.e2e.mjs` từ 39 lên **40** khẳng định.

- [ ] **Step 1: Viết khẳng định e2e (test đỏ trước)**

Trong `e2e/api.e2e.mjs`, ngay sau dòng `record('getuser: ...')` đầu tiên (khu vực kiểm tra auth cơ bản), thêm:

```javascript
    // Healthcheck cho swarm va cho blackbox-exporter. Cong khai, khong lo thong tin noi bo.
    r = await req('GET', '/health')
    record('health: tra 200 {status:ok} khong can token',
        r.status === 200 && r.data?.status === 'ok',
        `status=${r.status} body=${JSON.stringify(r.data)}`)
```

- [ ] **Step 2: Chạy e2e để thấy đỏ**

```bash
cd e2e && npm run test:api 2>&1 | tail -5
```

Kỳ vọng: `FAIL  health: tra 200 {status:ok} khong can token` và `KẾT QUẢ: 39/40 PASS`.

- [ ] **Step 3: Thêm route vào `backend/server.js`**

Trong callback `mongoose.connect`, cạnh các dòng `app.use("/api/user", ...)`:

```js
    // Healthcheck: dung cho HEALTHCHECK cua image, healthcheck cua swarm va
    // blackbox-exporter. Chi tra trang thai song, khong lo thong tin noi bo.
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }))
```

- [ ] **Step 4: Chạy e2e để thấy xanh**

```bash
cd e2e && npm run test:api 2>&1 | tail -3
```

Kỳ vọng: `KẾT QUẢ: 40/40 PASS`.

- [ ] **Step 5: Cập nhật `backend/CLAUDE.md`**

- Bảng route: thêm dòng `| `/api/health` | `/health` | không | không |` (không auth, không rate limit).
- Dòng ghi số khẳng định e2e trong `CLAUDE.md` gốc và `backend/CLAUDE.md` nếu có nhắc "39" → đổi thành 40.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js e2e/api.e2e.mjs backend/CLAUDE.md CLAUDE.md
git commit -m "feat(backend): them GET /api/health cho healthcheck va giam sat"
```

### Task 7: SMTP cấu hình bằng env (giữ tương thích Gmail)

**Files:**
- Create: `backend/services/smtpConfig.js`, `backend/services/smtpConfig.test.js`
- Modify: `backend/services/mailService.js`, `backend/controllers/forgotPasswordController.js`, `backend/package.json` (script `test`), `backend/CLAUDE.md`

**Interfaces:**
- Consumes: không.
- Produces: `buildTransportOptions(env)` trả options cho `nodemailer.createTransport`, và `hasMailConfig(env)` — dùng ở cả 2 chỗ gửi mail. Env: `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`, fallback `GMAIL_USERNAME`/`GMAIL_PASSWORD`. `npm test` ở backend chạy `node --test`.

- [ ] **Step 1: Viết unit test (đỏ trước)**

`backend/services/smtpConfig.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { buildTransportOptions, hasMailConfig } from "./smtpConfig.js";

test("SMTP_HOST duoc dat -> dung host/port/secure tu env, khong dung service gmail", () => {
  const opts = buildTransportOptions({
    SMTP_HOST: "mailpit", SMTP_PORT: "1025", SMTP_SECURE: "false",
  });
  assert.equal(opts.host, "mailpit");
  assert.equal(opts.port, 1025);
  assert.equal(opts.secure, false);
  assert.equal(opts.service, undefined);
  assert.equal(opts.auth, undefined, "khong auth khi thieu SMTP_USER");
});

test("SMTP_HOST trong -> giu nguyen hanh vi Gmail cu", () => {
  const opts = buildTransportOptions({
    GMAIL_USERNAME: "a@gmail.com", GMAIL_PASSWORD: "app-password",
  });
  assert.equal(opts.service, "gmail");
  assert.deepEqual(opts.auth, { user: "a@gmail.com", pass: "app-password" });
});

test("SMTP co user/pass -> co auth", () => {
  const opts = buildTransportOptions({
    SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_SECURE: "true",
    SMTP_USER: "u", SMTP_PASS: "p",
  });
  assert.equal(opts.secure, true);
  assert.deepEqual(opts.auth, { user: "u", pass: "p" });
});

test("hasMailConfig: true khi co SMTP_HOST, hoac co du GMAIL_*", () => {
  assert.equal(hasMailConfig({ SMTP_HOST: "mailpit" }), true);
  assert.equal(hasMailConfig({ GMAIL_USERNAME: "a", GMAIL_PASSWORD: "b" }), true);
  assert.equal(hasMailConfig({ GMAIL_USERNAME: "a" }), false);
  assert.equal(hasMailConfig({}), false);
});
```

- [ ] **Step 2: Chạy test để thấy đỏ**

```bash
cd backend && node --test services/smtpConfig.test.js 2>&1 | tail -5
```

Kỳ vọng: FAIL — `Cannot find module './smtpConfig.js'`.

- [ ] **Step 3: Viết `backend/services/smtpConfig.js`**

```javascript
// Cau hinh SMTP tach khoi cho goi: truoc day ca hai cho gui mail deu cung
// `service: 'gmail'`, nen khong the tro vao SMTP gia (Mailpit) trong lab.
// Quy tac: co SMTP_HOST thi dung host/port/secure; khong co thi giu nguyen
// hanh vi Gmail cu de khong pha vo cau hinh dang chay.

const hasGmailCreds = (env) =>
  Boolean(env.GMAIL_USERNAME && env.GMAIL_PASSWORD);

export const hasMailConfig = (env = process.env) =>
  Boolean(env.SMTP_HOST) || hasGmailCreds(env);

export const buildTransportOptions = (env = process.env) => {
  if (env.SMTP_HOST) {
    const options = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 1025),
      secure: String(env.SMTP_SECURE) === "true",
    };
    // Mailpit chay khong auth -> chi gan auth khi thuc su co tai khoan.
    if (env.SMTP_USER) {
      options.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
    }
    return options;
  }
  return {
    service: "gmail",
    auth: { user: env.GMAIL_USERNAME, pass: env.GMAIL_PASSWORD },
  };
};
```

- [ ] **Step 4: Chạy test để thấy xanh**

```bash
cd backend && node --test services/smtpConfig.test.js 2>&1 | tail -5
```

Kỳ vọng: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Dùng cấu hình mới ở hai chỗ gửi mail**

Trong `backend/services/mailService.js`: thay `hasCredentials` và `createTransporter` bằng

```javascript
import { buildTransportOptions, hasMailConfig } from "./smtpConfig.js";
...
const createTransporter = () => createTransport(buildTransportOptions());
```

và đổi điều kiện đầu `sendTaskAddedMail` thành `if (!hasMailConfig())`, giữ nguyên câu cảnh báo.

Trong `backend/controllers/forgotPasswordController.js`: thay khối `createTransport({ service: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, auth: {...} })` bằng

```javascript
        const transporter = createTransport(buildTransportOptions());
```

giữ nguyên import `createTransport` và toàn bộ phần `sendMail`/`.catch` phía sau (không `await`).

- [ ] **Step 6: Đổi `npm test` của backend sang `node --test` và cập nhật tài liệu**

`backend/package.json`:

```json
    "test": "node --test services/"
```

Chạy: `cd backend && npm test` → kỳ vọng `# pass 4 / # fail 0`.

Cập nhật `backend/CLAUDE.md`: dòng nói `npm test` là placeholder `exit 1` → nay chạy unit test bằng `node --test services/`; nêu rõ `SMTP_*` là biến mới và khi `SMTP_HOST` trống thì vẫn dùng Gmail như cũ. Cập nhật `.env.example` với 5 biến `SMTP_*` (để trống mặc định).

- [ ] **Step 7: Chạy e2e — không được vỡ hành vi cũ**

```bash
cd e2e && npm run test:api 2>&1 | tail -3
```

Kỳ vọng: `KẾT QUẢ: 40/40 PASS` (e2e không đặt `SMTP_HOST` nên vẫn đi đường Gmail/không gửi).

- [ ] **Step 8: Commit**

```bash
git add backend/services/smtpConfig.js backend/services/smtpConfig.test.js \
        backend/services/mailService.js backend/controllers/forgotPasswordController.js \
        backend/package.json backend/.env.example backend/CLAUDE.md
git commit -m "feat(backend): SMTP cau hinh qua env, giu tuong thich Gmail; npm test chay node --test"
```

### Task 8: Dockerfile cho backend

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`

**Interfaces:**
- Consumes: `/api/health` (Task 6).
- Produces: image build được từ `/vagrant/backend` trong VM; `HEALTHCHECK` gọi `/api/health`; user chạy là `node` (không phải root).

- [ ] **Step 1: Viết `backend/.dockerignore`**

```
node_modules
npm-debug.log*
.env
*.log
```

- [ ] **Step 2: Viết `backend/Dockerfile`**

```dockerfile
# node:20-slim (glibc) chu khong alpine: bcrypt la native addon, tren musl
# thuong phai build lai tu source va de vo khi thieu toolchain.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 8000
# wget co san trong base image; /api/health tra 200 khi server va DB deu song.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8000/api/health || exit 1
CMD ["node", "server.js"]
```

- [ ] **Step 3: Build và smoke test trong VM manager**

```bash
vagrant ssh manager -c '
  set -e
  sudo docker build -t capstone-backend:test /vagrant/backend
  sudo docker network create smoke-net || true
  sudo docker rm -f smoke-mongo smoke-backend >/dev/null 2>&1 || true
  sudo docker run -d --name smoke-mongo --network smoke-net mongo:6
  sleep 5
  sudo docker run -d --name smoke-backend --network smoke-net \
    -e MONGO_URI=mongodb://smoke-mongo:27017/todo \
    -e JWT_SECRET=smoke-secret-1234567890 \
    -p 18000:8000 capstone-backend:test
  for i in $(seq 1 20); do
    curl -fsS http://127.0.0.1:18000/api/health && break || sleep 3
  done
  echo
  sudo docker exec smoke-backend wget -q -O- http://127.0.0.1:8000/api/health
  sudo docker rm -f smoke-mongo smoke-backend
'
```

Kỳ vọng: in ra `{"status":"ok"}` hai lần (một qua port map, một qua healthcheck nội bộ).

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "feat(backend): Dockerfile 2 stage (node:20-slim) + healthcheck /api/health"
```

### Task 9: nginx + Dockerfile cho frontend

**Files:**
- Create: `frontend/nginx.conf`, `frontend/Dockerfile`, `frontend/.dockerignore`

**Interfaces:**
- Consumes: backend service tên `backend` cổng 8000 (Task 12 đặt tên service như vậy).
- Produces: image `capstone-frontend` phục vụ bản build CRA ở cổng 80, proxy `/api` sang `backend:8000`; SPA fallback cho mọi path.

- [ ] **Step 1: Viết `frontend/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # BrowserRouter: F5 o /active hay /resetPassword phai tra ve index.html,
    # neu khong nginx tra 404 va nguoi dung mat trang.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cung origin voi trang -> khong con CORS, khong lo REACT_APP_API_URL tro sai may.
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        # Backend dat TRUST_PROXY=1 nen rate limit doc dung IP client tu day.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(?:js|css|png|jpg|svg|ico|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 2: Viết `frontend/Dockerfile` và `frontend/.dockerignore`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Duong dan tuong doi: request di qua chinh nginx cua container nay.
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
```

`frontend/.dockerignore`:

```
node_modules
build
.env
.DS_Store
```

- [ ] **Step 3: Build và smoke test trong VM**

```bash
vagrant ssh manager -c '
  set -e
  sudo docker build -t capstone-frontend:test /vagrant/frontend
  sudo docker rm -f smoke-fe >/dev/null 2>&1 || true
  sudo docker run -d --name smoke-fe -p 18080:80 capstone-frontend:test
  sleep 5
  # 1) trang chu tra HTML cua CRA
  curl -fsS http://127.0.0.1:18080/ | grep -q "<div id=\"root\">" && echo "OK_INDEX"
  # 2) SPA fallback: /active cung phai tra index.html chu khong 404
  curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18080/active
  sudo docker rm -f smoke-fe
'
```

Kỳ vọng: `OK_INDEX` và `200`.

- [ ] **Step 4: Commit**

```bash
git add frontend/nginx.conf frontend/Dockerfile frontend/.dockerignore
git commit -m "feat(frontend): nginx phuc vu CRA build + proxy /api + SPA fallback"
```

---

## Phase 3 — CI: test và build image

### Task 10: Workflow — job `test`

**Files:**
- Create: `.github/workflows/ci-cd.yml`

**Interfaces:**
- Consumes: `e2e/` (40 khẳng định).
- Produces: workflow tên `CI/CD`; job `test` (Task 15 và 17 thêm job sau khi job này xanh); cache binary mongod cho những lần chạy sau.

- [ ] **Step 1: Viết `.github/workflows/ci-cd.yml` với chỉ job `test`**

```yaml
name: CI/CD

on:
  push:
  pull_request:
  workflow_dispatch:
    inputs:
      image_tag:
        description: "Tag image de deploy lai (rollback). Bo trong = dung ban moi nhat cua lan chay nay."
        required: false

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Test (e2e API)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: |
            backend/package-lock.json
            e2e/package-lock.json

      # e2e tai binary mongod that (~80MB) o lan dau; cache lai cho cac lan sau.
      - name: Cache binary mongod
        uses: actions/cache@v4
        with:
          path: ~/.cache/mongodb-binaries
          key: mongodb-binaries-${{ runner.os }}-${{ hashFiles('e2e/package-lock.json') }}

      - name: Cai dependency
        run: |
          npm ci --prefix backend
          npm ci --prefix e2e

      - name: Chay e2e tang API
        run: npm --prefix e2e run test:api
```

- [ ] **Step 2: Push lên một nhánh phụ để kiểm tra (Review Focus #4)**

```bash
git checkout -b ci/test-job
git add .github/workflows/ci-cd.yml
git commit -m "ci: workflow voi job test"
git push -u origin ci/test-job
gh run list --branch ci/test-job --limit 3
```

Kỳ vọng: **chỉ** job `Test (e2e API)` chạy và xanh; không có job build/deploy. Kiểm tra tiếp bằng PR (nếu muốn):

```bash
gh pr create --fill --base main --head ci/test-job
gh run list --limit 3   # PR cung chi chay job test
```

- [ ] **Step 3: Merge vào main và commit**

```bash
gh pr merge --merge --delete-branch || git checkout main
git log --oneline -3
```

- [ ] **Step 4: Commit (nếu chưa merge qua PR)**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: job test chay e2e tren moi push va PR"
```

### Task 11: Workflow — job `build` đẩy image lên GHCR

**Files:**
- Modify: `.github/workflows/ci-cd.yml` (thêm job `build`)

**Interfaces:**
- Consumes: job `test` (Task 10).
- Produces: image `ghcr.io/tynab/capstone-project-backend:<tag>` và `...-frontend:<tag>` với `<tag>` = 7 ký tự đầu của SHA, cộng thêm `latest`; các Task 12/15 dùng lại tên này.

- [ ] **Step 1: Thêm job `build` (chỉ chạy khi push lên `main`)**

```yaml
  build:
    name: Build va push image
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - name: Dang nhap GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # Ten image tren GHCR phai viet thuong toan bo; GitHub tra "Tynab" o
      # github.repository nen phai ha chu thuong, khong la build do ngay buoc push.
      - name: Tinh ten image
        id: names
        run: |
          owner=$(echo "${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')
          echo "backend=ghcr.io/${owner}/capstone-project-backend" >> "$GITHUB_OUTPUT"
          echo "frontend=ghcr.io/${owner}/capstone-project-frontend" >> "$GITHUB_OUTPUT"
          echo "tag=$(echo '${{ github.sha }}' | cut -c1-7)" >> "$GITHUB_OUTPUT"

      - name: Build va push backend
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: |
            ${{ steps.names.outputs.backend }}:${{ steps.names.outputs.tag }}
            ${{ steps.names.outputs.backend }}:latest
          cache-from: type=gha,scope=backend
          cache-to: type=gha,mode=max,scope=backend

      - name: Build va push frontend
        uses: docker/build-push-action@v6
        with:
          context: ./frontend
          push: true
          build-args: |
            REACT_APP_API_URL=/api
          tags: |
            ${{ steps.names.outputs.frontend }}:${{ steps.names.outputs.tag }}
            ${{ steps.names.outputs.frontend }}:latest
          cache-from: type=gha,scope=frontend
          cache-to: type=gha,mode=max,scope=frontend
```

- [ ] **Step 2: Push lên main và kiểm tra image trong GHCR**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: job build day image len GHCR (tag sha + latest)"
git push origin main
gh run watch
gh api "/user/packages/container/capstone-project-backend/versions" --jq '.[0].metadata.container.tags'
```

Kỳ vọng: tag chứa cả `latest` và `<sha 7 ký tự>`.

- [ ] **Step 3: Đặt package public để cả 2 node kéo được (khác spec §6.2 — xem Global Constraints)**

```bash
gh api -X PATCH "/user/packages/container/capstone-project-backend/visibility" -f visibility=public
gh api -X PATCH "/user/packages/container/capstone-project-frontend/visibility" -f visibility=public
# Kiem tra: trong VM manager keo duoc khong can login
vagrant ssh manager -c "sudo docker pull ghcr.io/tynab/capstone-project-backend:latest"
```

Kỳ vọng: pull thành công, không hỏi đăng nhập.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: build va push image len GHCR" || true
```

---

## Phase 4 — Stack và giám sát

### Task 12: Secrets, `.env` và `deploy.sh`

**Files:**
- Create: `infra/ansible/roles/app/tasks/main.yml`, `infra/ansible/roles/app/templates/env.j2`, `infra/ansible/roles/app/templates/deploy.sh.j2`
- Modify: `infra/ansible/site.yml` (thêm play manager cho role `app`)

**Interfaces:**
- Consumes: swarm manager (Task 4), tên image GHCR (Task 11).
- Produces: `/opt/capstone/.env` (600, sinh một lần), `/opt/capstone/deploy.sh <tag>` — dùng ở Task 13/14 (deploy stack) và Task 17 (CI gọi).

- [ ] **Step 1: Viết `infra/ansible/roles/app/tasks/main.yml`**

```yaml
---
- name: Tao thu muc /opt/capstone
  file:
    path: "{{ app_dir }}"
    state: directory
    owner: vagrant
    group: vagrant
    mode: "0750"

- name: Tao thu muc secrets
  file:
    path: "{{ app_dir }}/secrets"
    state: directory
    owner: vagrant
    mode: "0700"

# lookup('password') GHI file o lan dau va DOC LAI o cac lan sau -> provision lai
# khong doi mat khau. Gioi han charset vi cac gia tri nay duoc nhung vao .env,
# shell source no, roi noi suy vao compose: ky tu dac biet se lam vo ca ba buoc.
- name: Sinh secret (giu nguyen neu da co)
  set_fact:
    jwt_secret: "{{ lookup('password', app_dir + '/secrets/jwt_secret chars=ascii_letters,digits length=48') }}"
    mongo_root_password: "{{ lookup('password', app_dir + '/secrets/mongo_root chars=ascii_letters,digits length=32') }}"
    grafana_admin_password: "{{ lookup('password', app_dir + '/secrets/grafana_admin chars=ascii_letters,digits length=24') }}"

- name: Ghi /opt/capstone/.env
  template:
    src: env.j2
    dest: "{{ app_dir }}/.env"
    owner: vagrant
    mode: "0600"

- name: Ghi deploy.sh
  template:
    src: deploy.sh.j2
    dest: "{{ app_dir }}/deploy.sh"
    owner: vagrant
    mode: "0755"
```

- [ ] **Step 2: Viết `infra/ansible/roles/app/templates/env.j2`**

```jinja
# Sinh boi Ansible (infra/ansible/roles/app). KHONG sua tay: lan provision sau se ghi de.
# Moi gia tri deu la chu/thuong va so -> an toan khi `set -a; . .env` va khi noi suy compose.
JWT_SECRET="{{ jwt_secret }}"
MONGO_ROOT_USERNAME="capstone"
MONGO_ROOT_PASSWORD="{{ mongo_root_password }}"
MONGO_URI="mongodb://capstone:{{ mongo_root_password }}@mongo:27017/todo?authSource=admin"
GRAFANA_ADMIN_USER="admin"
GRAFANA_ADMIN_PASSWORD="{{ grafana_admin_password }}"
FRONTEND_URL="{{ app_url }}"
CORS_ORIGIN="{{ app_url }}"
# nginx nam truoc backend -> bat buoc, neu khong rate limit dem chung mot IP.
TRUST_PROXY="1"
LOG_LEVEL="info"
# Mailpit trong stack; doi SMTP_HOST rong de quay lai dung Gmail nhu cu.
SMTP_HOST="mailpit"
SMTP_PORT="1025"
SMTP_SECURE="false"
SMTP_USER=""
SMTP_PASS=""
# Image: mac dinh la ban latest tren GHCR; job deploy se ghi de bang tag sha.
BACKEND_REPO="ghcr.io/tynab/capstone-project-backend"
FRONTEND_REPO="ghcr.io/tynab/capstone-project-frontend"
BACKEND_IMAGE="${BACKEND_REPO}:latest"
FRONTEND_IMAGE="${FRONTEND_REPO}:latest"
```

- [ ] **Step 3: Viết `infra/ansible/roles/app/templates/deploy.sh.j2`**

```bash
#!/usr/bin/env bash
# Deploy stack len swarm. Dung chung cho Ansible (lan dau) va cho CI (cac lan sau)
# nen hanh vi deploy giong het nhau o moi duong vao.
set -euo pipefail
cd {{ app_dir }}

# Nguon env tuong minh: khong dua vao viec `docker stack deploy` co tu doc .env hay khong.
set -a
. {{ app_dir }}/.env
set +a

TAG="${1:-}"
if [ -n "$TAG" ]; then
  export BACKEND_IMAGE="${BACKEND_REPO}:${TAG}"
  export FRONTEND_IMAGE="${FRONTEND_REPO}:${TAG}"
fi

echo "Deploy {{ stack_name }} voi backend=${BACKEND_IMAGE} frontend=${FRONTEND_IMAGE}"
docker stack deploy -c {{ app_dir }}/docker-stack.yml {{ stack_name }}

# Cho service hoi tu (toi da 180s) truoc khi ket luan.
for i in $(seq 1 36); do
  replicas=$(docker stack services {{ stack_name }} --format '{{ "{{" }}.Name{{ "}}" }} {{ "{{" }}.Replicas{{ "}}" }}' || true)
  echo "$replicas"
  if [ -n "$replicas" ] && ! echo "$replicas" | awk '{split($2,a,"/"); if (a[1] != a[2]) exit 1}'; then
    echo "Tat ca service da du replica sau ${i} lan kiem tra."
    break
  fi
  sleep 5
done

# Xac nhan qua chinh nginx: mot request di het duong nginx -> backend -> DB.
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null; then
    echo "Healthcheck qua nginx: OK"
    exit 0
  fi
  sleep 5
done

echo "LOI: app khong tra /api/health sau khi deploy. Trang thai service:"
docker stack services {{ stack_name }}
docker service ps --no-trunc $(docker stack services {{ stack_name }} -q | head -1) || true
exit 1
```

- [ ] **Step 4: Thêm play `app` vào `site.yml`**

```yaml
- name: Sinh secret va script deploy
  hosts: swarm_manager
  gather_facts: false
  roles:
    - app
```

- [ ] **Step 5: Chạy và kiểm chứng secret (Review Focus #1 và #2)**

```bash
vagrant provision --provision-with ansible

# #1 charset: khong duoc co ky tu ngoai [A-Za-z0-9] trong cac gia tri secret
vagrant ssh manager -c "sudo grep -E '^(JWT_SECRET|MONGO_ROOT_PASSWORD|GRAFANA_ADMIN_PASSWORD)=' /opt/capstone/.env | grep -Ev '\"[A-Za-z0-9]+\"$' && echo CO_KY_TU_LA || echo OK_CHUAN"
# .env phai source duoc bang shell (khong vo cu phap)
vagrant ssh manager -c "sudo bash -c 'set -a; . /opt/capstone/.env; set +a; echo SOURCE_OK'"
# quyen file
vagrant ssh manager -c "sudo stat -c '%a %n' /opt/capstone/.env"   # 600

# #2 idempotency: provision lai, secret KHONG doi
before=$(vagrant ssh manager -c "sudo cat /opt/capstone/.env" | sha256sum)
vagrant provision --provision-with ansible >/dev/null
after=$(vagrant ssh manager -c "sudo cat /opt/capstone/.env" | sha256sum)
[ "$before" = "$after" ] && echo "OK_SECRET_KHONG_DOI" || echo "LOI_SECRET_DA_DOI"
```

- [ ] **Step 6: Commit**

```bash
git add infra/ansible/
git commit -m "feat(ansible): role app sinh secret mot lan + deploy.sh dung chung cho Ansible va CI"
```

### Task 13: Stack — app 4 service chạy thật

**Files:**
- Create: `infra/stack/docker-stack.yml` (phần app), `infra/ansible/roles/app/tasks/stack.yml` (copy file stack sang `/opt/capstone`)
- Modify: `infra/ansible/roles/app/tasks/main.yml` (include stack.yml), `infra/ansible/site.yml`

**Interfaces:**
- Consumes: `/opt/capstone/.env` + `deploy.sh` (Task 12), image GHCR (Task 11).
- Produces: service `mongo`, `backend`, `frontend`, `mailpit` trong stack `capstone`; hostname `backend` (Task 9's nginx proxy), `mailpit` (Task 12's `SMTP_HOST`), volume `capstone_mongo_data`.

- [ ] **Step 1: Viết `infra/stack/docker-stack.yml` (phần app)**

```yaml
# Stack cua bai cuoi khoa. Bien ${...} duoc noi suy tu /opt/capstone/.env
# do deploy.sh source truoc khi goi `docker stack deploy`.
version: "3.8"

networks:
  capstone:
    external: true

volumes:
  mongo_data:

services:
  mongo:
    image: mongo:6
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_ROOT_USERNAME}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASSWORD}
    volumes:
      - mongo_data:/data/db
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == worker]
      restart_policy:
        condition: on-failure

  backend:
    image: ${BACKEND_IMAGE}
    environment:
      MONGO_URI: ${MONGO_URI}
      JWT_SECRET: ${JWT_SECRET}
      PORT: "8000"
      FRONTEND_URL: ${FRONTEND_URL}
      CORS_ORIGIN: ${CORS_ORIGIN}
      TRUST_PROXY: ${TRUST_PROXY}
      LOG_LEVEL: ${LOG_LEVEL}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_SECURE: ${SMTP_SECURE}
    networks: [capstone]
    deploy:
      replicas: 2
      placement:
        preferences:
          - spread: node.id
      update_config:
        order: start-first
        failure_action: rollback
        delay: 5s
      restart_policy:
        condition: on-failure

  frontend:
    image: ${FRONTEND_IMAGE}
    ports:
      - target: 80
        published: 80
        mode: ingress
    networks: [capstone]
    deploy:
      replicas: 2
      placement:
        preferences:
          - spread: node.id
      update_config:
        order: start-first
        failure_action: rollback
        delay: 5s

  mailpit:
    image: axllent/mailpit
    ports:
      - target: 8025
        published: 8025
        mode: ingress
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == manager]
```

- [ ] **Step 2: Thêm `infra/ansible/roles/app/tasks/stack.yml` và include**

`stack.yml`:

```yaml
---
- name: Copy file stack va config giam sat
  copy:
    src: "{{ playbook_dir }}/../../stack/"
    dest: "{{ app_dir }}/"
    owner: vagrant
    mode: "0644"
  notify: deploy stack
```

Trong `tasks/main.yml` thêm cuối file:

```yaml
- name: Dat file stack
  include_tasks: stack.yml
```

Tạo `infra/ansible/roles/app/handlers/main.yml`:

```yaml
---
- name: deploy stack
  command: "{{ app_dir }}/deploy.sh"
  become: true
  become_user: vagrant
```

- [ ] **Step 3: Deploy và kiểm chứng app chạy 2 node**

```bash
vagrant provision --provision-with ansible
vagrant ssh manager -c "sudo docker stack services capstone"
```

Kỳ vọng: `capstone_backend 2/2`, `capstone_frontend 2/2`, `capstone_mongo 1/1`, `capstone_mailpit 1/1`.

```bash
# Review Focus: replica phai trai ra 2 node chu khong don mot cho
vagrant ssh manager -c "sudo docker service ps capstone_backend --format 'table {{.Name}}\t{{.Node}}\t{{.CurrentState}}'"
vagrant ssh manager -c "sudo docker service ps capstone_frontend --format 'table {{.Name}}\t{{.Node}}\t{{.CurrentState}}'"
```

Kỳ vọng: mỗi service có 1 task ở `swarm-manager` và 1 task ở `swarm-worker`.

- [ ] **Step 4: Kiểm chứng app từ Windows (spec §9 bước 3, 4, 5)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/active     # 200 (SPA fallback)
curl -s http://192.168.56.10/api/health                                  # {"status":"ok"}
```

Rồi bằng tay trên trình duyệt: đăng ký → thêm task → **F5** → task còn nguyên → Quên mật khẩu → mở http://192.168.56.10:8025 thấy mail → bấm link reset → đổi mật khẩu → đăng nhập lại bằng mật khẩu mới.

- [ ] **Step 5: Kiểm dữ liệu không mất khi deploy lại (Review Focus #2)**

```bash
# Dem so task trong DB (chay trong VM, doc mat khau tu .env)
vagrant ssh manager -c 'sudo bash -c ". /opt/capstone/.env; docker exec \$(docker ps -q -f name=capstone_mongo) mongosh --quiet -u \$MONGO_ROOT_USERNAME -p \$MONGO_ROOT_PASSWORD --authenticationDatabase admin --eval \"db.getSiblingDB(\\\"todo\\\").tasks.countDocuments()\""'
vagrant ssh manager -c "sudo /opt/capstone/deploy.sh"
# Dem lai: so task phai bang so vua roi (du lieu nam trong volume, khong bi xoa khi deploy lai)
```

- [ ] **Step 6: Commit**

```bash
git add infra/stack/docker-stack.yml infra/ansible/roles/app/
git commit -m "feat(stack): mongo + backend + frontend + mailpit, replica trai 2 node"
```

### Task 14: Giám sát — Prometheus, exporters, blackbox

**Files:**
- Create: `infra/stack/prometheus.yml`, `infra/stack/blackbox.yml`
- Modify: `infra/stack/docker-stack.yml` (thêm `prometheus`, `blackbox-exporter`, `node-exporter`, `cadvisor`, `mongodb-exporter` + volume)

**Interfaces:**
- Consumes: `MONGO_URI` (Task 12), port host 9100/8080 của node-exporter/cAdvisor.
- Produces: Prometheus ở `:9090` scrape 5 job; dữ liệu cho Grafana của Task 15.

- [ ] **Step 1: Viết `infra/stack/prometheus.yml`**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  # node-exporter/cAdvisor chay mode global + publish cong kieu host, nen moi
  # node co endpoint rieng -> scrape theo IP host chu khong theo ten service.
  - job_name: node
    static_configs:
      - targets: ["192.168.56.10:9100", "192.168.56.11:9100"]

  - job_name: cadvisor
    static_configs:
      - targets: ["192.168.56.10:8080", "192.168.56.11:8080"]

  - job_name: mongodb
    static_configs:
      - targets: ["mongodb-exporter:9216"]

  # blackbox do tu ben ngoai: mot request di het nginx -> backend.
  - job_name: blackbox
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets: ["http://frontend:80/", "http://backend:8000/api/health"]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

- [ ] **Step 2: Viết `infra/stack/blackbox.yml`**

```yaml
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      preferred_ip_protocol: ip4
```

- [ ] **Step 3: Thêm 5 service giám sát vào `docker-stack.yml`**

```yaml
  prometheus:
    image: prom/prometheus:v2.53.0
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.retention.time=15d
    volumes:
      - prom_data:/prometheus
    ports:
      - target: 9090
        published: 9090
        mode: ingress
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == manager]
    configs:
      - source: prometheus_yml
        target: /etc/prometheus/prometheus.yml
        mode: 0444

  grafana:
    image: grafana/grafana:11.1.0
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
      GF_USERS_ALLOW_SIGN_UP: "false"
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - target: 3000
        published: 3001
        mode: ingress
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == manager]

  mongodb-exporter:
    image: percona/mongodb_exporter:0.40
    command: ["--collect-all", "--discovering-mode"]
    environment:
      MONGODB_URI: ${MONGO_URI}
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == worker]

  blackbox-exporter:
    image: prom/blackbox-exporter:v0.25.0
    configs:
      - source: blackbox_yml
        target: /etc/blackbox_exporter/config.yml
        mode: 0444
    networks: [capstone]
    deploy:
      replicas: 1
      placement:
        constraints: [node.role == manager]

  # global: moi node mot container -> do dung phan cung cua tung may.
  node-exporter:
    image: prom/node-exporter:v1.8.1
    command:
      - --path.procfs=/host/proc
      - --path.sysfs=/host/sys
      - --path.rootfs=/host/root
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/host/root:ro
    ports:
      - target: 9100
        published: 9100
        mode: host
    networks: [capstone]
    deploy:
      mode: global

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    ports:
      - target: 8080
        published: 8080
        mode: host
    networks: [capstone]
    deploy:
      mode: global
```

Thêm vào `volumes:` đầu file: `prom_data:` và `grafana_data:`.

Thêm vào cuối file:

```yaml
configs:
  prometheus_yml:
    file: ./prometheus.yml
  blackbox_yml:
    file: ./blackbox.yml
```

`docker stack deploy` không hỗ trợ `pid: host`/`privileged` → giữ đúng như trên; chấp nhận thiếu vài chỉ số chi tiết của cAdvisor.

- [ ] **Step 4: Deploy và đối chiếu trạng thái mọi service**

```bash
vagrant provision --provision-with ansible
vagrant ssh manager -c "sudo docker stack services capstone"
```

Kỳ vọng: 9 dòng, tất cả đủ replica (`node-exporter`/`cadvisor` hiện `2/2`).

- [ ] **Step 5: Kiểm tra Prometheus thực sự scrape được**

```bash
# Tat ca target phai UP
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | \
  python -c "import json,sys; d=json.load(sys.stdin); [print(t['labels'].get('job'), t['scrapeUrl'], t['health']) for t in d['data']['activeTargets']]"
```

Kỳ vọng: mọi dòng `health = up` (job `node` 2 target, `cadvisor` 2, `mongodb` 1, `blackbox` 2). Nếu `down`, xem `docker service logs capstone_prometheus`.

- [ ] **Step 6: Commit**

```bash
git add infra/stack/
git commit -m "feat(monitoring): prometheus + node-exporter + cadvisor + mongodb-exporter + blackbox"
```

### Task 15: Grafana — datasource và dashboard nạp tự động

**Files:**
- Create: `infra/stack/grafana/provisioning/datasources/prometheus.yml`, `infra/stack/grafana/provisioning/dashboards/dashboards.yml`, `infra/stack/grafana/dashboards/capstone-overview.json`
- Modify: `infra/stack/docker-stack.yml` (config + mount cho grafana)

**Interfaces:**
- Consumes: Prometheus (Task 14).
- Produces: dashboard uid `capstone-overview` với 5 panel, tự nạp khi khởi động — không thao tác tay.

- [ ] **Step 1: Viết provisioning datasource**

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus          # uid co dinh de dashboard tham chieu duoc
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

- [ ] **Step 2: Viết provider dashboards**

```yaml
apiVersion: 1
providers:
  - name: capstone
    orgId: 1
    folder: ""
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
```

- [ ] **Step 3: Viết dashboard `capstone-overview.json`**

```json
{
  "uid": "capstone-overview",
  "title": "Capstone overview",
  "timezone": "browser",
  "refresh": "30s",
  "time": { "from": "now-1h", "to": "now" },
  "panels": [
    {
      "id": 1, "type": "timeseries", "title": "CPU tung node (%)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{
        "refId": "A",
        "expr": "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)"
      }]
    },
    {
      "id": 2, "type": "timeseries", "title": "RAM tung node (%)",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{
        "refId": "A",
        "expr": "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)"
      }]
    },
    {
      "id": 3, "type": "timeseries", "title": "CPU container cua stack (%)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{
        "refId": "A",
        "expr": "sum by (name) (rate(container_cpu_usage_seconds_total{name=~\"capstone_.*\"}[5m])) * 100"
      }]
    },
    {
      "id": 4, "type": "stat", "title": "MongoDB dang chay",
      "gridPos": { "h": 8, "w": 6, "x": 12, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "mongodb_up" }]
    },
    {
      "id": 5, "type": "stat", "title": "Dich vu up (blackbox)",
      "gridPos": { "h": 8, "w": 6, "x": 18, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "probe_success" }]
    }
  ]
}
```

- [ ] **Step 4: Nạp provisioning vào service grafana trong `docker-stack.yml`**

```yaml
    configs:
      - source: grafana_datasource
        target: /etc/grafana/provisioning/datasources/prometheus.yml
        mode: 0444
      - source: grafana_dashboards_provider
        target: /etc/grafana/provisioning/dashboards/dashboards.yml
        mode: 0444
      - source: grafana_dashboard_capstone
        target: /var/lib/grafana/dashboards/capstone-overview.json
        mode: 0444
```

và trong khối `configs:` cuối file:

```yaml
  grafana_datasource:
    file: ./grafana/provisioning/datasources/prometheus.yml
  grafana_dashboards_provider:
    file: ./grafana/provisioning/dashboards/dashboards.yml
  grafana_dashboard_capstone:
    file: ./grafana/dashboards/capstone-overview.json
```

- [ ] **Step 5: Deploy và kiểm chứng dashboard tự nạp**

```bash
vagrant provision --provision-with ansible
# Lay mat khau roi hoi Grafana API — khong can bam tay
vagrant ssh manager -c "sudo bash -c '. /opt/capstone/.env; curl -s -u admin:\$GRAFANA_ADMIN_PASSWORD \"http://127.0.0.1:3001/api/search?query=Capstone\"'"
```

Kỳ vọng: JSON chứa `"uid":"capstone-overview"`. Kiểm tra 5 panel có dữ liệu bằng mắt tại http://192.168.56.10:3001 (đăng nhập `admin` + mật khẩu trong `/opt/capstone/.env`) — mỗi panel phải có đường/số, không được "No data".

- [ ] **Step 6: Commit**

```bash
git add infra/stack/grafana/ infra/stack/docker-stack.yml
git commit -m "feat(monitoring): grafana nap datasource + dashboard tu dong"
```

### Task 16: Tài liệu vận hành và checklist kiểm chứng hạ tầng

**Files:**
- Create: `infra/README.md`
- Modify: `CLAUDE.md` (mục hạ tầng), `backend/CLAUDE.md` nếu có nhắc Docker

**Interfaces:**
- Consumes: mọi thứ từ Task 1–15.
- Produces: tài liệu để người sau dựng lại và vận hành; nguồn sự thật cho các agent đọc.

- [ ] **Step 1: Viết `infra/README.md`**

Nội dung bắt buộc có (viết bằng tiếng Việt, kèm lý do):

1. Sơ đồ 2 VM, IP, cổng, và **vì sao** Ansible chạy trong manager chứ không trên Windows.
2. Yêu cầu máy: Windows 11, VT-x, ~10GB đĩa cho 2 VM.
3. Quy trình: `infra\setup.cmd` (lần đầu) → `vagrant up` → `vagrant provision --provision-with ansible`; và `infra\destroy.cmd` để dựng lại (**mất dữ liệu Mongo**).
4. Vận hành: xem log service, deploy tay một tag, rollback qua `workflow_dispatch`, lấy secret, `mongodump` trước khi destroy:

```bash
vagrant ssh manager -c "sudo docker exec \$(sudo docker ps -q -f name=capstone_mongo) mongodump --archive=/tmp/backup.gz --gzip -u capstone -p \$MONGO_ROOT_PASSWORD --authenticationDatabase admin" # trong .env
vagrant ssh manager -c "sudo docker cp \$(sudo docker ps -q -f name=capstone_mongo):/tmp/backup.gz /tmp/backup.gz"
```

5. Bảng xử lý sự cố — viết đúng 4 dòng này kèm nguyên nhân:

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Prometheus target `down` | Prometheus/target khác overlay network, hoặc node-exporter chưa lên ở node đó | `docker stack services capstone`, `docker service logs capstone_prometheus` |
| Service `0/1` hoặc `0/2` | Thiếu RAM/CPU, image kéo lỗi, hoặc constraint không khớp node | `docker service ps --no-trunc <service>` xem cột `ERROR` |
| Job `deploy` treo ở `queued` | VM tắt hoặc runner chưa online | `gh api repos/Tynab/capstone-project/actions/runners`, dựng lại bằng `infra\setup.cmd` |
| F5 ở `/active` trả 404 | nginx thiếu `try_files ... /index.html` (SPA fallback) | kiểm `frontend/nginx.conf` và build lại image |
6. Khác spec §6.2: package GHCR để public — nêu rõ và cách quay lại private (`--with-registry-auth` + `docker login`).

- [ ] **Step 2: Cập nhật `CLAUDE.md` gốc**

- Mục "Dự án này là gì": bỏ câu "Trong repo **chưa có hạng mục nào**", thay bằng mô tả hạ tầng đã có: `infra/` (Vagrant + Ansible → swarm 2 node), `.github/workflows/ci-cd.yml` (3 job), và nhắc `infra/README.md` là tài liệu vận hành.
- Mục "Bản đồ repo": thêm dòng `infra/` vào bảng.
- Mục "Kiểm chứng trước khi báo xong": thêm bước "đụng vào `infra/` → chạy `vagrant provision --provision-with ansible` và `infra/README.md` mục kiểm tra".

- [ ] **Step 3: Chạy trọn checklist spec §9 (phần hạ tầng)**

```bash
vagrant status | grep -c running          # 2
vagrant ssh manager -c "sudo docker node ls" | grep -c Ready
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/active
curl -s http://192.168.56.10/api/health
curl -s "http://192.168.56.10:9090/api/v1/targets?state=active" | grep -c '"health":"up"'
cd e2e && npm run test:api | tail -1      # 40/40 PASS
```

- [ ] **Step 4: Commit**

```bash
git add infra/README.md CLAUDE.md backend/CLAUDE.md
git commit -m "docs(infra): README van hanh + cap nhat manifest ve ha tang moi"
```

---

## Phase 5 — Runner và deploy tự động

### Task 17: Ansible — cài và đăng ký GitHub runner

**Files:**
- Create: `infra/ansible/roles/runner/tasks/main.yml`, `infra/ansible/roles/runner/defaults/main.yml`
- Modify: `infra/ansible/site.yml` (thêm play runner)

**Interfaces:**
- Consumes: `runner_token` (extra-var từ Vagrant, Task 1/2), Docker (Task 3).
- Produces: runner `Online` với nhãn `self-hosted, linux, x64, swarm-manager` — Task 18 dùng `runs-on: [self-hosted, swarm-manager]`.

- [ ] **Step 1: Viết `infra/ansible/roles/runner/defaults/main.yml`**

```yaml
---
runner_user: ghrunner
runner_home: /home/ghrunner
runner_version: "2.317.0"
runner_dir: "{{ runner_home }}/actions-runner"
runner_labels: "swarm-manager"
repo_url: "https://github.com/Tynab/capstone-project"
```

- [ ] **Step 2: Viết `infra/ansible/roles/runner/tasks/main.yml`**

```yaml
---
- name: Runner da dang ky chua
  stat:
    path: "{{ runner_dir }}/.runner"
  register: runner_registered
  become: true

- name: Tao user rieng cho runner
  user:
    name: "{{ runner_user }}"
    groups: docker
    shell: /bin/bash
    create_home: true
  become: true

- name: Tai bo cai runner
  unarchive:
    src: "https://github.com/actions/runner/releases/download/v{{ runner_version }}/actions-runner-linux-x64-{{ runner_version }}.tar.gz"
    dest: "{{ runner_dir }}"
    remote_src: true
    owner: "{{ runner_user }}"
    group: "{{ runner_user }}"
    creates: "{{ runner_dir }}/config.sh"
  become: true
  when: not runner_registered.stat.exists

- name: Cai dependency cua runner
  command: "{{ runner_dir }}/bin/installdependencies.sh"
  args:
    creates: /usr/share/dotnet  # goi y idempotency: script tu bo qua neu da cai
  become: true
  when: not runner_registered.stat.exists

- name: Dang ky runner voi repo
  command: >-
    ./config.sh --url {{ repo_url }} --token {{ runner_token }}
    --name swarm-manager-1 --labels {{ runner_labels }}
    --unattended --replace
  args:
    chdir: "{{ runner_dir }}"
  become: true
  become_user: "{{ runner_user }}"
  when:
    - not runner_registered.stat.exists
    - runner_token | length > 0

- name: Canh bao khi thieu token
  debug:
    msg: "THIEU runner_token -> bo qua dang ky runner. Chay lai: $env:RUNNER_TOKEN = (gh api -X POST repos/Tynab/capstone-project/actions/runners/registration-token --jq .token); vagrant provision --provision-with ansible"
  when:
    - not runner_registered.stat.exists
    - runner_token | length == 0

- name: Cai runner thanh systemd service
  shell: "{{ runner_dir }}/svc.sh install {{ runner_user }} && {{ runner_dir }}/svc.sh start"
  args:
    chdir: "{{ runner_dir }}"
  register: svc
  changed_when: "'already installed' not in svc.stdout"
  become: true
  when: runner_registered.stat.exists or runner_token | length > 0
```

- [ ] **Step 3: Thêm play runner vào `site.yml`**

```yaml
- name: Cai GitHub self-hosted runner tren manager
  hosts: swarm_manager
  gather_facts: false
  roles:
    - runner
```

- [ ] **Step 4: Chạy và kiểm chứng runner Online**

```bash
# Lay token moi (token chi song ~1 gio)
export RUNNER_TOKEN=$(gh api -X POST repos/Tynab/capstone-project/actions/runners/registration-token --jq .token)
vagrant provision --provision-with ansible
gh api repos/Tynab/capstone-project/actions/runners --jq '.runners[] | "\(.name) \(.status) \(.labels[].name)"'
```

Kỳ vọng: `swarm-manager-1 online ... swarm-manager`. Chạy provision lần hai: task đăng ký bị **skip** (đã có `.runner`).

- [ ] **Step 5: Commit**

```bash
git add infra/ansible/roles/runner/ infra/ansible/site.yml
git commit -m "feat(ci): role runner cai va dang ky GitHub self-hosted runner"
```

### Task 18: Job `deploy` + nút rollback

**Files:**
- Modify: `.github/workflows/ci-cd.yml` (thêm job `deploy`)

**Interfaces:**
- Consumes: runner nhãn `swarm-manager` (Task 17), `/opt/capstone/deploy.sh` (Task 12), image GHCR (Task 11).
- Produces: deploy tự động khi push `main`; rollback thủ công qua `workflow_dispatch` với `image_tag`.

- [ ] **Step 1: Thêm job `deploy`**

```yaml
  deploy:
    name: Deploy len swarm
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: [self-hosted, swarm-manager]
    timeout-minutes: 15
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - name: Deploy tag vua build
        run: /opt/capstone/deploy.sh "${{ needs.build.outputs.tag }}"

  deploy-manual:
    name: Deploy thu cong (rollback)
    if: github.event_name == 'workflow_dispatch' && inputs.image_tag != ''
    runs-on: [self-hosted, swarm-manager]
    timeout-minutes: 15
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - name: Deploy tag duoc chon
        run: /opt/capstone/deploy.sh "${{ inputs.image_tag }}"
```

- [ ] **Step 2: Cho job `build` xuất tag ra output**

Trong job `build`, thêm `outputs` và `id`:

```yaml
  build:
    name: Build va push image
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.names.outputs.tag }}
```

(và giữ nguyên `id: names` ở step "Tinh ten image" đã có từ Task 11.)

- [ ] **Step 3: Push và kiểm chứng deploy tự động**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: job deploy tren self-hosted runner + nut rollback qua workflow_dispatch"
git push origin main
gh run watch
```

Kỳ vọng: 3 job xanh liên tiếp; log job `deploy` in ra `Deploy capstone voi backend=ghcr.io/tynab/...:sha` rồi `Healthcheck qua nginx: OK`.

Kiểm chứng app thật sự đổi: sửa một chữ hiển thị trong `frontend/src/components/Header.jsx`, push, chờ pipeline xong, mở http://192.168.56.10 thấy chữ mới.

- [ ] **Step 4: Kiểm chứng rollback**

```bash
# Lay tag cua lan deploy truoc do (xem lich su run hoac GHCR)
gh run list --workflow ci-cd.yml --limit 5
gh workflow run ci-cd.yml -f image_tag=<tag-cu-7-ky-tu>
gh run watch
```

Kỳ vọng: app quay về phiên bản trước đó.

- [ ] **Step 5: Kiểm chứng Review Focus #5 — runner offline**

```bash
# Tat runner trong VM roi kich hoat deploy: job phai CHO (queued), khong treo vo han
vagrant ssh manager -c "sudo systemctl stop 'actions.runner.*' || sudo /home/ghrunner/actions-runner/svc.sh stop"
gh workflow run ci-cd.yml -f image_tag=latest
sleep 30
gh run list --limit 1                # trang thai phai la queued/waiting
gh run cancel $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
vagrant ssh manager -c "sudo /home/ghrunner/actions-runner/svc.sh start"
gh api repos/Tynab/capstone-project/actions/runners --jq '.runners[0].status'   # online lai
```

Kỳ vọng: job hiện `queued`, hủy được ngay; sau khi bật runner, `status = online`. Nếu runner chết hẳn (VM tắt), job sẽ đỏ sau `timeout-minutes: 15`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: deploy tu dong tren swarm + rollback bang workflow_dispatch"
```

---

## Tổng kết kiểm chứng cuối (spec §9)

Sau Task 18, chạy trọn một lượt và ghi lại kết quả thật:

```bash
vagrant status                                   # 1
vagrant ssh manager -c "sudo docker node ls"     # 2
vagrant ssh manager -c "sudo docker stack services capstone"   # 3
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.10/active          # 4
curl -s http://192.168.56.10/api/health                                       # 5
cd e2e && npm run test:api | tail -1                                          # 6
gh run list --limit 3                                                         # 7, 8
vagrant provision --provision-with ansible >/dev/null && \
  vagrant ssh manager -c "sudo cat /opt/capstone/.env" | sha256sum            # 9 (so voi truoc)
```

Bước 10 (đăng nhập Grafana xem dashboard, và luồng quên mật khẩu qua Mailpit) làm bằng tay trên trình duyệt — ghi ảnh chụp làm minh chứng nộp bài.
