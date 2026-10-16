import taskReducer from "./taskReducer";
import { TASK_ACTIONS } from "../constants";

// Task mẫu là task do SERVER trả về (có _id và createdAt) — ADD_TASK nhận đúng
// object này chứ không phải object tự dựng ở client.
const serverTask = {
  _id: "507f1f77bcf86cd799439011",
  title: "Viết báo cáo",
  description: "Báo cáo cuối khóa",
  completed: false,
  createdAt: "2026-10-16T09:00:00.000Z",
};

describe("taskReducer", () => {
  test("ADD_TASK thêm đúng task do server trả về (kèm _id)", () => {
    const next = taskReducer([], { type: TASK_ACTIONS.ADD_TASK, task: serverTask });
    expect(next).toEqual([serverTask]);
    // Không tự dựng bản sao: object trong state chính là object server trả về.
    expect(next[0]).toBe(serverTask);
  });

  test("ADD_TASK giữ nguyên các task cũ phía trước", () => {
    const old = { _id: "old", title: "Cũ" };
    const next = taskReducer([old], { type: TASK_ACTIONS.ADD_TASK, task: serverTask });
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(old);
    expect(next[1]).toBe(serverTask);
  });

  test("SET_TASK thay cả danh sách bằng payload", () => {
    const payload = [serverTask];
    const next = taskReducer([{ _id: "old", title: "Cũ" }], {
      type: TASK_ACTIONS.SET_TASK,
      payload,
    });
    expect(next).toBe(payload);
  });

  test("REMOVE_TASK lọc theo _id chứ không theo index", () => {
    const state = [
      { _id: "a", title: "A" },
      { _id: "b", title: "B" },
      { _id: "c", title: "C" },
    ];
    const next = taskReducer(state, { type: TASK_ACTIONS.REMOVE_TASK, id: "b" });
    expect(next.map((t) => t._id)).toEqual(["a", "c"]);
  });

  test("MARK_DONE nhận giá trị completed do server lưu (action.completed)", () => {
    const state = [
      { _id: "a", title: "A", completed: false },
      { _id: "b", title: "B", completed: true },
    ];
    const next = taskReducer(state, { type: TASK_ACTIONS.MARK_DONE, id: "a", completed: true });
    expect(next[0]).toEqual({ _id: "a", title: "A", completed: true });
    // Task không khớp _id giữ nguyên object cũ.
    expect(next[1]).toBe(state[1]);
  });

  test("MARK_DONE không tự đảo trạng thái cũ: dùng đúng completed server gửi về", () => {
    // Task đang completed=true; server vẫn lưu true (VD: click đúp, request sau
    // thắng). Tự đảo (!task.completed) sẽ cho false — lệch khỏi DB.
    const state = [{ _id: "a", title: "A", completed: true }];
    const next = taskReducer(state, { type: TASK_ACTIONS.MARK_DONE, id: "a", completed: true });
    expect(next[0].completed).toBe(true);
  });

  test("action lạ NÉM Error (ErrorBoundary là lưới hứng, không nuốt lặng)", () => {
    expect(() => taskReducer([], { type: "NOT_A_REAL_ACTION" })).toThrow(
      "Unknown ActionNOT_A_REAL_ACTION"
    );
  });
});
