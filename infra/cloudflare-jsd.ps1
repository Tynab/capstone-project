# Tắt JavaScript Detections (`enable_js`) của zone Cloudflare — thứ Cloudflare tự chèn vào
# MỌI trang HTML và phá CSP chặt của frontend.
#
# VÌ SAO CẦN (đo thật 2026-10-17 — đọc trước khi sửa, mỗi dòng dưới đây là một lần đo):
#   - HTML ở edge (qua Cloudflare) dài hơn HTML ở origin đúng 938 byte: một thẻ <script>
#     inline tạo <iframe> 1x1 ẩn rồi nạp window.__CF$cv$params + /cdn-cgi/challenge-platform/
#     scripts/jsd/main.js. Đây là snippet JavaScript Detections của Cloudflare, KHÔNG phải
#     của app (origin chỉ có đúng một thẻ script: bundle của Vite).
#   - Nó được chèn với MỌI User-Agent (curl trần, UA rỗng, Chrome 141 — như nhau), không qua
#     cache (cf-cache-status: DYNAMIC), và xuất hiện ở cả hostname khác trong cùng zone
#     (portfolio.yamiannephilim.com) => tính năng MỨC ZONE, không phải của riêng capstone.
#   - Frontend đặt CSP `script-src 'self'` nên đoạn inline đó bị chặn ngay: JSD không chạy
#     được, chỉ để lại một dòng lỗi console. Không vá được bằng CSP hash vì nội dung đổi theo
#     từng request (hai trường r, t trong __CF$cv$params).
#
# VÌ SAO PHẢI GỌI API, KHÔNG CÓ NÚT TRÊN DASHBOARD:
#   Cloudflare tách JSD thành setting riêng `enable_js`, KHÔNG phải `fight_mode`. Tắt
#   "Bot fight mode" (Security -> Settings -> Bot traffic) không tắt `enable_js` — đã kiểm:
#   toggle ở dashboard hiển thị tắt mà script vẫn được chèn. Tài liệu Cloudflare nói rõ với
#   Bot Fight Mode thì JSD "automatically enabled and cannot be disabled", nên gói Free không
#   có dòng "JS detections" nào để bấm. Đường duy nhất là API:
#     GET /zones/{zone_id}/bot_management  -> xem fight_mode / enable_js
#     PUT /zones/{zone_id}/bot_management  {fight_mode: <giữ nguyên>, enable_js: false}
#   Tài liệu: https://developers.cloudflare.com/api/resources/bot_management/
#   Token cần quyền Zone -> Bot Management -> Edit (thêm Zone -> Zone -> Read nếu tra zone id
#   theo tên; hoặc truyền -ZoneId để khỏi cần quyền đó).
#
# GHI CHÚ VỀ PHẠM VI: JSD là mức zone nên tắt là tắt cho MỌI hostname trong zone, kể cả
# portfolio.yamiannephilim.com. Trên zone này không còn consumer nào dùng tín hiệu JSD
# (Bot Fight Mode đã tắt, WAF custom rules 0/5, managed rules chưa tạo) nên dữ liệu JSD vốn
# không ai tiêu thụ — chỉ tồn tại dưới dạng script fingerprint chạy trong trình duyệt khách.
#
# AN TOÀN: mặc định chỉ ĐỌC (GET) rồi in trạng thái — không đổi gì. Chỉ -Apply mới PUT, và chỉ
# PUT khi `enable_js` đang bật; `fight_mode` được gửi lại ĐÚNG giá trị đọc về — script này
# KHÔNG phải công cụ đổi Bot Fight Mode.
#
# LƯU Ý VỀ NGÔN NGỮ: chuỗi in ra màn hình cố ý KHÔNG DẤU (console PowerShell 5.1 chạy
# codepage ibm850 nên ký tự có dấu biến thành "?"); comment vẫn tiếng Việt đầy đủ.
# File này phải lưu dạng UTF-8 CÓ BOM để PowerShell 5.1 đọc đúng phần comment.

