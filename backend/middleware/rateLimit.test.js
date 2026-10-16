import test from "node:test";
import assert from "node:assert/strict";
import rateLimit, { evictExpired } from "./rateLimit.js";

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

// ---------------------------------------------------------------- middleware rateLimit()
// Các test trên chỉ phủ hàm phụ evictExpired; phần dưới phủ CHÍNH middleware — lõi của
// chống brute-force ở /login. Dùng mock.timers của node:test để đồng hồ chạy theo ý test,
// không phải chờ thật hết windowMs (15 phút ở cấu hình thật).

// req/res giả đủ cho middleware: nó chỉ đọc req.ip và gọi res.set/res.status().json.
const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name.toLowerCase()] = String(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
};

// Chạy middleware với req/res giả. nextCalled=true nghĩa là request được đi tiếp.
const run = (middleware, req, res) => {
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, res };
};

test("rateLimit: quá ngưỡng -> 429 kèm header Retry-After", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const limiter = rateLimit({ windowMs: 1000, max: 2, message: "đầy" });
  const req = { ip: "10.0.0.1" };

  const first = run(limiter, req, makeRes());
  const second = run(limiter, req, makeRes());
  const third = run(limiter, req, makeRes());

  assert.ok(first.nextCalled && second.nextCalled, "hai request đầu nằm trong ngân sách");
  assert.equal(third.nextCalled, false, "request vượt ngưỡng không được đi tiếp");
  assert.equal(third.res.statusCode, 429);
  // Retry-After cho client biết bao lâu thì thử lại — thiếu header này là contract vỡ.
  assert.equal(third.res.headers["retry-after"], "1");
  assert.equal(third.res.body.message, "đầy");
});

test("rateLimit: đồng hồ vượt windowMs thì bộ đếm reset, request đi tiếp", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const limiter = rateLimit({ windowMs: 1000, max: 2, message: "đầy" });
  const req = { ip: "10.0.0.2" };

  run(limiter, req, makeRes());
  run(limiter, req, makeRes());
  const over = run(limiter, req, makeRes());
  assert.equal(over.res.statusCode, 429);

  // Vượt quá windowMs: bucket phải hết hạn và được đếm lại từ đầu.
  t.mock.timers.tick(1001);
  const after = run(limiter, req, makeRes());
  assert.ok(after.nextCalled, "sau windowMs request phải đi tiếp với bộ đếm mới");
});

test("rateLimit: hai limiter khác nhau KHÔNG dùng chung bucket", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const login = rateLimit({ windowMs: 1000, max: 2, message: "login đầy" });
  const task = rateLimit({ windowMs: 1000, max: 2, message: "task đầy" });
  const req = { ip: "10.0.0.3" };

  run(login, req, makeRes());
  run(login, req, makeRes());

  // Bucket của login đã đầy, nhưng limiter task phải đếm riêng —
  // nếu khoá bỏ limiterId thì một route đầy sẽ khoá luôn các route khác cùng IP.
  const taskFirst = run(task, req, makeRes());
  assert.ok(taskFirst.nextCalled, "limiter task không được dùng chung bucket của login");

  const loginThird = run(login, req, makeRes());
  assert.equal(loginThird.res.statusCode, 429);
  const taskSecond = run(task, req, makeRes());
  assert.ok(taskSecond.nextCalled, "bucket task vẫn đếm riêng theo limiter của nó");
});

test("rateLimit: chạm trần MAX_BUCKETS thì bucket cũ nhất bị loại", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const limiter = rateLimit({ windowMs: 1000, max: 1, message: "đầy" });

  // Lấp đầy Map tới trần MAX_BUCKETS = 10.000, mỗi IP một bucket (max=1 để
  // request thứ hai từ cùng IP chắc chắn 429).
  const firstIp = "10.1.0.0";
  assert.ok(run(limiter, { ip: firstIp }, makeRes()).nextCalled);
  for (let i = 1; i < 10000; i++) {
    const r = run(limiter, { ip: `10.1.0.${i}` }, makeRes());
    assert.ok(r.nextCalled, `bucket ${i} phải được đi tiếp`);
  }

  // Một request nữa với IP mới đẩy Map chạm trần -> evict phải loại bucket CŨ NHẤT
  // (Map giữ thứ tự chèn). Bucket của firstIp bị loại nên bộ đếm của nó mất:
  // request từ firstIp phải đi tiếp với bucket mới (count=1, max=1).
  run(limiter, { ip: "10.1.0.10000" }, makeRes());
  const backToFirst = run(limiter, { ip: firstIp }, makeRes());
  assert.ok(backToFirst.nextCalled, "bucket cũ nhất phải bị loại khi chạm trần");
});
