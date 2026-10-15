// Khoá localStorage chứa JWT. Trước đây chuỗi "authToken" được gõ tay ở 6 chỗ;
// gõ sai một chỗ là app im lặng coi như chưa đăng nhập.
export const AUTH_TOKEN_KEY = "authToken";

// Tên action của reducer. Trước đây viết thẳng chuỗi ở 6 file, gõ sai một ký tự
// thì taskReducer ném Error còn hai reducer kia lặng lẽ bỏ qua.
export const TASK_ACTIONS = {
  SET_TASK: "SET_TASK",
  ADD_TASK: "ADD_TASK",
  REMOVE_TASK: "REMOVE_TASK",
  MARK_DONE: "MARK_DONE",
};

export const AUTH_ACTIONS = {
  SET_TOKEN: "SET_TOKEN",
  UNSET_TOKEN: "UNSET_TOKEN",
  SET_USER: "SET_USER",
  UNSET_USER: "UNSET_USER",
};
