# Dọn hạ tầng lab capstone theo 3 mức độ (mô tả đầy đủ: infra/README.md mục "Dọn dẹp").
#   -Mode vm    : xoá 2 VM (capstone-manager ~9.6GB + capstone-worker ~6.5GB, tổng ~16.1GB),
#                 dọn state Vagrant (infra\.vagrant + vagrant global-status --prune),
#                 gỡ đăng ký runner swarm-manager-1 trên GitHub. GIỮ box và file repo.
#   -Mode state : GIỮ 2 VM, dọn bên trong: docker stack rm capstone; xoá volume
#                 capstone_* + volume vô danh (DỮ LIỆU MONGO MẤT); rm -rf /opt/capstone;
#                 gỡ systemd unit runner + /home/ghrunner/actions-runner; docker swarm
#                 leave --force (worker trước, manager sau); xoá network rác smoke-net.
#                 GIỮ image docker.
#   -Mode full  : như vm, cộng xoá infra\.ssh (khoá lab), infra\.env (token Cloudflare
#                 thật), rule firewall capstone-lab-hostonly (nếu -RemoveFirewallRule)
#                 và box bento/ubuntu-22.04 (~811MB, nếu -KeepBox:$false).
#
# AN TOÀN KHI CHẠY THỬ: luôn chạy với -DryRun trước — chế độ đó chỉ IN RA việc sẽ làm,
# không chạy một lệnh có tác dụng phụ nào. Mọi lệnh thật đều nằm trong 3 hàm
# Invoke-Local / Invoke-VagrantCmd / Invoke-Vm và đều kiểm tra cờ DryRun.
#
# KHÔNG ĐƯỢC ĐỤNG (ghi chú cố ý đặt ngay đây để không ai sửa script "cho đủ" rồi phá):
#   - Adapter host-only của VirtualBox và DHCP server 192.168.56.0/24 — dùng chung
#     với project khác, xoá đi là mạng 192.168.56.x của họ chết theo.
#   - ~\.ssh\known_hosts — dòng host key của VM dùng chung với mọi project Vagrant;
#     script dùng scp với -o UserKnownHostsFile=NUL để không đọc/ghi file này.
#   - Dịch vụ nền VBoxSVC/VBoxSDS của VirtualBox — đang chạy thì không được dừng/khởi
#     động lại; xoá VM không cần đụng tới chúng.
#
# LƯU Ý VỀ NGÔN NGỮ: các chuỗi in ra màn hình cố ý viết KHÔNG DẤU. Console của
# Windows PowerShell 5.1 chạy codepage ibm850, không biểu diễn được ký tự có dấu
# tiếng Việt — đã thử và chúng biến thành "?". Comment thì vẫn tiếng Việt đầy đủ
# vì được đọc bằng editor/agent, không qua console.
# File này phải lưu dạng UTF-8 CÓ BOM để PowerShell 5.1 đọc đúng phần comment.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("vm", "state", "full")]
    [string]$Mode = "vm",

    # Chỉ in ra việc sẽ làm, KHÔNG chạy lệnh thật. Chạy chế độ này trước mỗi lần dọn.
    [switch]$DryRun,

    # Bỏ qua mọi prompt xác nhận (script vẫn in rõ là đang bỏ qua).
    [switch]$Yes,

    # Giữ box bento/ubuntu-22.04 (~811MB) để lần dựng sau khỏi tải lại. MẶC ĐỊNH BẬT.
    # Xoá box chỉ có hiệu lực ở Mode full: truyền -KeepBox remove (hoặc xoa/false/no/0).
    # CỐ Ý dùng [string] chứ không [bool]: PowerShell 5.1 chạy `powershell -File`
    # KHÔNG chuyển được giá trị `-KeepBox:$false`/`-KeepBox:0` sang [bool] (đã đo thật),
    # nên nhận chuỗi rồi chuẩn hoá ở dưới để destroy.cmd dùng được.
    [string]$KeepBox = "keep",

    # Gỡ đăng ký runner swarm-manager-1 trên GitHub (tránh còn runner offline mồ côi).
    # MẶC ĐỊNH BẬT. Tắt bằng -DeregisterRunner no (hoặc giu/keep/false/0). Lý do [string]: như trên.
    [string]$DeregisterRunner = "yes",

    # Chỉ hợp lệ khi -Mode full: xoá cả infra\.ssh (khoá lab) và infra\.env (token thật).
    [switch]$PurgeRepoFiles,

    # Chỉ hợp lệ khi -Mode full: gỡ rule firewall capstone-lab-hostonly (sẽ hiện UAC).
    [switch]$RemoveFirewallRule,

    # Bỏ qua bước sao lưu MongoDB tự động (dùng khi đã có backup riêng hoặc không cần dữ liệu).
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