[CmdletBinding()]
param(
    # Zone cần xử lý (zone của site công khai trong lab).
    [string]$Zone = "yamiannephilim.com",

    # Bỏ qua bước tra zone id theo tên — dùng khi token chỉ có quyền Bot Management:Edit.
    [string]$ZoneId = "",

    # Token API. Bỏ trống -> lấy từ biến môi trường CF_API_TOKEN, rồi tới infra\.env.
    # KHÔNG truyền token trực tiếp trên dòng lệnh ở máy dùng chung: nó nằm lại trong history.
    [string]$Token = "",

    # THỰC SỰ tắt enable_js. Không có cờ này thì script chỉ đọc và in trạng thái.
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$ApiBase = "https://api.cloudflare.com/client/v4"

# Windows PowerShell 5.1 có thể vẫn bật TLS 1.0 mặc định -> Cloudflare từ chối với
# "Could not create SSL/TLS secure channel". Đặt tường minh TLS 1.2.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# ===== Đọc cấu hình =====
# Thứ tự cho MỌI giá trị: tham số dòng lệnh -> biến môi trường -> infra\.env (đã bị gitignore,
# nằm cạnh script này). Không in token ra màn hình ở bất kỳ nhánh nào.
function Get-EnvValue([string]$Name) {
    $v = [Environment]::GetEnvironmentVariable($Name)
    if ($v) { return $v.Trim().Trim('"').Trim("'") }
    $envFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envFile) {
        foreach ($line in (Get-Content $envFile)) {
            if ($line -match ("^\s*" + [regex]::Escape($Name) + "\s*=\s*(.+)$")) {
                # Người dùng hay dán kèm nháy bao ngoài -> cắt cho chắc.
                $val = $Matches[1].Trim().Trim('"').Trim("'")
                if ($val) { return $val }
            }
        }
    }
    return $null
}

function Resolve-Token {
    if ($Token) { return $Token.Trim() }
    return Get-EnvValue "CF_API_TOKEN"
}

