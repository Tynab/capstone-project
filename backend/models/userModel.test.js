import test from "node:test";
import assert from "node:assert/strict";
import userModel from "./userModel.js";

// resetPassword lọc theo resetToken ở HAI truy vấn mỗi lần thử (exists rồi
// findOneAndUpdate) — không có index thì mỗi lần thử là một lần quét toàn bộ
// collection users.
test("resetToken có index trong schema", () => {
  const indexed = userModel.schema.indexes().map(([fields]) => Object.keys(fields).join("+"));

  assert.ok(
    indexed.includes("resetToken"),
    `thiếu index cho resetToken; index hiện có: ${indexed.join(", ") || "(không có)"}`
  );
});
