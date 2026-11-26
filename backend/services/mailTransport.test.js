import test from "node:test";
import assert from "node:assert/strict";
import { getTransporter } from "./mailService.js";

// Trước đây MỖI lần gửi mail là một lần createTransport mới: mỗi lần thêm task là
// một lần bắt tay TCP + TLS + SMTP AUTH đầy đủ tới máy chủ mail.
test("getTransporter dùng lại cùng một transporter khi cấu hình không đổi", () => {
  const env = { SMTP_HOST: "mailpit", SMTP_PORT: "1025", SMTP_SECURE: "false" };

  assert.equal(
    getTransporter(env),
    getTransporter(env),
    "phải dùng lại transporter, không tạo mới cho mỗi lần gửi"
  );
});

test("getTransporter tạo transporter mới khi cấu hình đổi", () => {
  const a = getTransporter({ SMTP_HOST: "mailpit", SMTP_PORT: "1025" });
  const b = getTransporter({ SMTP_HOST: "smtp-khac", SMTP_PORT: "1025" });

  assert.notEqual(a, b, "cấu hình khác thì phải tạo lại");
});