# ===== Hằng số khớp với infra/ansible (đổi tên ở đó thì sửa ở đây) =====
$repoOwner    = "Tynab"
$repoName     = "capstone-project"
$stackName    = "capstone"
$boxName      = "bento/ubuntu-22.04"
$fwRule       = "capstone-lab-hostonly"
$runnerName   = "swarm-manager-1"          # runner/defaults/main.yml: runner_name
$runnerUser   = "ghrunner"                 # runner/defaults/main.yml: runner_user
$runnerDir    = "/home/$runnerUser/actions-runner"
$runnerUnit   = "actions.runner.$repoOwner-$repoName.$runnerName.service"

$script:Dry = [bool]$DryRun

# Chuẩn hoá hai tham số "mặc định bật" nhận từ dòng lệnh. MỖI THAM SỐ MỘT DANH SÁCH TỪ
# RIÊNG vì chúng ngược chiều nhau: bản đầu dùng chung một danh sách "từ phủ định" và tạo
# ra bẫy thật — "-KeepBox giu" (người gõ ý là GIỮ box) lại rơi vào nhóm phủ định và XOÁ
# box. Từ lạ thì báo lỗi rõ ràng, không đoán: đoán sai ở đây là mất box 811MB hoặc mất dữ liệu.
function Convert-SwitchWord {
    param([string]$Value, [string[]]$TrueWords, [string[]]$FalseWords, [string]$TenThamSo, [string]$GoiY)
    $v = $Value.Trim().ToLower()
    if ($TrueWords -contains $v) { return $true }
    if ($FalseWords -contains $v) { return $false }
    throw "$TenThamSo '$Value' khong hop le. $GoiY"
}
# -KeepBox: BẬT (giữ box) = keep/giu/true/yes/1 · TẮT (xoá box) = remove/xoa/false/no/0
$script:RemoveBox = -not (Convert-SwitchWord $KeepBox @("keep", "giu", "true", "yes", "1") @("remove", "xoa", "false", "no", "0") "-KeepBox" "Dung: keep|giu (mac dinh) hoac remove|xoa.")
# -DeregisterRunner: BẬT (gỡ runner) = yes/xoa/remove/go/true/1 · TẮT (giữ) = no/giu/keep/false/0
$script:DoDeregister = Convert-SwitchWord $DeregisterRunner @("yes", "xoa", "remove", "go", "true", "1") @("no", "giu", "keep", "false", "0") "-DeregisterRunner" "Dung: yes|xoa (mac dinh) hoac no|giu."

