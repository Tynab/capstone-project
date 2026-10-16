# Khởi động lại cụm VM đã dựng (dùng sau khi tắt/mở lại máy Windows).
# KHÁC setup.cmd: không kiểm/cài công cụ, không chạy Ansible, không đụng tới cấu hình —
# chỉ bật 2 VM lên rồi chờ stack tự hồi phục. Swarm giữ nguyên trạng thái trên đĩa, các
# service tự chạy lại theo replica, GitHub runner là systemd enabled nên cũng tự lên.
# LƯU Ý NGÔN NGỮ: chuỗi in ra console cố ý viết KHÔNG DẤU (console PowerShell 5.1 dùng
# codepage ibm850); comment vẫn tiếng Việt đầy đủ. File phải lưu UTF-8 CÓ BOM.

$ErrorActionPreference = "Stop"

# Trình cài Vagrant không phải lúc nào cũng thêm thư mục vào PATH -> dò thêm đường dẫn chuẩn.
function Resolve-Vagrant {
    $c = Get-Command vagrant -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in @("$env:ProgramFiles\Vagrant\bin\vagrant.exe",
                     "$env:ProgramFiles\HashiCorp\Vagrant\bin\vagrant.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$vagrant = Resolve-Vagrant
if (-not $vagrant) { throw "Khong tim thay vagrant.exe. Chay infra\setup.cmd de cai dat truoc." }

Push-Location $PSScriptRoot
try {
    Write-Host "== Bat 2 VM cua cum capstone ==" -ForegroundColor Cyan
    & $vagrant up
    if ($LASTEXITCODE -ne 0) { throw "vagrant up that bai" }

    # Sau khi VM len, swarm tu xếp lại task; đợi app trả lời rồi mới báo xong.
    Write-Host "== Cho stack tu hoi phuc (toi da 3 phut) ==" -ForegroundColor Cyan
    $ready = $false
    for ($i = 1; $i -le 36; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "http://192.168.56.10/api/health" -TimeoutSec 5 -UseBasicParsing
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 5
    }
    if (-not $ready) {
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
