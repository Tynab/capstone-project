import test from "node:test";
import assert from "node:assert/strict";
import { evictExpired } from "./rateLimit.js";

const makeBuckets = (entries) =>
  new Map(entries.map(([key, resetAt]) => [key, { count: 1, resetAt }]));

test("evictExpired xoá các bucket đã hết hạn và giữ bucket còn hiệu lực", () => {
  const buckets = makeBuckets([
    ["a", 100],
    ["b", 200],
    ["c", 300],
  ]);
  const deleted = evictExpired(buckets, 250, 10);

  assert.equal(deleted, 2);
  assert.deepEqual([...buckets.keys()], ["c"]);
});

test("evictExpired chỉ quét tối đa scanLimit phần tử mỗi lần gọi", () => {
  // Trần Map là 10.000 bucket: quét hết trong một request là chi phí O(n) mỗi
  // lần chạm trần. Hàm phải bị chặn trên, kể cả khi còn nhiều bucket hết hạn.
  const buckets = makeBuckets([
    ["a", 100],
    ["b", 100],
    ["c", 100],
    ["d", 100],
  ]);
  const deleted = evictExpired(buckets, 200, 2);

  assert.ok(deleted <= 2, `chỉ được xoá trong phạm vi đã quét, nhưng đã xoá ${deleted}`);
});