# ===== Dò đường dẫn công cụ =====
# Trình cài Vagrant KHÔNG thêm thư mục của nó vào PATH (destroy.cmd cũ gọi "vagrant"
# trần nên chết ngay với "không tìm thấy lệnh" — đã đo thật trên máy này), nên phải
# dò thêm đường dẫn cài đặt chuẩn như setup.ps1/start.ps1 vẫn làm.
function Resolve-Vagrant {
    $c = Get-Command vagrant -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in @("$env:ProgramFiles\Vagrant\bin\vagrant.exe",
                     "$env:ProgramFiles\HashiCorp\Vagrant\bin\vagrant.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Resolve-Tool([string]$cmd, [string[]]$candidates) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
    return $null
}

$vagrant = Resolve-Vagrant
if (-not $vagrant) { throw "Khong tim thay vagrant.exe. Chay infra\setup.cmd de cai dat truoc." }

# VBoxManage chỉ dùng cho checklist (đo thư mục VM, list vms); thiếu thì vẫn dọn được
# nhưng không tự kiểm chứng được phần VirtualBox.
$vbox = Resolve-Tool "VBoxManage" @("$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe")

# ===== Hàm thực thi =====
# BA HÀM DƯỚI LÀ CỔNG DUY NHẤT tới mọi lệnh có tác dụng phụ. Khi -DryRun chúng chỉ
# in "[DRY-RUN]" kèm lệnh sẽ chạy rồi return, không chạy gì. Kiểm chứng bằng cách tìm
# Remove-Item / Start-Process / gh api / vagrant destroy / vagrant ssh trong file:
# tất cả đều nằm trong $Work hoặc $Cmd truyền vào ba hàm này.

function Invoke-Local([string]$Desc, [scriptblock]$Work) {
    if ($script:Dry) { Write-Host "  [DRY-RUN] $Desc" -ForegroundColor DarkGray; return }
    Write-Host "  $Desc ..." -ForegroundColor Yellow
    & $Work
}

# Chạy lệnh vagrant từ đúng thư mục infra (Vagrant bắt buộc đứng ở thư mục chứa
# Vagrantfile, nếu không báo "A Vagrant environment ... is required").
# KHÔNG đặt tên tham số là $Args: đó là biến tự động của PowerShell, tham số sẽ
# không nhận được giá trị (đã tái hiện thật: dòng dry-run in ra "vagrant " rỗng).
function Invoke-VagrantCmd([string[]]$CmdArgs, [string]$Desc, [switch]$AllowFail) {
    if ($script:Dry) {
        Write-Host "  [DRY-RUN] vagrant $($CmdArgs -join ' ')" -ForegroundColor DarkGray
        return
    }
    Write-Host "  $Desc ..." -ForegroundColor Yellow
    Push-Location $PSScriptRoot
    try {
        & $vagrant @CmdArgs
        if ($LASTEXITCODE -ne 0) {
            if ($AllowFail) { Write-Warning "  Lenh vagrant $($CmdArgs[0]) bao loi nhung duoc phep bo qua." }
            else { throw "vagrant $($CmdArgs[0]) that bai (exit $LASTEXITCODE)" }
        }
    } finally { Pop-Location }
}

# Máy Windows không có docker: MỌI lệnh trong VM phải đi qua vagrant ssh, không có
# đường nào khác (đây là nguyên nhân destroy.cmd cũ bỏ sót toàn bộ phần dọn bên trong).
function Invoke-Vm([string]$Node, [string]$Cmd, [string]$Desc, [switch]$AllowFail) {
    if ($script:Dry) {
        Write-Host "  [DRY-RUN] vagrant ssh $Node -c `"$Cmd`"" -ForegroundColor DarkGray
        return
    }
    Write-Host "  $Desc ($Node) ..." -ForegroundColor Yellow
    Push-Location $PSScriptRoot
    try {
        & $vagrant ssh $Node -c $Cmd
        if ($LASTEXITCODE -ne 0) {
            if ($AllowFail) { Write-Warning "  Lenh trong VM $Node bao loi nhung duoc phep bo qua." }
            else { throw "Lenh trong VM $Node that bai (exit $LASTEXITCODE)" }
        }
    } finally { Pop-Location }
}

# Đo kích thước thư mục VM TRƯỚC khi xoá để báo cáo dung lượng thu hồi. Chỉ đọc
# (Get-ChildItem) nên chạy được cả ở chế độ -DryRun — nhờ đó dry-run in luôn con số.
function Measure-VmFolders {
    # Thư mục máy ảo lấy từ VirtualBox (chính xác hơn đoán "~VirtualBox VMs"):
    # VBOX_USER_HOME hoặc cấu hình khác có thể đổi chỗ đặt VM.
    $machineFolder = "$env:USERPROFILE\VirtualBox VMs"
    if ($vbox) {
        $line = (& $vbox list systemproperties | Where-Object { $_ -match '^Default machine folder:' } | Select-Object -First 1)
        if ($line -and $line -match 'Default machine folder:\s*(.+)$') { $machineFolder = $Matches[1].Trim() }
    }
    $result = @{}
    foreach ($name in @("capstone-manager", "capstone-worker")) {
        $path = Join-Path $machineFolder $name
        if (Test-Path $path) {
            $sum = (Get-ChildItem $path -Recurse -Force -File -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum).Sum
            $result[$path] = $sum
        }
    }
    return ,$result
}

# Bắt gõ ĐÚNG chuỗi yêu cầu (phân biệt hoa/thường) để không có chuyện gõ nhầm "y"/"yes"
# rồi mất cả cụm. -Yes bỏ qua prompt nhưng vẫn in rõ là đang bỏ qua (yêu cầu của spec).
function Confirm-Phrase([string]$Phrase, [string]$Prompt) {
    if ($script:Dry) {
        Write-Host "  [DRY-RUN] bo qua prompt xac nhan." -ForegroundColor DarkGray
        return $true
    }
    if ($Yes) {
        Write-Host "  [BO QUA XAC NHAN vi -Yes] $Prompt" -ForegroundColor Yellow
        return $true
    }
    Write-Host $Prompt -ForegroundColor Red
    $typed = Read-Host "Go dung chu '$Phrase' de tiep tuc"
    if ($typed -cne $Phrase) { Write-Host "Da huy. Khong lam gi."; return $false }
    return $true
}

# ===== Kiểm file gzip (dùng cho backup) =====
# Nhận diện bằng 2 byte đầu (1F 8B) — cố ý không gọi gzip.exe vì Windows không có sẵn.
function Test-LaGzip([string]$path) {
    try {
        $fs = [System.IO.File]::OpenRead($path)
        try {
            $b = New-Object byte[] 2
            if ($fs.Read($b, 0, 2) -lt 2) { return $false }
            return ($b[0] -eq 0x1F -and $b[1] -eq 0x8B)
        } finally { $fs.Dispose() }
    } catch { return $false }
}

# ===== Sao lưu MongoDB (chỉ Mode vm/full, bỏ qua khi -SkipBackup) =====
# Backup LỖI thì script DỪNG, không destroy — mất VM còn dựng lại được, mất dữ liệu
# thì không. Vì vậy bước dump + kiểm tra chạy TRƯỚC mọi lệnh xoá.
function Backup-Mongo {
    if ($script:Dry) {
        Write-Host "  [DRY-RUN] Sao luu MongoDB: mongodump trong VM manager ->" -ForegroundColor DarkGray
        Write-Host "            infra\backup-mongo-<ngay>.gz, kiem gzip -t trong VM roi scp ra Windows." -ForegroundColor DarkGray
        return
    }
    $stamp = Get-Date -Format "yyyy-MM-dd"
    $backupLocal = Join-Path $PSScriptRoot "backup-mongo-$stamp.gz"
    if (Test-Path $backupLocal) {
        # Cùng ngày thì bản này mới sinh cách đây vài giờ; không ghi đè để tránh
        # clobber bản đang tốt bằng một lần dump dở. NHƯNG phải kiểm file cũ CÓ THẬT LÀ
        # gzip không: file hỏng mà ta cứ thế destroy thì đúng cái bẫy "tưởng có backup
        # mà mất". Hai byte đầu 1F 8B là chữ ký gzip, không phụ thuộc máy Windows có
        # sẵn gzip.exe hay không.
        if (Test-LaGzip $backupLocal) {
            Write-Warning "Da co $backupLocal (cung ngay, $([math]::Round((Get-Item $backupLocal).Length/1MB,1)) MB) -> dung lai file nay, KHONG ghi de."
            return
        }
        Write-Warning "$backupLocal khong phai file gzip hop le -> bo qua ban cu, sao luu lai tu dau."
    }
    $remoteFile = "/home/vagrant/capstone-backup-$stamp.gz"

    # Bước 1 — dump NGAY TRONG VM, ghi file vào /home/vagrant của VM. Cố ý KHÔNG đổ
    # stdout qua vagrant ssh về Windows: PowerShell 5.1 decode stdout thành text theo
    # codepage và phá hỏng file nhị phân (khác với cách chạy từ Git Bash trong README).
    # Dùng --env-file /opt/capstone/.env để container tự có MONGO_URI; sh -c BÊN TRONG
    # container mới nội suy $MONGO_URI (shell ngoài không có biến này). CỐ Ý KHÔNG có
    # dấu nháy kép nào trong lệnh remote: PowerShell 5.1 truyền tham số cho lệnh native
    # không escape được nháy kép lồng nhau, lệnh sẽ bị cắt giữa chừng (đã biết rõ từ
    # trước). Mật khẩu Mongo thuần chữ-số (role app đảm bảo) nên $MONGO_URI mở rộng
    # không nháy vẫn an toàn — ký tự ? trong URI không khớp glob nào thì giữ nguyên.
    $dumpCmd = 'sudo docker run --rm --network capstone --env-file /opt/capstone/.env mongo:6 sh -c ''mongodump --uri=$MONGO_URI --archive --gzip'' > ' +
               $remoteFile + ' && sudo gzip -t ' + $remoteFile
    Invoke-Vm "manager" $dumpCmd "mongodump + gzip -t trong VM (co the mat vai phut)"

    # Bước 2 — copy file ra Windows bằng scp (truyền nhị phân, không qua console nên
    # không sợ codepage). Thông số SSH lấy từ `vagrant ssh-config` vì port/identity
    # do Vagrant quản lý, gõ cứng sẽ hỏng khi Vagrant đổi cấu hình.
    $scpExe = Resolve-Tool "scp" @("$env:SystemRoot\System32\OpenSSH\scp.exe")
    if (-not $scpExe) {
        throw "Khong co scp.exe (OpenSSH client). Copy tay bang Git Bash: cd infra; vagrant ssh manager -c 'sudo cat $remoteFile' > $backupLocal, roi chay lai."
    }
    Push-Location $PSScriptRoot
    $sshCfg = (& $vagrant ssh-config manager) -join "`n"
    Pop-Location
    $hostName = $null; $port = "22"; $user = "vagrant"; $keyPath = $null
    foreach ($line in ($sshCfg -split "`r?`n")) {
        if ($line -match '^\s*HostName\s+(\S+)')      { $hostName = $Matches[1] }
        elseif ($line -match '^\s*Port\s+(\d+)')      { $port = $Matches[1] }
        elseif ($line -match '^\s*User\s+(\S+)')      { $user = $Matches[1] }
        elseif ($line -match '^\s*IdentityFile\s+(.+)$') { $keyPath = $Matches[1].Trim() }
    }
    if (-not $hostName -or -not $keyPath) { throw "Khong doc duoc vagrant ssh-config (HostName/IdentityFile)." }
    # UserKnownHostsFile=NUL: không đọc cũng không ghi ~\.ssh\known_hosts (file này
    # dùng chung với project khác — cấm đụng, xem ghi chú đầu file).
    & $scpExe -i $keyPath -P $port -o "StrictHostKeyChecking=no" -o "UserKnownHostsFile=NUL" `
              "$user@${hostName}:$remoteFile" $backupLocal
    if ($LASTEXITCODE -ne 0) { throw "scp copy backup that bai (exit $LASTEXITCODE). DUNG lai, khong destroy." }
    if (-not (Test-Path $backupLocal) -or (Get-Item $backupLocal).Length -eq 0) {
        throw "File backup rong hoac khong ton tai. DUNG lai, khong destroy."
    }
    Write-Host "  Da sao luu: $backupLocal ($([math]::Round((Get-Item $backupLocal).Length/1MB,1)) MB) - da kiem gzip -t trong VM." -ForegroundColor Green
    Invoke-Vm "manager" "sudo rm -f $remoteFile" "Xoa file backup tam trong VM" -AllowFail
}

# ===== Gỡ đăng ký GitHub runner =====
# Chạy cho cả 3 mode: mode nào cũng làm runner ngừng tồn tại (xoá VM hoặc xoá service),
# nếu không gỡ thì GitHub giữ mãi một runner "offline" mồ côi. Gỡ thất bại không chặn
# destroy (runner offline vẫn xoá tay được trên GitHub) — chỉ cảnh báo.
function Remove-GitHubRunner {
    if (-not $script:DoDeregister) { Write-Host "  Giu runner tren GitHub vi -DeregisterRunner no."; return }
    if ($script:Dry) {
        Write-Host "  [DRY-RUN] gh api --method DELETE repos/$repoOwner/$repoName/actions/runners/<id>" -ForegroundColor DarkGray
        Write-Host "            (tim id theo ten $runnerName roi xoa tung cai)" -ForegroundColor DarkGray
        return
    }
    $gh = Resolve-Tool "gh" @("$env:ProgramFiles\GitHub CLI\gh.exe", "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe")
    if (-not $gh) {
        Write-Warning "Khong co gh CLI -> khong go duoc runner tren GitHub. Xoa tay: https://github.com/$repoOwner/$repoName/settings/actions/runners"
        return
    }
    # Lấy JSON rồi lọc bằng PowerShell, KHÔNG dùng jq có nháy kép: PS 5.1 truyền tham số
    # cho lệnh native không escape được nháy kép lồng nhau, biểu thức jq sẽ bị cắt.
    $raw = ((& $gh api "repos/$repoOwner/$repoName/actions/runners" 2>$null) -join "`n")
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "gh api loi (exit $LASTEXITCODE) -> bo qua go runner; xoa tay tren GitHub sau."
        return
    }
    $ids = @(($raw | ConvertFrom-Json).runners |
             Where-Object { $_.name -eq $runnerName } |
             ForEach-Object { $_.id })
    if ($ids.Count -eq 0) { Write-Host "  Khong co runner nao ten $runnerName tren GitHub."; return }
    foreach ($id in $ids) {
        & $gh api --method DELETE "repos/$repoOwner/$repoName/actions/runners/$id" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Xoa runner $id that bai (exit $LASTEXITCODE); xoa tay tren GitHub." }
        else { Write-Host "  Da go dang ky runner $id tren GitHub." -ForegroundColor Green }
    }
}

# ===== Hành động theo mode =====
function Invoke-ModeVm {
    # Đo TRƯỚC khi xoá để checklist cuối báo đúng dung lượng thu hồi.
    $sizes = Measure-VmFolders
    if ($sizes.Count -eq 0) { Write-Warning "Khong do duoc thu muc VM (co the VM dat o thu muc khac hoac da xoa)." }
    foreach ($k in $sizes.Keys) {
        Write-Host ("  VM tren dia: {0} = {1:N1} GB" -f $k, ($sizes[$k] / 1GB))
    }

    Invoke-VagrantCmd @("destroy", "-f") "vagrant destroy -f (ca 2 VM)"
    # Sau destroy, .vagrant chỉ còn metadata rác; xoá để global-status nhận VM đã mất.
    Invoke-Local "Xoa thu muc state Vagrant (infra\.vagrant)" {
        Remove-Item -Recurse -Force (Join-Path $PSScriptRoot ".vagrant")
    }
    Invoke-VagrantCmd @("global-status", "--prune") "vagrant global-status --prune (xo entry capstone da mat)"
    return ,$sizes
}

function Invoke-ModeState {
    # Gỡ stack khi manager còn là leader (sau khi rời swarm thì không còn cách nào gỡ).
    Invoke-Vm "manager" "sudo docker stack rm $stackName" "docker stack rm $stackName"

    # Volume capstone_* nằm rải CẢ HAI node: mongo_data bị ghim ở worker, còn
    # prom/grafana/portainer_state ở manager -> phải dọn cả hai, không chỉ manager.
    $volCmd = 'sudo docker volume rm $(sudo docker volume ls -q --filter name=^' + $stackName + '_ 2>/dev/null) 2>/dev/null || true'
    $danglingCmd = 'sudo docker volume rm $(sudo docker volume ls -qf dangling=true) 2>/dev/null || true'
    foreach ($node in @("manager", "worker")) {
        Invoke-Vm $node $volCmd ("Xoa volume " + $stackName + "_*") -AllowFail
        Invoke-Vm $node $danglingCmd "Xoa volume vo danh" -AllowFail
    }

    # Container/network rác của bước smoke test thời đầu dự án (plan trong
    # docs/superpowers/plans/...). Thực tế chỉ thấy ở manager, nhưng quét CẢ HAI node
    # cho khớp với cách dọn volume ở trên; lệnh có `|| true` nên node không có cũng vô hại.
    $smokeCmd = 'sudo docker rm -f smoke-mongo smoke-backend 2>/dev/null || true; sudo docker network rm smoke-net 2>/dev/null || true'
    foreach ($node in @("manager", "worker")) {
        Invoke-Vm $node $smokeCmd "Xoa container + network rac smoke-net" -AllowFail
    }

    # Runner: dừng unit, gỡ file unit, xoá thư mục cài, daemon-reload. `|| true` ở
    # stop/disable vì unit có thể chưa từng được cài (provision thiếu token runner).
    $runnerCmd = 'sudo systemctl stop ' + $runnerUnit + ' 2>/dev/null || true; ' +
                 'sudo systemctl disable ' + $runnerUnit + ' 2>/dev/null || true; ' +
                 'sudo rm -f /etc/systemd/system/' + $runnerUnit + '; ' +
                 'sudo rm -rf ' + $runnerDir + '; sudo systemctl daemon-reload'
    Invoke-Vm "manager" $runnerCmd "Go systemd unit runner + $runnerDir"

    # /opt/capstone chỉ có ở manager (role app chạy hosts: swarm_manager) nhưng chạy
    # cả hai node cho chắc — rm -rf trên đường dẫn không tồn tại cũng không báo lỗi.
    foreach ($node in @("manager", "worker")) {
        Invoke-Vm $node "sudo rm -rf /opt/capstone" "Xoa /opt/capstone"
    }

    # Rời swarm: worker TRƯỚC, manager SAU — manager rời trước thì nó không còn
    # quản lý gì để ghi nhận worker rời, kết quả dọn sẽ kém sạch.
    Invoke-Vm "worker" "sudo docker swarm leave --force 2>/dev/null || true" "Roi swarm" -AllowFail
    Invoke-Vm "manager" "sudo docker swarm leave --force 2>/dev/null || true" "Roi swarm" -AllowFail
}

# ===== Bắt đầu =====
Write-Host ""
Write-Host "=== DON HA TANG CAPSTONE ===" -ForegroundColor Cyan
Write-Host "Mode      : $Mode"
Write-Host "DryRun    : $DryRun (chi in ra viec se lam, KHONG chay lenh that)"
Write-Host "KeepBox   : $(if ($script:RemoveBox) { 'no (se xoa box)' } else { 'keep (giu box)' }) - box $boxName ~811MB"
Write-Host "DeregisterRunner: $(if ($script:DoDeregister) { 'yes (se go dang ky tren GitHub)' } else { 'no (giu runner tren GitHub)' })"
Write-Host "SkipBackup: $SkipBackup"
if ($Mode -eq "full") {
    Write-Host "PurgeRepoFiles: $PurgeRepoFiles (xoa infra\.ssh + infra\.env) | RemoveFirewallRule: $RemoveFirewallRule"
}
if ($script:RemoveBox -and $Mode -ne "full") {
    Write-Warning "-KeepBox no chi co hieu luc o Mode full; o Mode $Mode box duoc giu nguyen."
}
if ($PurgeRepoFiles -and $Mode -ne "full") {
    throw "-PurgeRepoFiles chi hop le khi -Mode full (dang la: $Mode)."
}
if ($RemoveFirewallRule -and $Mode -ne "full") {
    throw "-RemoveFirewallRule chi hop le khi -Mode full (dang la: $Mode)."
}

Write-Host ""
Write-Host "Hau qua se xay ra:" -ForegroundColor Yellow
switch ($Mode) {
    "vm" {
        Write-Host "  - Xoa 2 VM: capstone-manager (~9.6GB) + capstone-worker (~6.5GB) - tong ~16.1GB"
        Write-Host "  - Xoa thu muc state Vagrant (infra\.vagrant) + vagrant global-status --prune"
        if (-not $SkipBackup) { Write-Host "  - Truoc khi xoa: sao luu MongoDB vao infra\backup-mongo-<ngay>.gz (kiem gzip -t)" }
        if ($script:DoDeregister) { Write-Host "  - Go dang ky runner $runnerName tren GitHub" }
        Write-Host "  - GIU box $boxName, GIU file repo (infra\.ssh, infra\.env)"
    }
    "state" {
        Write-Host "  - GIU 2 VM (khong xoa VM)"
        Write-Host "  - Trong VM: docker stack rm $stackName; xoa volume ${stackName}_* + volume vo danh  => DU LIEU MONGO MAT"
        Write-Host "  - rm -rf /opt/capstone (ca 2 node)"
        Write-Host "  - Go systemd unit runner + $runnerDir"
        Write-Host "  - docker swarm leave --force (worker truoc, manager sau); xoa network rac smoke-net"
        Write-Host "  - GIU image docker (dung lai phai keo image ve)"
        if ($script:DoDeregister) { Write-Host "  - Go dang ky runner $runnerName tren GitHub" }
        Write-Warning "  CHU Y: Mode state KHONG tu sao luu MongoDB (backup chi co o Mode vm/full). Neu can du lieu hay chay tay lenh backup trong README."
    }
    "full" {
        Write-Host "  - Tat ca cua Mode vm, cong them:"
        if ($PurgeRepoFiles) { Write-Host "  - Xoa infra\.ssh (khoa SSH lab) va infra\.env (token Cloudflare THAT)" }
        if ($RemoveFirewallRule) { Write-Host "  - Go rule firewall $fwRule (se hien UAC)" }
        if ($script:RemoveBox) { Write-Host "  - Xoa box $boxName (~811MB)" }
    }
}

Write-Host ""
Write-Host "Khong dung toi (dung chung, xoa se anh huong project khac):" -ForegroundColor Yellow
Write-Host "  - Adapter host-only cua VirtualBox va DHCP server 192.168.56.0/24"
Write-Host "  - ~\.ssh\known_hosts"
Write-Host "  - Dich vu nen VBoxSVC / VBoxSDS cua VirtualBox"

# Xác nhận chính — bắt gõ đúng chữ XOA. Mode state cũng hỏi vì nó xoá dữ liệu Mongo.
if (-not (Confirm-Phrase "XOA" "Xac nhan thuc hien Mode $Mode - cac viec ke tren KHONG the hoan tac.")) { exit 1 }

# Xác nhận riêng LẦN HAI cho hai việc nhạy cảm nhất của Mode full (spec yêu cầu hỏi riêng).
if ($Mode -eq "full" -and $PurgeRepoFiles) {
    if (-not (Confirm-Phrase "XOA FILE" "Xoa infra\.ssh + infra\.env: token Cloudflare that se mat, muon domain cong khai hoat dong phai dan lai token truoc khi dung lai.")) { exit 1 }
}
if ($Mode -eq "full" -and $script:RemoveBox) {
    if (-not (Confirm-Phrase "XOA BOX" "Xoa box ${boxName}: lan dung lai se phai tai lai ~811MB.")) { exit 1 }
}

# ===== Thực thi =====
if (($Mode -eq "vm" -or $Mode -eq "full") -and -not $SkipBackup) {
    Write-Host ""
    Write-Host "== Sao luu MongoDB ==" -ForegroundColor Cyan
    Backup-Mongo
}

Write-Host ""
Write-Host "== Go dang ky GitHub runner ==" -ForegroundColor Cyan
Remove-GitHubRunner

Write-Host ""
Write-Host "== Don dep theo Mode $Mode ==" -ForegroundColor Cyan
$vmSizes = @{}
if ($Mode -eq "state") {
    Invoke-ModeState
} else {
    $vmSizes = Invoke-ModeVm
    if ($Mode -eq "full") {
        if ($RemoveFirewallRule) {
            # Gỡ rule cần quyền admin -> tiến trình con hiện UAC (cùng cách setup.ps1
            # làm khi thêm rule).
            Invoke-Local "Go rule firewall '$fwRule' (se hien UAC)" {
                Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
                    "-NoProfile", "-Command", "netsh advfirewall firewall delete rule name=$fwRule")
            }
        }
        if ($PurgeRepoFiles) {
            Invoke-Local "Xoa infra\.ssh (khoa SSH lab)" {
                Remove-Item -Recurse -Force (Join-Path $PSScriptRoot ".ssh")
            }
            Invoke-Local "Xoa infra\.env (token Cloudflare that)" {
                Remove-Item -Force (Join-Path $PSScriptRoot ".env")
            }
            Write-Host "  Nho: truoc khi dung lai phai dan lai token tunnel vao infra\.env (setup.cmd se tao lai file tu .env.example, de trong token)." -ForegroundColor Yellow
        }
        if ($script:RemoveBox) {
            Invoke-VagrantCmd @("box", "remove", $boxName, "--force") "vagrant box remove $boxName"
        }
    }
}