# ===== Gọi API =====
# Chỉ có một cửa duy nhất tới Cloudflare (giống cách destroy.ps1 gom mọi lệnh có tác dụng
# phụ vào vài hàm) — nhờ vậy phần kiểm tra "chỉ GET trừ khi -Apply" nằm ở một chỗ.
function Invoke-CfApi {
    param([string]$Method, [string]$Path, [hashtable]$Body)
    $headers = @{ Authorization = "Bearer $script:ApiToken" }
    $uri = "$ApiBase$Path"
    try {
        if ($Body) {
            $json = $Body | ConvertTo-Json -Compress
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers `
                                     -ContentType "application/json" -Body $json
        }
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    } catch {
        # Cloudflare trả lỗi dạng {"success":false,"errors":[{"code":..,"message":..}]}.
        # In nguyên văn mã + thông điệp: phân biệt "token sai/hết hạn" với "token thiếu quyền"
        # với "API từ chối tắt khi Bot Fight Mode đang bật" — phải ĐỌC chứ không đoán, đoán ở
        # đây là vài vòng thử vô ích. Windows PowerShell 5.1 KHÔNG phải lúc nào cũng điền
        # ErrorDetails.Message (đã đo thật với token sai: rỗng), nên đọc thêm body thô từ
        # response stream — đây là cách duy nhất lấy được thông điệp thật của Cloudflare.
        $detail = $_.ErrorDetails.Message
        if (-not $detail -and $_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $detail = $reader.ReadToEnd()
                $reader.Dispose()
            } catch { }
        }
        if ($detail) {
            try {
                $parsed = $detail | ConvertFrom-Json
                $msgs = @($parsed.errors | ForEach-Object { "[$($_.code)] $($_.message)" })
                if ($msgs.Count -gt 0) { $detail = $msgs -join " | " }
            } catch { }
        }
        $status = ""
        if ($_.Exception.Response) { $status = " (HTTP $([int]$_.Exception.Response.StatusCode))" }
        # In gọn rồi thoát, KHÔNG throw: throw làm PowerShell đổ ra cả một error record dài
        # kèm CategoryInfo/FullyQualifiedErrorId, che mất đúng dòng thông điệp cần đọc.
        Write-Host ""
        Write-Host "LOI goi Cloudflare API: $Method $Path$status" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)"
        if ($detail) { Write-Host "  Cloudflare tra ve: $detail" }
        Write-Host "  Doc loi: code 10000 = token sai/het han - 403 = token thieu quyen (can Bot Management:Edit)" -ForegroundColor Yellow
        Write-Host "           'not allowed'/'feature not available' o tren = API tu choi tat khi Bot Fight Mode dang bat." -ForegroundColor Yellow
        exit 1
    }
}

# Đổi object JSON thành hashtable để vừa in ra dễ đọc vừa tra field theo tên.
function ConvertTo-FieldMap($obj) {
    $map = @{}
    foreach ($p in $obj.PSObject.Properties) { $map[$p.Name] = $p.Value }
    return $map
}

# ===== Bắt đầu =====
Write-Host ""
Write-Host "=== CLOUDFLARE JAVASCRIPT DETECTIONS (enable_js) ===" -ForegroundColor Cyan
Write-Host "Zone   : $Zone$(if ($ZoneId) { " (id truyen vao: $ZoneId)" })"
Write-Host "Che do : $(if ($Apply) { 'APPLY - se TAT enable_js neu dang bat' } else { 'CHI DOC - khong doi gi (them -Apply de tat)' })"

$script:ApiToken = Resolve-Token
if (-not $script:ApiToken) {
    Write-Host ""
    Write-Host "Khong tim thay token API. Lam mot lan:" -ForegroundColor Yellow
    Write-Host "  1. dash.cloudflare.com -> My Profile -> API Tokens -> Create Token -> Create Custom Token"
    Write-Host "     Permissions : Zone -> Bot Management -> Edit"
    Write-Host "                   Zone -> Zone -> Read            (bo qua duoc neu truyen -ZoneId)"
    Write-Host "     Zone Resources: Include -> Specific zone -> $Zone"
    Write-Host "  2. Dan token vao infra\.env (file da bi gitignore) mot dong: CF_API_TOKEN=<token>"
    Write-Host "     hoac dat bien moi truong:  `$env:CF_API_TOKEN = '<token>'"
    Write-Host ""
    Write-Host "Khong co token thi khong lam gi ca - phan con lai cua lab khong bi anh huong." -ForegroundColor Yellow
    exit 2
}
Write-Host "Token  : (da co, khong in ra man hinh)"

if ($Apply) {
    Write-Host ""
    Write-Host "CANH BAO: -Apply se doi cau hinh THAT tren zone $Zone (tat enable_js cho MOI hostname" -ForegroundColor Yellow
    Write-Host "trong zone, ke ca portfolio.yamiannephilim.com)." -ForegroundColor Yellow
}

# 1) Zone id
# Thứ tự: -ZoneId -> CF_ZONE_ID (biến môi trường hoặc infra\.env) -> tra API theo tên.
# Đường CF_ZONE_ID không cần thêm quyền nào, và đó là lý do nó tồn tại: GET /zones?name=...
# cần quyền Zone -> Zone -> Read, mà token chỉ có Bot Management -> Edit thì Cloudflare lọc
# danh sách theo quyền và trả `result: []` (HTTP 200, success: true) — KHÔNG phải lỗi xác
# thực. Đã gặp thật 2026-10-17: script cũ tưởng đó là "token sai" nên báo sai hướng.
$zoneId = $ZoneId
$zoneNguon = "-ZoneId"
if (-not $zoneId) {
    $zoneId = Get-EnvValue "CF_ZONE_ID"
    $zoneNguon = "CF_ZONE_ID"
}
if (-not $zoneId) {
    $z = Invoke-CfApi -Method "Get" -Path "/zones?name=$Zone"
    if (-not $z.result -or @($z.result).Count -eq 0) {
        Write-Host ""
        Write-Host "Khong tra duoc zone '$Zone' bang API." -ForegroundColor Red
        Write-Host "  Token VAN dung (API khong bao loi xac thuc) — nguyen nhan la thieu mot trong:"
        Write-Host "    - quyen Zone -> Zone -> Read (thieu quyen thi Cloudflare tra danh sach RONG, khong loi),"
        Write-Host "    - Zone Resources cua token khong bao gom zone nay, hoac token thuoc tai khoan khac."
        Write-Host "  Chon mot trong hai duong sau, ca hai deu khong phai sua gi them:"
        Write-Host "   A. Khong doi token — truyen thang Zone ID:"
        Write-Host "      dash.cloudflare.com -> chon zone -> Overview -> the 'API' (goc phai duoi) -> copy 'Zone ID'"
        Write-Host "      roi chay:  infra\cloudflare-jsd.cmd -ZoneId <zone-id> [-Apply]"
        Write-Host "      (hoac dan mot dong  CF_ZONE_ID=<zone-id>  vao infra\.env de khoi go lai)"
        Write-Host "   B. Sua token: them quyen Zone -> Zone -> Read (giu nguyen Bot Management -> Edit),"
        Write-Host "      luu token roi chay lai lenh cu."
        exit 2
    }
    $zoneId = @($z.result)[0].id
    $zoneNguon = "tra theo ten (token co quyen Zone:Read)"
}
Write-Host "Zone id: $zoneId  [$zoneNguon]"
Write-Host ""

# 2) Trạng thái hiện tại (GET — nhánh này không đổi gì)
$cur = (Invoke-CfApi -Method "Get" -Path "/zones/$zoneId/bot_management").result
$curMap = ConvertTo-FieldMap $cur
Write-Host "--- Trang thai bot_management hien tai ---"
foreach ($k in ($curMap.Keys | Sort-Object)) { Write-Host ("  {0,-28} = {1}" -f $k, $curMap[$k]) }
Write-Host ""

$hasJsd = $curMap.ContainsKey("enable_js")
$jsdOn = if ($hasJsd) { [bool]$curMap["enable_js"] } else { $null }
$fightOn = $curMap.ContainsKey("fight_mode") -and [bool]$curMap["fight_mode"]

if (-not $hasJsd) {
    Write-Warning "Phan hoi khong co field enable_js -> zone nay khong co JavaScript Detections. Khong lam gi."
    exit 0
}
if (-not $jsdOn) {
    Write-Host "[OK] enable_js dang TAT - khong con gi de lam." -ForegroundColor Green
    exit 0
}

if (-not $Apply) {
    Write-Host "enable_js dang BAT -> day chinh la thu chen script jsd vao HTML lam CSP bao loi." -ForegroundColor Yellow
    if ($fightOn) {
        Write-Warning "fight_mode cung dang BAT: theo tai lieu Cloudflare, JSD gan voi Bot Fight Mode va API co the tu choi tat. Tat Bot fight mode o dashboard (Security -> Settings -> Bot traffic) roi chay lai."
    }
    Write-Host "Tat bang cach chay lai voi -Apply:" -ForegroundColor Yellow
    Write-Host "  infra\cloudflare-jsd.cmd -Apply"
    exit 0
}

# 3) PUT — chỉ tắt enable_js, giữ nguyên fight_mode đúng như đọc về
$body = @{}
if ($curMap.ContainsKey("fight_mode")) { $body["fight_mode"] = $curMap["fight_mode"] }
$body["enable_js"] = $false
Write-Host "--- PUT /zones/$zoneId/bot_management ---" -ForegroundColor Yellow
Write-Host ("  body: " + ($body | ConvertTo-Json -Compress))
$null = Invoke-CfApi -Method "Put" -Path "/zones/$zoneId/bot_management" -Body $body

# 4) Đọc lại để xác nhận, KHÔNG tin lời hứa của lần PUT
$after = (Invoke-CfApi -Method "Get" -Path "/zones/$zoneId/bot_management").result
$afterMap = ConvertTo-FieldMap $after
Write-Host ""
Write-Host "--- Trang thai sau khi PUT ---"
foreach ($k in ($afterMap.Keys | Sort-Object)) { Write-Host ("  {0,-28} = {1}" -f $k, $afterMap[$k]) }
Write-Host ""
if ($afterMap.ContainsKey("enable_js") -and -not [bool]$afterMap["enable_js"]) {
    Write-Host "[OK] enable_js = false (da tat)" -ForegroundColor Green
} else {
    Write-Warning "[X] enable_js van chua tat -> doc lai phan hoi o tren; neu fight_mode dang bat thi phai tat Bot Fight Mode truoc."
    exit 1
}

Write-Host ""
Write-Host "=== KIEM CHUNG (doi vai giay cho edge cap nhat, roi chay) ===" -ForegroundColor Cyan
Write-Host "  # Git Bash / WSL (theo dung cach da do khi tim ra loi nay):"
Write-Host "  curl -s -o /dev/null -w '%{size_download}\n' 'https://capstone.yamiannephilim.com/?cb=1'   # mong doi ~1140 (bang origin)"
Write-Host "  curl -s 'https://capstone.yamiannephilim.com/?cb=1' | grep -c 'jsd/main.js'               # mong doi: 0"
Write-Host "  curl -s 'https://portfolio.yamiannephilim.com/?cb=1' | grep -c 'jsd/main.js'              # mong doi: 0 (tat la tat ca zone)"
Write-Host "  # Roi mo Chrome -> DevTools Console: khong con dong 'Executing inline script violates ... script-src'."
Write-Host ""
Write-Host "Xong. Tat JSD cho zone $Zone." -ForegroundColor Green
