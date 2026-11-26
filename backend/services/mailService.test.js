import test from "node:test";
import assert from "node:assert/strict";
import { taskAddedHtml } from "./mailService.js";

// title/description là chữ người dùng gõ. Trước đây chúng được chèn THẲNG vào HTML của mail
// "Task Added", nên một task tên "<img src=x onerror=...>" hay "<a href=...>" hiện thành thẻ
// HTML thật trong hộp thư (thấy được ngay trên Mailpit của lab).
test("taskAddedHtml escape HTML trong title/description", () => {
  const html = taskAddedHtml("<script>alert(1)</script>", '<a href="http://x">bấm</a> & "trích"');
  assert.ok(!html.includes("<script>"), "không được còn thẻ <script> thô");
  assert.ok(!html.includes('<a href="http://x">'), "không được còn thẻ <a> thô");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;&#x2F;script&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("<h1>Task added successfully</h1>"), "khung mail giữ nguyên");
});

test("taskAddedHtml giữ nguyên chữ thường và tiếng Việt có dấu", () => {
  const html = taskAddedHtml("Chuẩn bị slide", "Gom ảnh chụp");
  assert.equal(
    html,
    "<h1>Task added successfully</h1><h2>Title: Chuẩn bị slide</h2><h3>Description: Gom ảnh chụp</h3>"
  );
});

test("taskAddedHtml không in chữ 'undefined' khi thiếu description", () => {
  assert.ok(!taskAddedHtml("Tiêu đề", undefined).includes("undefined"));
});