# ===== Checklist kiểm chứng =====
Write-Host ""
Write-Host "=== CHECKLIST KIEM CHUNG ===" -ForegroundColor Cyan
if ($script:Dry) {
    Write-Host "  (DryRun: duoi day la cac lenh SE CHAY khi khong con -DryRun)"
    if ($Mode -eq "state") {
        Write-Host "    vagrant status                          # phai van running (Mode state giu VM)"
        Write-Host "    vagrant ssh manager -c 'sudo docker node ls'          # phai bao not a swarm manager"
        Write-Host "    vagrant ssh manager -c 'sudo docker volume ls -q'     # khong con volume capstone_*"
        Write-Host "    vagrant ssh manager -c 'test ! -e /opt/capstone && echo GONE'"
    } else {
        Write-Host "    vagrant status                          # phai bao not created"
        Write-Host "    VBoxManage list vms                     # khong con capstone-manager / capstone-worker"
        Write-Host "    Test-Path <thu muc VM>                  # phai False, kem dung luong thu hoi"
        if ($Mode -eq "full" -and $RemoveFirewallRule) { Write-Host "    netsh advfirewall firewall show rule name=$fwRule   # phai bao khong co rule" }
        Write-Host "    vagrant box list                        # neu con $boxName -> xoa bang: vagrant box remove $boxName --force"
    }
    if ($script:DoDeregister) { Write-Host "    gh api repos/$repoOwner/$repoName/actions/runners --jq '.runners[].name'  # khong con $runnerName" }
    Write-Host ""
    Write-Host "  Xong DryRun - exit code 0. Chua co gi thay doi tren may."
    exit 0
}

