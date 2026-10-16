import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateTask from "./CreateTask";
import TaskContext from "../context/TaskContext";
import { TASK_ACTIONS } from "../constants";
import { addTask } from "../api/taskApi";

vi.mock("../api/taskApi", () => ({
  addTask: vi.fn(),
}));

const renderCreate = () => {
  const dispatch = vi.fn();
  render(
    <TaskContext.Provider value={{ dispatch }}>
      <CreateTask />
    </TaskContext.Provider>
  );
  return { dispatch };
};

const fillAndSubmit = async (title, description) => {
  await userEvent.type(screen.getByLabelText("Title"), title);
  await userEvent.type(screen.getByLabelText("Description"), description);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
};

describe("CreateTask", () => {
  test("thêm thành công: dispatch ADD_TASK với đúng task do server trả về", async () => {
    // Task có _id/createdAt do SERVER sinh — object tự dựng ở client không có.
    const serverTask = {
      _id: "507f1f77bcf86cd799439011",
      title: "Việc mới",
      description: "Mô tả",
      completed: false,
      createdAt: "2026-10-16T09:00:00.000Z",
    };
    addTask.mockResolvedValue(serverTask);
    const { dispatch } = renderCreate();

    await fillAndSubmit("Việc mới", "Mô tả");

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: TASK_ACTIONS.ADD_TASK, task: serverTask })
    );
    expect(addTask).toHaveBeenCalledWith("Việc mới", "Mô tả");
    // Thành công thì xoá input và báo thành công.
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(await screen.findByRole("status")).toHaveTextContent("Task added successfully");
  });

  test("API lỗi: KHÔNG dispatch thêm task vào UI, hiện thông báo lỗi", async () => {
    // Trước đây dispatch nằm NGOÀI try/catch nên POST lỗi vẫn thêm task vào UI:
    // người dùng tưởng đã lưu, F5 mới biết là chưa.
    addTask.mockRejectedValue({ response: { data: { message: "Thiếu tiêu đề" } } });
    const { dispatch } = renderCreate();

    await fillAndSubmit("Việc mới", "Mô tả");

    expect(await screen.findByRole("alert")).toHaveTextContent("Thiếu tiêu đề");
    expect(dispatch).not.toHaveBeenCalled();
    // Giữ nguyên input để người dùng sửa và thử lại.
    expect(screen.getByLabelText("Title")).toHaveValue("Việc mới");
  });
});
