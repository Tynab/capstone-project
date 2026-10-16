import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, BCRYPT_ROUNDS } from "./password.js";

test("hashPassword tạo hash bcrypt và verifyPassword phân biệt đúng/sai", async () => {
  const hash = await hashPassword("matkhau1234");

  assert.ok(hash.startsWith("$2"), `hash bcrypt phải bắt đầu bằng $2, nhận ${hash.slice(0, 4)}`);
  assert.equal(await verifyPassword("matkhau1234", hash), true);
  assert.equal(await verifyPassword("sai-mat-khau", hash), false);
});

test("BCRYPT_ROUNDS giữ nguyên 10 — chính sách hash khai báo một chỗ duy nhất", () => {
  assert.equal(BCRYPT_ROUNDS, 10);
});
