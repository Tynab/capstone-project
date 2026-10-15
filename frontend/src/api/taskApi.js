import axios from "./client";

// Lớp API cho task. Component không tự gọi axios và không cần biết đường dẫn HTTP,
// nên đổi endpoint chỉ phải sửa ở đây.
// Header Authorization do request interceptor trong api/client.js gắn.

export const getTasks = async () => {
  const res = await axios.get("/task/getTask");
  // Backend trả { tasks: [...] } — phải bóc `.tasks`, đúng như addTask và
  // setTaskCompleted bóc `.task`. Trả nguyên res.data thì reducer nhận một object,
  // và `tasks.map(...)` ném "tasks is not iterable" làm trắng cả app sau đăng nhập.
  return res.data.tasks;
};

// Backend trả về task vừa tạo (kèm _id và createdAt) trong `task`.
export const addTask = async (title, description) => {
  const res = await axios.post("/task/addTask", { title, description });
  return res.data.task;
};

export const removeTask = async (id) => {
  const res = await axios.delete(`/task/removeTask/${id}`);
  return res.data;
};

export const setTaskCompleted = async (id, completed) => {
  const res = await axios.patch(`/task/updateTask/${id}`, { completed });
  return res.data.task;
};
