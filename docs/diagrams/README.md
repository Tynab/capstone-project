# Sơ đồ hệ thống

5 sơ đồ dưới đây được vẽ bằng [archify](https://github.com/tt-a1i/archify) — mỗi sơ đồ là **một file HTML
tự chứa**: mở trực tiếp bằng trình duyệt là xem được, không cần cài gì, không cần mạng. Trong đó có thể
zoom, kéo, bấm vào từng node để đọc chi tiết, và chuyển sáng/tối.

> Nút và tooltip của khung viewer là **tiếng Anh** (archify chưa có catalog tiếng Việt); toàn bộ nội dung
> sơ đồ là tiếng Việt.

| File | Loại | Nội dung |
|---|---|---|
| [kien-truc-he-thong.html](kien-truc-he-thong.html) | `architecture` | 13 service chia nhóm, 2 VM swarm, 3 loại mạng, Cloudflare edge + tunnel, Portainer + agent, dữ liệu bền ở volume nào |
| [quy-trinh-giao-hang.html](quy-trinh-giao-hang.html) | `workflow` | Quy trình giao hàng mã nguồn trên 5 làn: IaC một lần (setup.cmd → vagrant → Ansible) và mỗi lần push (test → build → GHCR → deploy → xác minh), kèm nhánh rollback |
| [luong-du-lieu.html](luong-du-lieu.html) | `dataflow` | Dữ liệu đi đâu và lưu ở đâu: người dùng → Cloudflare → nginx → API → MongoDB; mail → Mailpit; số liệu → Prometheus → Grafana |
| [chuoi-goi-api.html](chuoi-goi-api.html) | `sequence` | Cả 10 endpoint đi qua đúng đường thật (Cloudflare → nginx → API Express → MongoDB/Mailpit), kèm chú thích rate limit, JWT, token reset |
| [vong-doi-tai-khoan.html](vong-doi-tai-khoan.html) | `lifecycle` | Khách → đăng ký → phiên (JWT 3 ngày) → đăng xuất → quên mật khẩu, kèm nhánh hết hạn/thu hồi và link hết hạn |

Mỗi sơ đồ có **file nguồn `<tên>.json`** nằm cạnh (typed JSON của archify). Sơ đồ HTML được sinh ra từ
đúng file JSON đó — **đừng sửa HTML bằng tay**, sửa JSON rồi vẽ lại.

## Vẽ lại hoặc sửa một sơ đồ

```bash
# Cần Node (repo dùng Node 20). Cài skill archify một lần:
npx skills add tt-a1i/archify --global

# Vẽ lại (thay <loại> và <tên> theo bảng trên):
node ~/.claude/skills/archify/bin/archify.mjs finalize <loại> docs/diagrams/<tên>.json docs/diagrams/<tên>.html --repo-root . --quality showcase --json
```

`<loại>` là một trong: `architecture` · `workflow` · `dataflow` · `sequence` · `lifecycle`.

`finalize` chạy đủ 4 cổng trước khi ghi file: kiểm schema → deliver → strict check → **kiểm bằng trình
duyệt thật**; chỉ khi cả bốn xanh thì file HTML mới được thay. Nếu nó báo lỗi, thông báo chỉ đích danh
chỗ cần sửa (thường là nhãn quá dài so với ô, hoặc hai phần tử quá sát nhau) — sửa JSON rồi chạy lại.

## Bằng chứng trong sơ đồ

Mọi sơ đồ đều ghi `meta.repository` = đúng repo + commit 40 ký tự mà nó mô tả, và mỗi node/state quan
trọng có trích dẫn `đường-dẫn-file: dòng` trong repo. Muốn tự kiểm:

```bash
node ~/.claude/skills/archify/bin/archify.mjs check docs/diagrams/kien-truc-he-thong.html --require-provenance
```

Sơ đồ chỉ mô tả những gì đọc được từ mã nguồn/cấu hình ở commit đó — ví dụ "Mailpit không có volume nên
mail mất khi deploy lại" là số đo thật, không phải suy đoán.
