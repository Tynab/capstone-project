# Dựng hạ tầng lab từ con số 0. Chạy lại nhiều lần vô hại: mỗi công cụ được
# kiểm tra độc lập nên máy cài thiếu một nửa (có VirtualBox, thiếu Vagrant)
# vẫn xử lý đúng.
#
# LƯU Ý VỀ NGÔN NGỮ: các chuỗi in ra màn hình cố ý viết KHÔNG DẤU. Console của
# Windows PowerShell 5.1 chạy codepage ibm850, không biểu diễn được ký tự có
# dấu tiếng Việt — đã thử và chúng biến thành "?". Comment thì vẫn tiếng Việt
# đầy đủ vì được đọc bằng editor/agent, không qua console.
# File này phải lưu dạng UTF-8 CÓ BOM để PowerShell 5.1 đọc đúng phần comment.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Have([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# Trình cài VirtualBox KHÔNG thêm thư mục của nó vào PATH (đã gặp thật trên máy
# này: VBoxManage.exe nằm đúng chỗ nhưng PATH không có), nên ngoài PATH phải dò
# thêm các đường dẫn cài đặt chuẩn. Không dò thì script báo sai thành "chưa cài"
# rồi hướng dẫn khởi động lại máy — sai hoàn toàn nguyên nhân.
function Resolve-Tool([string]$cmd, [string[]]$candidates) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
    return $null
}

function Add-ToProcessPath([string]$exePath) {
    $dir = Split-Path -Parent $exePath
    if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$dir;$env:Path" }
}

function Install-Winget([string]$id) {
    # VirtualBox cần quyền admin -> chạy tiến trình riêng để hiện UAC.
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
        "-NoProfile", "-Command",
        "winget install --id $id -e --accept-package-agreements --accept-source-agreements")
    if ($p.ExitCode -ne 0) { throw "winget install $id that bai (exit $($p.ExitCode))" }
}

function Refresh-Path {
    # Sau khi cài, PATH của tiến trình hiện tại chưa có công cụ mới.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

$vboxCandidates = @("$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe")
$vagrantCandidates = @("$env:ProgramFiles\Vagrant\bin\vagrant.exe",
                       "$env:ProgramFiles\HashiCorp\Vagrant\bin\vagrant.exe")

Write-Host "== 1/6 Kiem tra cong cu ==" -ForegroundColor Cyan
if (-not (Have winget)) { throw "Thieu winget (App Installer). Cai tu Microsoft Store roi chay lai." }

# Hai công cụ được kiểm tra ĐỘC LẬP: máy có thể đã có sẵn một trong hai.
$vboxExe = Resolve-Tool "VBoxManage" $vboxCandidates
if (-not $vboxExe) {
    Write-Host "Chua co VirtualBox -> cai (se hien UAC, bam Yes)..."
    Install-Winget "Oracle.VirtualBox"
    Refresh-Path
    $vboxExe = Resolve-Tool "VBoxManage" $vboxCandidates
}

$vagrantExe = Resolve-Tool "vagrant" $vagrantCandidates
if (-not $vagrantExe) {
    Write-Host "Chua co Vagrant -> cai (se hien UAC, bam Yes)..."
    Install-Winget "Hashicorp.Vagrant"
    Refresh-Path
    $vagrantExe = Resolve-Tool "vagrant" $vagrantCandidates
}

if (-not $vboxExe) { throw "Cai VirtualBox that bai hoac khong tim thay VBoxManage.exe." }
if (-not $vagrantExe) { throw "Cai Vagrant that bai hoac khong tim thay vagrant.exe." }
Add-ToProcessPath $vboxExe
Add-ToProcessPath $vagrantExe

# Kiểm tra driver thật sự chạy được — ĐÂY mới là ca cần khởi động lại máy.
# Chỉ kiểm tra sự tồn tại của file là chưa đủ để kết luận.
$driverOut = & $vboxExe list hostonlyifs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning "VirtualBox da cai nhung driver chua chay duoc (thuong la can KHOI DONG LAI may):"
    $driverOut | Select-Object -First 3 | ForEach-Object { Write-Warning "  $_" }
    Write-Warning "Khoi dong lai may roi chay lai script nay. Script khong tu reboot may ban."
    exit 2
}

Write-Host "== 2/6 Canh bao Hyper-V / VT-x ==" -ForegroundColor Cyan
$hv = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
if ($hv) { Write-Warning "Hyper-V/WSL2 dang bat: VirtualBox se chay qua WHPX, cham hon. Script khong tu tat tinh nang Windows." }
$vt = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
if ($vt -eq $false) { Write-Warning "VT-x co ve dang tat trong BIOS/UEFI." }

