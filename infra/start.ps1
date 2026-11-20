# Bật lại cụm VM đã dựng (dùng sau khi tắt/mở lại máy Windows).
# KHÁC setup.cmd: không kiểm/cài công cụ, không chạy Ansible, không đụng tới cấu hình.
#
# VÌ SAO KHÔNG CHỈ GỌI `vagrant up` (bản cũ làm vậy và đã hỏng thật ngày 2026-11-20):
#   - Khi Windows tắt máy, VBoxHeadless tự LƯU TRẠNG THÁI (SaveState) mọi VM đang chạy — mã
#     nguồn VirtualBox gọi SaveState vô điều kiện khi nhận WM_ENDSESSION, không có cấu hình nào
#     đổi được thành tắt máy. Nên lần bật sau là RESUME chứ không phải khởi động lạnh.
#   - Máy bật Hyper-V nên VirtualBox chạy qua WHPX (NEM). Lần đo thật: manager resume xong ở
#     giây thứ 11 nhưng guest ĐỨNG HÌNH ~28 phút (journal trống tuyệt đối từ lúc lưu tới lúc
#     tỉnh) rồi tự hồi phục; worker — cũng nằm 33 ngày ở trạng thái lưu — resume có SSH sau 28s.
#     Tức resume không hỏng tất định, nhưng có lúc rất lâu.
#   - `vagrant up` resume TUẦN TỰ và bỏ cuộc ở boot_timeout (900s): manager kẹt là cả lệnh
#     thất bại và worker không bao giờ được bật.
#
# Script này: đọc trạng thái TỪNG VM; VM đang lưu thì resume ngay bằng VBoxManage startvm
# (đúng việc Vagrant làm khi resume — Vagrant chỉ thêm bước chờ SSH), VM đang tắt thì khởi
# động lạnh bằng `vagrant up <tên>` (để mount /vagrant và đi đúng đường của Vagrant), rồi chờ
# SSH của cả hai SONG SONG với giới hạn dài và báo tiến độ. Sau resume đồng hồ guest còn ở
# ngày bị lưu nên kiểm lệch giờ và ép đồng bộ (swarm dùng TLS, lệch giờ là hỏng kết nối).
#
# -ColdBoot: VM nào chưa sẵn sàng (đang lưu, hoặc đang chạy mà không trả lời SSH) thì BỎ trạng
# thái lưu / tắt cứng rồi khởi động lạnh. Tương đương RÚT ĐIỆN: mất mọi thứ trong RAM, MongoDB
# (nằm ở worker) phải tự phục hồi từ journal. Vì vậy chỉ chạy khi người dùng chủ động chọn.
#
# LƯU Ý NGÔN NGỮ: chuỗi in ra console cố ý viết KHÔNG DẤU (console PowerShell 5.1 dùng
# codepage ibm850); comment vẫn tiếng Việt đầy đủ. File phải lưu UTF-8 CÓ BOM.

[CmdletBinding()]
param(
    # Số phút tối đa chờ MỖI lần chạy cho tới khi các VM trả lời SSH. Mặc định 45: lần đứng
    # hình dài nhất đã đo là ~28 phút. Hết giờ thì VM vẫn chạy tiếp, chạy lại script là chờ tiếp.
    [int]$WaitMinutes = 45,

    # Khởi động lạnh VM chưa sẵn sàng (xem đầu file). Có hỏi xác nhận.
    [switch]$ColdBoot
)

$ErrorActionPreference = "Stop"

# Khớp Vagrantfile: key của node -> tên VM trong VirtualBox là "capstone-<key>".
# Thứ tự cố ý: worker trước. Resume là lệnh không chặn nên thứ tự không làm chậm gì, nhưng
# nếu phải khởi động lạnh thì worker (chứa MongoDB) lên trước để manager lên là có DB ngay.
$Nodes = @("worker", "manager")

function Resolve-Tool([string]$Cmd, [string[]]$Candidates) {
    $c = Get-Command $Cmd -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in $Candidates) { if (Test-Path $p) { return $p } }
    return $null
}

# Trình cài Vagrant không phải lúc nào cũng thêm thư mục vào PATH -> dò thêm đường dẫn chuẩn.
$vagrant = Resolve-Tool "vagrant" @("$env:ProgramFiles\Vagrant\bin\vagrant.exe",
                                     "$env:ProgramFiles\HashiCorp\Vagrant\bin\vagrant.exe")
