import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Task from "./Task";
import TaskContext from "../context/TaskContext";
import { TASK_ACTIONS } from "../constants";
import { removeTask, setTaskCompleted } from "../api/taskApi";

vi.mock("../api/taskApi", () => ({
  removeTask: vi.fn(),
  setTaskCompleted: vi.fn(),
}));

// Task đến từ server nên đã có _id và createdAt.
const task = {
  _id: "507f1f77bcf86cd799439011",
  title: "Viết báo cáo",
  description: "Báo cáo cuối khóa",
  completed: false,
  createdAt: "2026-10-16T09:00:00.000Z",
};

const renderTask = (overrides = {}) => {
  const dispatch = vi.fn();
  render(
    <TaskContext.Provider value={{ dispatch }}>
      <Task task={{ ...task, ...overrides }} />
    </TaskContext.Provider>
  );
  return { dispatch };
};

const checkbox = () => screen.getByRole("checkbox", { name: `Mark "${task.title}" as completed` });

describe("Task", () => {
  test("tick xong: chỉ dispatch MARK_DONE sau khi server xác nhận, completed lấy từ server", async () => {
    setTaskCompleted.mockResolvedValue({ _id: task._id, completed: true });
    const { dispatch } = renderTask();

    await userEvent.click(checkbox());

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: TASK_ACTIONS.MARK_DONE,
        id: task._id,
        completed: true,
      })
    );
    // Gửi lên server giá trị đảo (!completed), không đảo ở client.
    expect(setTaskCompleted).toHaveBeenCalledWith(task._id, true);
  });

  test("trong lúc chờ server: khoá cả checkbox lẫn nút xoá, chưa dispatch gì", async () => {
    let resolveApi;
    setTaskCompleted.mockReturnValue(
      new Promise((resolve) => {
        resolveApi = resolve;
      })
    );
    const { dispatch } = renderTask();

    await userEvent.click(checkbox());

    // Server chưa trả lời: hai thao tác đều bị khoá để không gọi trùng.
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: `Delete task "${task.title}"` })).toBeDisabled();
    expect(dispatch).not.toHaveBeenCalled();

    await act(async () => {
      resolveApi({ _id: task._id, completed: true });
    });
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: TASK_ACTIONS.MARK_DONE,
        id: task._id,
        completed: true,
      })
    );
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });

  test("xoá: chỉ dispatch REMOVE_TASK khi server xác nhận", async () => {
    removeTask.mockResolvedValue({ message: "ok" });
    const { dispatch } = renderTask();

    await userEvent.click(screen.getByRole("button", { name: `Delete task "${task.title}"` }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: TASK_ACTIONS.REMOVE_TASK, id: task._id })
    );
    expect(removeTask).toHaveBeenCalledWith(task._id);
  });

  test("server lỗi khi tick: không dispatch, hiện lỗi trong chính task đó", async () => {
    setTaskCompleted.mockRejectedValue({ response: { data: { message: "Server bận" } } });
    const { dispatch } = renderTask();

    await userEvent.click(checkbox());

    expect(await screen.findByRole("alert")).toHaveTextContent("Server bận");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
