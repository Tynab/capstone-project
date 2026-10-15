import test from "node:test";
import assert from "node:assert/strict";
import { buildTransportOptions, hasMailConfig } from "./smtpConfig.js";

test("SMTP_HOST được đặt -> dùng host/port/secure từ env, không dùng service gmail", () => {
  const opts = buildTransportOptions({
    SMTP_HOST: "mailpit",
    SMTP_PORT: "1025",
    SMTP_SECURE: "false",
  });
  assert.equal(opts.host, "mailpit");
  assert.equal(opts.port, 1025);
  assert.equal(opts.secure, false);
  assert.equal(opts.service, undefined);
  assert.equal(opts.auth, undefined, "Mailpit chạy không auth -> không được gắn auth rỗng");
});

test("SMTP_HOST trống -> giữ nguyên hành vi Gmail cũ", () => {
  const opts = buildTransportOptions({
    GMAIL_USERNAME: "a@gmail.com",
    GMAIL_PASSWORD: "app-password",
  });
  assert.equal(opts.service, "gmail");
  assert.deepEqual(opts.auth, { user: "a@gmail.com", pass: "app-password" });
});

test("SMTP có user/pass -> gắn auth, tôn trọng SMTP_SECURE", () => {
  const opts = buildTransportOptions({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "u",
    SMTP_PASS: "p",
  });
  assert.equal(opts.secure, true);
  assert.deepEqual(opts.auth, { user: "u", pass: "p" });
});

test("hasMailConfig: true khi có SMTP_HOST, hoặc có đủ cặp GMAIL_*", () => {
  assert.equal(hasMailConfig({ SMTP_HOST: "mailpit" }), true);
  assert.equal(hasMailConfig({ GMAIL_USERNAME: "a", GMAIL_PASSWORD: "b" }), true);
  assert.equal(hasMailConfig({ GMAIL_USERNAME: "a" }), false);
  assert.equal(hasMailConfig({}), false);
});