if (-not $vagrant) { throw "Khong tim thay vagrant.exe. Chay infra\setup.cmd de cai dat truoc." }
$vbox = Resolve-Tool "VBoxManage" @("$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe")
if (-not $vbox) { throw "Khong tim thay VBoxManage.exe. Chay infra\setup.cmd de cai dat truoc." }

# Mọi hàm gọi lệnh native đặt ErrorActionPreference = Continue CỤC BỘ: PowerShell 5.1 biến
# dòng stderr của lệnh native thành lỗi chặn khi đang ở chế độ Stop, kể cả khi đã 2>$null.

function Get-VmInfo([string]$Node) {
    $ErrorActionPreference = "Continue"
    $name = "capstone-$Node"
    $raw = & $vbox showvminfo $name --machinereadable 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Khong tim thay VM $name trong VirtualBox. Cum chua duoc dung: chay infra\setup.cmd." }
    $state = $null; $port = $null
    foreach ($line in $raw) {
        if ($line -match '^VMState="([^"]+)"') { $state = $Matches[1] }
        elseif ($line -match '^Forwarding\(\d+\)="ssh,tcp,[^,]*,(\d+),') { $port = [int]$Matches[1] }
    }
    if (-not $port) { throw "VM $name khong co port forward SSH (Forwarding ssh). Cau hinh VM khac voi Vagrantfile." }
    return [pscustomobject]@{ Node = $Node; Name = $name; State = $state; SshPort = $port }
}

# "Sẵn sàng" = sshd trả banner qua port forward của NAT — đúng thứ Vagrant chờ. Chỉ mở TCP
# thôi là CHƯA đủ: bộ chuyển NAT của VirtualBox luôn nhận kết nối ở phía host, kể cả khi guest
# đang đứng hình (đo thật: connect thành công nhưng không có banner suốt 28 phút).
function Test-SshBanner([int]$Port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        if (-not $c.ConnectAsync("127.0.0.1", $Port).Wait(3000)) { return $false }
        $s = $c.GetStream(); $s.ReadTimeout = 5000
        $buf = New-Object byte[] 64
        $n = $s.Read($buf, 0, $buf.Length)
        return ([Text.Encoding]::ASCII.GetString($buf, 0, $n) -like "SSH-*")
    } catch { return $false } finally { $c.Dispose() }
}

function Format-Elapsed([TimeSpan]$t) { return ("{0}m{1:00}s" -f [int][Math]::Floor($t.TotalMinutes), $t.Seconds) }

function Invoke-VBox([string[]]$CmdArgs, [string]$Desc) {
    $ErrorActionPreference = "Continue"
    Write-Host "  $Desc ..." -ForegroundColor Yellow
    $out = & $vbox @CmdArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        $out | ForEach-Object { Write-Host "    $_" }
        throw "VBoxManage $($CmdArgs[0]) that bai (exit $LASTEXITCODE)"
    }
}

# Giờ guest (epoch giây) qua vagrant ssh; $null nếu không đọc được.
function Get-GuestEpoch([string]$Node) {
    $ErrorActionPreference = "Continue"
    $out = & $vagrant ssh $Node -c "date -u +%s" 2>$null
    $num = @($out | Where-Object { $_ -match '^\s*\d{9,}\s*$' } | Select-Object -Last 1)
    if ($num.Count -eq 0) { return $null }
    return [long]$num[0].Trim()
}

# Sau resume, đồng hồ guest còn ở thời điểm bị lưu (lần đo thật: lùi 33 ngày). systemd-timesyncd
# chỉ sửa ở lần poll kế tiếp — có thể hơn 30 phút. Lệch giờ giữa các node làm hỏng TLS của swarm
# và kết nối ra Cloudflare/GHCR/GitHub, nên khởi động lại timesyncd để nó đồng bộ NGAY.
function Sync-GuestClock([string]$Node) {
    $ErrorActionPreference = "Continue"
    $lech = $null
    for ($i = 1; $i -le 7; $i++) {
        $g = Get-GuestEpoch $Node
        if ($null -eq $g) { Write-Warning "  ${Node}: khong doc duoc gio guest -> bo qua kiem lech gio."; return }
        $lech = $g - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        if ([Math]::Abs($lech) -le 120) {
            Write-Host ("  [OK] {0}: lech gio {1}s" -f $Node, $lech) -ForegroundColor Green
            return
        }
        if ($i -eq 1) {
            Write-Host ("  {0}: gio guest lech {1:N0} phut so voi may Windows -> ep dong bo lai (systemd-timesyncd)" -f $Node, ($lech / 60)) -ForegroundColor Yellow
            & $vagrant ssh $Node -c "sudo systemctl restart systemd-timesyncd" 2>$null | Out-Null
        }
        Start-Sleep -Seconds 10
    }
    Write-Warning ("  {0}: van lech gio {1}s sau 1 phut. Kiem: vagrant ssh {0} -c 'timedatectl'" -f $Node, $lech)
}

