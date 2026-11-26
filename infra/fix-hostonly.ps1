# Sửa adapter host-only của VirtualBox khi VM không gắn được card mạng, lỗi:
#   VERR_INTNET_FLT_IF_NOT_FOUND
#
# Cách dùng:
#   setup.ps1 tự gọi script này khi `vagrant up` gặp lỗi, và truyền -BrokenName là
#   tên interface lấy TỪ CHÍNH thông báo lỗi của VirtualBox (chính xác, không đoán).
#   Chạy tay không tham số: chỉ in chẩn đoán, không đụng gì.
#
# Vì sao không tự "dò" adapter hỏng: danh sách bridgedifs của VirtualBox còn giữ
# tên adapter đã xoá (cache của VBoxSVC), nên dò theo danh sách đó sẽ báo động giả
# trên máy đang khoẻ và tạo adapter thừa — đã gặp thật khi kiểm chứng.
#
# Cần quyền admin (tạo/xoá card mạng ảo).
param(
    [string]$VBoxManage = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe",
    [string]$BrokenName = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $VBoxManage)) {
    Write-Warning "Khong tim thay VBoxManage tai: $VBoxManage"
    Write-Warning "Chay lai kem duong dan dung: -VBoxManage 'D:\duong\dan\VBoxManage.exe'"
    exit 1
}

function Get-HostOnlyNames {
    (& $VBoxManage list hostonlyifs 2>&1) |
        Select-String '^Name:' |
        ForEach-Object { ($_ -split ':', 2)[1].Trim() }
}

if (-not $BrokenName) {
    Write-Host "Che do chan doan (khong sua gi). Host-only hien co:"
    Get-HostOnlyNames | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "Neu 'vagrant up' bao VERR_INTNET_FLT_IF_NOT_FOUND, ten interface can sua"
    Write-Host "nam ngay trong thong bao loi, dang: HostInterfaceNetworking-<TEN>. Chay lai:"
    Write-Host "  powershell -File infra\fix-hostonly.ps1 -BrokenName '<TEN>'"
    exit 0
}

Write-Host "Interface hong (theo thong bao loi cua VirtualBox): $BrokenName"

# Tạo adapter mới TRƯỚC khi xoá cái cũ, để không có lúc nào mất sạch host-only.
$createOut = (& $VBoxManage hostonlyif create 2>&1) | ForEach-Object { $_.ToString() }
$createOut | ForEach-Object { Write-Host $_ }
# VBoxManage in: Interface 'VirtualBox Host-Only Ethernet Adapter #2' was successfully created
$newName = ($createOut |
    Select-String -Pattern "Interface '(.+?)' was successfully created" |
    Select-Object -First 1).Matches[0].Groups[1].Value

if (-not $newName -or $newName -notin (Get-HostOnlyNames)) {
    throw "Khong xac dinh duoc adapter moi (doc tu output create). Dung lai de tranh dat IP sai cho."
}

& $VBoxManage hostonlyif ipconfig "$newName" --ip 192.168.56.1 --netmask 255.255.255.0 2>&1 |
    ForEach-Object { Write-Host $_ }

if ($BrokenName -eq $newName) {
    throw "Ten adapter hong trung voi adapter vua tao ($newName) — kiem tra lai tham so -BrokenName."
}
Write-Host "Xoa adapter hong: $BrokenName"
& $VBoxManage hostonlyif remove "$BrokenName" 2>&1 | ForEach-Object { Write-Host $_ }

Write-Host "Xong. Host-only hien co:"
Get-HostOnlyNames | ForEach-Object { Write-Host "  $_" }