Write-Host "== 3/6 Firewall cho mang host-only ==" -ForegroundColor Cyan
# Truy cập từ trình duyệt trên Windows vào 192.168.56.x đi qua adapter host-only,
# mà Windows Firewall thường coi mạng đó là "Public" và chặn vào.
$rule = "capstone-lab-hostonly"
$ruleCmd = "netsh advfirewall firewall add rule name=$rule dir=in action=allow protocol=TCP localport=80,9090,3001,8025 remoteip=192.168.56.0/24"
& netsh advfirewall firewall show rule name=$rule *> $null
if ($LASTEXITCODE -ne 0) {
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @("-NoProfile", "-Command", $ruleCmd)
        Write-Host "Da them rule firewall '$rule'."
    } catch {
        Write-Warning "Khong them duoc rule firewall. Neu trinh duyet khong mo duoc 192.168.56.10, chay tay (admin):"
        Write-Warning "  $ruleCmd"
    }
}

Write-Host "== 4/6 Khoa SSH cua lab ==" -ForegroundColor Cyan
# Khoá này để Ansible trong VM manager SSH sang worker. Không phải khoá của
# Vagrant: Vagrant chỉ dùng nó khi cần, còn playbook trỏ thẳng vào đường dẫn.
$keyDir = Join-Path $PSScriptRoot ".ssh"
$key = Join-Path $keyDir "lab_key"
if (-not (Test-Path $key)) {
    New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    # -N '""' để ssh-keygen nhận passphrase RỖNG (không tương tác, không hỏi).
    & ssh-keygen -t ed25519 -N '""' -C "capstone-lab" -f $key -q
    if (-not (Test-Path $key)) { throw "ssh-keygen khong tao duoc $key" }
    Write-Host "Da sinh $key"
} else {
    Write-Host "Da co $key"
}

Write-Host "== 5/6 Token dang ky GitHub runner ==" -ForegroundColor Cyan
# Token sống ~1 giờ; lấy ngay trước khi provision để Ansible kịp dùng.
$env:RUNNER_TOKEN = ""
if (Have gh) {
    try {
        $env:RUNNER_TOKEN = (& gh api -X POST repos/Tynab/capstone-project/actions/runners/registration-token --jq .token) 2>$null
        if ($env:RUNNER_TOKEN) { Write-Host "Da lay token runner (het han sau ~1 gio)." }
    } catch {
        Write-Warning "Khong lay duoc token runner; bo qua buoc dang ky runner."
    }
} else {
    Write-Warning "Khong co gh CLI -> khong lay duoc token runner."
}
if (-not $env:RUNNER_TOKEN) {
    Write-Warning "Thieu RUNNER_TOKEN -> role runner se bo qua dang ky; chay lai sau khi co token."
}

Write-Host "== 6/6 Dung VM va provision ==" -ForegroundColor Cyan
$vagrantfile = Join-Path $repoRoot "infra\Vagrantfile"
if (-not (Test-Path $vagrantfile)) {
    # Giai đoạn đầu (chưa có Vagrantfile) script chỉ có việc cài công cụ. Tự bỏ
    # qua thay vì để `vagrant up` đổ lỗi khó hiểu.
    Write-Warning "Chua co infra/Vagrantfile -> bo qua buoc dung VM. Chay lai script nay sau khi co Vagrantfile."
} else {
    # Vagrantfile nằm trong infra/, không phải gốc repo — chạy vagrant từ đúng
    # thư mục đó, nếu không Vagrant báo "A Vagrant environment ... is required".
    Push-Location $PSScriptRoot
    try {
        # Gom output thành chuỗi để vừa in ra, vừa nhận diện được lỗi host-only.
        $upLog = (& $vagrantExe up 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
        Write-Host $upLog
        if ($LASTEXITCODE -ne 0 -and $upLog -match 'VERR_INTNET_FLT_IF_NOT_FOUND') {
            # Lỗi card host-only hỏng — đã gặp thật trên Windows 11 + VBox 7.2.20.
            # Sửa rồi thử lại MỘT lần; nhận diện bằng đúng thông báo lỗi để không
            # "sửa" nhầm khi vagrant up hỏng vì lý do khác.
            Write-Warning "Card host-only cua VirtualBox bi hong -> chay infra/fix-hostonly.ps1 (se hien UAC) roi thu lai."
            Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "fix-hostonly.ps1"))
            $upLog = (& $vagrantExe up 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
            Write-Host $upLog
        }
        if ($LASTEXITCODE -ne 0) { throw "vagrant up that bai" }
        # Ansible phải chạy SAU khi cả hai VM đã lên, nên tách khỏi `vagrant up`
        # (Vagrant provision từng VM ngay khi VM đó boot xong).
        & $vagrantExe provision --provision-with ansible
        if ($LASTEXITCODE -ne 0) { throw "provision bang Ansible that bai" }
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Xong. Truy cap:" -ForegroundColor Green
Write-Host "  App        http://192.168.56.10"
Write-Host "  Prometheus http://192.168.56.10:9090"
Write-Host "  Grafana    http://192.168.56.10:3001"
Write-Host "  Mailpit    http://192.168.56.10:8025"
Write-Host "Mat khau lab: vagrant ssh manager -c 'sudo cat /opt/capstone/.env'"