Push-Location $PSScriptRoot
try {
    Write-Host "== Trang thai 2 VM cua cum capstone ==" -ForegroundColor Cyan
    $vms = @($Nodes | ForEach-Object { Get-VmInfo $_ })
    foreach ($vm in $vms) { Write-Host ("  {0,-8} {1}" -f $vm.Node, $vm.State) }

    # ---------------- -ColdBoot: đưa VM chưa sẵn sàng về trạng thái tắt ----------------
    if ($ColdBoot) {
        $canLam = @()
        foreach ($vm in $vms) {
            if ($vm.State -eq "saved") { $canLam += $vm }
            # "gurumeditation" là tên VBoxManage --machinereadable dùng cho VM bị treo cứng.
            elseif ($vm.State -in @("running", "paused", "gurumeditation")) {
                # Cho VM đang chạy 3 cơ hội (~25s) trả lời trước khi coi là treo.
                $song = $false
                for ($i = 0; $i -lt 3 -and -not $song; $i++) { $song = Test-SshBanner $vm.SshPort; if (-not $song) { Start-Sleep 3 } }
                if (-not $song) { $canLam += $vm }
            }
        }
        if ($canLam.Count -eq 0) {
            Write-Host "  -ColdBoot: khong co VM nao can khoi dong lanh (VM dang chay deu tra loi SSH)." -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host ("CANH BAO -ColdBoot: se TAT CUNG / BO TRANG THAI LUU cua: {0}" -f (($canLam | ForEach-Object Node) -join ", ")) -ForegroundColor Red
            Write-Host "  Tuong duong rut dien: mat moi thu trong RAM; MongoDB (o worker) tu phuc hoi tu journal." -ForegroundColor Red
            Write-Host "  Neu VM chi dang cham (lan do that: ~28 phut sau resume moi tinh) thi chay lai start.cmd" -ForegroundColor Red
            Write-Host "  KHONG kem -ColdBoot de cho tiep la an toan hon." -ForegroundColor Red
            $typed = Read-Host "Go dung chu COLD de tiep tuc"
            if ($typed -cne "COLD") { Write-Host "Da huy. Khong lam gi."; exit 1 }
            foreach ($vm in $canLam) {
                if ($vm.State -eq "saved") { Invoke-VBox @("discardstate", $vm.Name) "$($vm.Node): bo trang thai luu" }
                else { Invoke-VBox @("controlvm", $vm.Name, "poweroff") "$($vm.Node): tat cung" }
            }
            $vms = @($Nodes | ForEach-Object { Get-VmInfo $_ })
        }
    }

    # ---------------- Bật: resume trước (không chặn), khởi động lạnh sau ----------------
    Write-Host "== Bat VM ==" -ForegroundColor Cyan
    $resumed = @()
    $lanh = @()
    foreach ($vm in $vms) {
        switch ($vm.State) {
            "running"  { Write-Host "  $($vm.Node): dang chay san" }
            "saved"    { Invoke-VBox @("startvm", $vm.Name, "--type", "headless") "$($vm.Node): resume tu trang thai luu"; $resumed += $vm.Node }
            "paused"   { Invoke-VBox @("controlvm", $vm.Name, "resume") "$($vm.Node): bo tam dung"; $resumed += $vm.Node }
            "poweroff" { $lanh += $vm }
            "aborted"  { $lanh += $vm }
            default    { throw "VM $($vm.Name) dang o trang thai '$($vm.State)' - khong tu xu ly. VM treo cung (gurumeditation) thi chay infra\start.cmd -ColdBoot; trang thai tam (starting/saving...) thi doi mot chut roi chay lai." }
        }
    }
    # Khởi động lạnh đi qua Vagrant (mount /vagrant, đúng đường của Vagrant). Lệnh này chặn tới
    # khi VM có SSH — trong lúc đó các VM vừa resume vẫn tiếp tục hồi phục song song.
    $loi = @()
    foreach ($vm in $lanh) {
        Write-Host "  $($vm.Node): khoi dong lanh (vagrant up $($vm.Node))" -ForegroundColor Yellow
        & $vagrant up $vm.Node
        if ($LASTEXITCODE -ne 0) { $loi += $vm.Node; Write-Warning "  vagrant up $($vm.Node) that bai (exit $LASTEXITCODE)." }
    }

    # ---------------- Chờ SSH của mọi VM, song song ----------------
    Write-Host ("== Cho cac VM tra loi SSH (toi da {0} phut) ==" -f $WaitMinutes) -ForegroundColor Cyan
    if ($resumed.Count -gt 0) {
        Write-Host "  Resume tu trang thai luu co the mat tu vai giay toi ~30 phut (guest dung hinh roi tu tinh)."
    }
    $t0 = Get-Date
    $deadline = $t0.AddMinutes($WaitMinutes)
    $sanSang = @{}
    $lanBao = $t0
    while ($true) {
        foreach ($vm in $vms) {
            if (-not $sanSang.ContainsKey($vm.Node) -and (Test-SshBanner $vm.SshPort)) {
                $sanSang[$vm.Node] = $true
                Write-Host ("  [OK] {0}: SSH tra loi (+{1})" -f $vm.Node, (Format-Elapsed ((Get-Date) - $t0))) -ForegroundColor Green
            }
        }
        $cho = @($vms | Where-Object { -not $sanSang.ContainsKey($_.Node) })
        if ($cho.Count -eq 0 -or (Get-Date) -ge $deadline) { break }
        if (((Get-Date) - $lanBao).TotalSeconds -ge 60) {
            Write-Host ("  +{0} van dang cho: {1}" -f (Format-Elapsed ((Get-Date) - $t0)), (($cho | ForEach-Object Node) -join ", "))
            $lanBao = Get-Date
        }
        Start-Sleep -Seconds 5
    }

    if ($cho.Count -gt 0 -or $loi.Count -gt 0) {
        Write-Host ""
        if ($cho.Count -gt 0) {
            Write-Host ("Sau {0} phut VM van chua tra loi SSH: {1}" -f $WaitMinutes, (($cho | ForEach-Object Node) -join ", ")) -ForegroundColor Red
            Write-Host "  VM VAN DANG CHAY (script khong tat no). Hai cach:" -ForegroundColor Yellow
            Write-Host "   1. Cho tiep - an toan, khong mat gi: chay lai infra\start.cmd"
            Write-Host "   2. Khoi dong lanh (tuong duong rut dien, xem canh bao): infra\start.cmd -ColdBoot"
            Write-Host ("  Xem man hinh guest: VBoxManage controlvm capstone-{0} screenshotpng shot.png" -f $cho[0].Node)
        }
        if ($loi.Count -gt 0) { Write-Host ("vagrant up that bai voi: {0} - doc log o tren." -f ($loi -join ", ")) -ForegroundColor Red }
        exit 1
    }

    # ---------------- Đồng hồ guest sau resume ----------------
    if ($resumed.Count -gt 0) {
        Write-Host "== Kiem lech gio sau resume ==" -ForegroundColor Cyan
        foreach ($n in $resumed) { Sync-GuestClock $n }
    }

    # Sau khi VM lên, swarm tự xếp lại task; đợi app trả lời rồi mới báo xong.
    Write-Host "== Cho stack tu hoi phuc (toi da 3 phut) ==" -ForegroundColor Cyan
    $ready = $false
    for ($i = 1; $i -le 36; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "http://192.168.56.10/api/health" -TimeoutSec 5 -UseBasicParsing
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 5
    }
    if ($ready) {
        Write-Host "  [OK] http://192.168.56.10/api/health tra 200" -ForegroundColor Green
    } else {
        Write-Warning "Stack chua tra loi sau 3 phut. Kiem bang: vagrant ssh manager -c 'sudo docker stack services capstone'"
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Cum dang chay. Truy cap:" -ForegroundColor Green
Write-Host "  App        http://192.168.56.10"
Write-Host "  Portainer  http://192.168.56.10:9000"
Write-Host "  Prometheus http://192.168.56.10:9090"
Write-Host "  Grafana    http://192.168.56.10:3001"
Write-Host "  Mailpit    http://192.168.56.10:8025"
Write-Host "  Cong khai  https://capstone.yamiannephilim.com  |  https://capstone-api.yamiannephilim.com"
Write-Host "Mat khau lab (Grafana, Portainer, Mongo): vagrant ssh manager -c 'sudo cat /opt/capstone/.env'"
Write-Host "Doi cau hinh ha tang: infra\setup.cmd"
