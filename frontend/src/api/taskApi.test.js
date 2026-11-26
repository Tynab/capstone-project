import client from "./client";
import { getTasks, addTask, removeTask, setTaskCompleted } from "./taskApi";

// Mock toàn bộ instance axios của client.js: test taskApi chỉ cần biết nó bóc
// đúng key trong envelope {message, tasks}/{message, task} của backend.
vi.mock("./client", () => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  };
  return { __esModule: true, default: instance };
});

describe("taskApi", () => {
  test("getTasks trả res.data.tasks — trả nguyên res.data là 'tasks is not iterable' (lỗi cũ trắng app)", async () => {
    const tasks = [{ _id: "a" }, { _id: "b" }];
    client.get.mockResolvedValue({ data: { message: "ok", tasks } });
    await expect(getTasks()).resolves.toBe(tasks);
    expect(client.get).toHaveBeenCalledWith("/task/getTask");
  });

  test("addTask gọi đúng endpoint và bóc res.data.task", async () => {
    const serverTask = {
      _id: "a",
      title: "T",
      completed: false,
      createdAt: "2026-10-16T09:00:00.000Z",
    };
    client.post.mockResolvedValue({ data: { message: "ok", task: serverTask } });
    await expect(addTask("T", "mô tả")).resolves.toBe(serverTask);
    expect(client.post).toHaveBeenCalledWith("/task/addTask", {
      title: "T",
      description: "mô tả",
    });
  });

  test("removeTask gọi DELETE đúng id", async () => {
    client.delete.mockResolvedValue({ data: { message: "ok" } });
    await removeTask("id-1");
    expect(client.delete).toHaveBeenCalledWith("/task/removeTask/id-1");
  });

  test("setTaskCompleted gọi PATCH đúng id và bóc res.data.task", async () => {
    const updated = { _id: "a", completed: true };
    client.patch.mockResolvedValue({ data: { message: "ok", task: updated } });
    await expect(setTaskCompleted("a", true)).resolves.toBe(updated);
    expect(client.patch).toHaveBeenCalledWith("/task/updateTask/a", { completed: true });
  });
});