Push-Location $PSScriptRoot
try {
    $status = (& $vagrant status) -join "`n"
} finally { Pop-Location }

if ($Mode -eq "state") {
    if ($status -match 'running \(virtualbox\)') {
        Write-Host "  [OK] vagrant status: 2 VM van running (dung nhu Mode state yeu cau)" -ForegroundColor Green
    } else {
        Write-Warning "  [X] vagrant status KHONG con running:"
        $status -split "`n" | Select-Object -First 6 | ForEach-Object { Write-Warning "    $_" }
    }
    # Mọi lệnh vagrant ssh trong checklist cũng phải đứng ở thư mục infra (Vagrant
    # bắt buộc đọc Vagrantfile từ thư mục hiện tại).
    Push-Location $PSScriptRoot
    try {
        $nodeOut = (& $vagrant ssh manager -c "sudo docker node ls 2>&1 || true") -join "`n"
        if ($nodeOut -match 'not a swarm manager') {
            Write-Host "  [OK] manager da roi swarm (docker node ls bao not a swarm manager)" -ForegroundColor Green
        } else {
            Write-Warning "  [X] manager hinh nhu van trong swarm:"
            $nodeOut -split "`n" | Select-Object -First 4 | ForEach-Object { Write-Warning "    $_" }
        }
        foreach ($node in @("manager", "worker")) {
            $vols = (& $vagrant ssh $node -c "sudo docker volume ls -q 2>/dev/null || true") -join "`n"
            if ($vols -match "^$stackName") {
                Write-Warning ("  [X] ${node} van con volume ${stackName}_*: $vols")
            } else {
                Write-Host ("  [OK] ${node}: khong con volume ${stackName}_*") -ForegroundColor Green
            }
            $opt = (& $vagrant ssh $node -c "test ! -e /opt/capstone && echo GONE || echo EXISTS") -join "`n"
            if ($opt -match 'GONE') { Write-Host "  [OK] ${node}: /opt/capstone da mat" -ForegroundColor Green }
            else { Write-Warning "  [X] ${node}: /opt/capstone van con" }
        }
        $unit = (& $vagrant ssh manager -c "test -e /etc/systemd/system/$runnerUnit && echo EXISTS || echo GONE") -join "`n"
        if ($unit -match 'GONE') { Write-Host "  [OK] systemd unit runner da mat" -ForegroundColor Green }
        else { Write-Warning "  [X] systemd unit runner van con" }
    } finally { Pop-Location }
} else {
    if ($status -match 'not created') {
        Write-Host "  [OK] vagrant status: not created" -ForegroundColor Green
    } else {
        Write-Warning "  [X] vagrant status KHONG bao not created:"
        $status -split "`n" | Select-Object -First 6 | ForEach-Object { Write-Warning "    $_" }
    }
    if ($vbox) {
        $vms = (& $vbox list vms) -join "`n"
        if ($vms -match 'capstone-') {
            Write-Warning "  [X] VBoxManage list vms van con VM capstone-*:"
            $vms -split "`n" | ForEach-Object { Write-Warning "    $_" }
        } else {
            Write-Host "  [OK] VBoxManage list vms: khong con capstone-*" -ForegroundColor Green
        }
    } else {
        Write-Warning "  Khong co VBoxManage -> khong kiem duoc list vms."
    }
    $freed = 0
    foreach ($k in $vmSizes.Keys) { $freed += $vmSizes[$k] }
    foreach ($k in $vmSizes.Keys) {
        if (Test-Path $k) { Write-Warning "  [X] Van con thu muc VM: $k" }
        else { Write-Host "  [OK] Da mat: $k" -ForegroundColor Green }
    }
    if ($freed -gt 0) { Write-Host "  Tong dung luong thu hoi: $([math]::Round($freed / 1GB, 1)) GB" -ForegroundColor Green }
    if ($Mode -eq "full" -and $RemoveFirewallRule) {
        (& netsh advfirewall firewall show rule name=$fwRule 2>&1 | Out-String | Out-Null)
        if ($LASTEXITCODE -eq 0) { Write-Warning "  [X] Rule firewall $fwRule van con." }
        else { Write-Host "  [OK] Rule firewall $fwRule da mat" -ForegroundColor Green }
    }
    if ($script:DoDeregister) {
        $gh = Resolve-Tool "gh" @("$env:ProgramFiles\GitHub CLI\gh.exe", "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe")
        if ($gh) {
            $names = (& $gh api "repos/$repoOwner/$repoName/actions/runners" --jq '.runners[].name' 2>$null) -join "`n"
            if ($names -match $runnerName) { Write-Warning "  [X] GitHub van con runner ${runnerName}: $names" }
            else { Write-Host "  [OK] GitHub khong con runner $runnerName" -ForegroundColor Green }
        } else {
            Write-Warning "  Khong co gh CLI -> kiem tay: https://github.com/$repoOwner/$repoName/settings/actions/runners"
        }
    }
    Push-Location $PSScriptRoot
    try { $boxes = (& $vagrant box list) -join "`n" } finally { Pop-Location }
    if ($boxes -match [regex]::Escape($boxName)) {
        Write-Host "  Box $boxName van con. Xoa bang: vagrant box remove $boxName --force" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] Box $boxName da mat" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Xong. Dung lai tu dau: infra\setup.cmd" -ForegroundColor Green
