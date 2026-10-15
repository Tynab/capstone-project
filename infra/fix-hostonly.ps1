# Sửa adapter host-only của VirtualBox khi VM không gắn được card mạng, lỗi:
#   VERR_INTNET_FLT_IF_NOT_FOUND
#
# Nguyên nhân đã gặp thật trên Windows 11 + VirtualBox 7.2.20: adapter do trình
# cài tạo ra bị hỏng trạng thái — nó nằm trong cả danh sách host-only (Up) lẫn
# danh sách bridged, và VBoxManage cảnh báo "Interface ... is of type bridged".
# Cách sửa: tạo một adapter host-only MỚI rồi xoá những cái đang ở trạng thái hỏng.
#
# Cần quyền admin (tạo/xoá card mạng ảo). setup.ps1 tự gọi script này khi gặp lỗi.
$ErrorActionPreference = "Stop"
$vbm = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

function Get-HostOnlyNames {
    (& $vbm list hostonlyifs 2>&1) |
        Select-String '^Name:' |
        ForEach-Object { ($_ -split ':', 2)[1].Trim() }
}

# Adapter nằm trong danh sách bridged nhưng tên là host-only = adapter hỏng.
$brokenNames = (& $vbm list bridgedifs 2>&1) |
    Select-String -Pattern '^Name:\s+VirtualBox Host-Only Ethernet Adapter.*$' |
    ForEach-Object { ($_.Line -split ':', 2)[1].Trim() }

if (-not $brokenNames) {
    Write-Host "Khong thay adapter host-only hong. Khong can sua."
    exit 0
}
Write-Host "Adapter hong: $($brokenNames -join ', ')"

# Tạo adapter mới trước khi xoá cái cũ, để không có lúc nào mất sạch host-only.
$createOut = & $vbm hostonlyif create 2>&1
$createOut | ForEach-Object { Write-Host $_ }
$newName = (Get-HostOnlyNames | Select-Object -Last 1)
if (-not $newName) { throw "Khong tao duoc adapter host-only moi" }

& $vbm hostonlyif ipconfig "$newName" --ip 192.168.56.1 --netmask 255.255.255.0 2>&1 |
    ForEach-Object { Write-Host $_ }

foreach ($name in $brokenNames) {
    if ($name -eq $newName) { continue }
    Write-Host "Xoa adapter hong: $name"
    & $vbm hostonlyif remove "$name" 2>&1 | ForEach-Object { Write-Host $_ }
}

Write-Host "Xong. Host-only hien co:"
Get-HostOnlyNames | ForEach-Object { Write-Host "  $_" }
