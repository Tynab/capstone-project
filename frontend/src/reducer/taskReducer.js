import { TASK_ACTIONS } from "../constants";

// Task được định danh bằng _id của Mongo, KHÔNG bằng vị trí trong mảng.
//
// Trước đây REMOVE_TASK/MARK_DONE so theo index mảng, nên chỉ đúng chừng nào
// client và server còn nhìn thấy cùng một thứ tự — và hoàn toàn không dùng được
// cho các endpoint thao tác theo _id ở backend.
function taskReducer(tasks, action) {
  switch (action.type) {
    case TASK_ACTIONS.ADD_TASK: {
      // action.task là task do server trả về, đã có _id và createdAt
      return [...tasks, action.task];
    }
    case TASK_ACTIONS.SET_TASK: {
      return action.payload;
    }
    case TASK_ACTIONS.REMOVE_TASK: {
      return tasks.filter((task) => task._id !== action.id);
    }
    case TASK_ACTIONS.MARK_DONE: {
      // Nhận thẳng giá trị completed đã lưu ở server thay vì tự đảo
      // trạng thái cũ, để UI không lệch khỏi DB.
      return tasks.map((task) =>
        task._id === action.id ? { ...task, completed: action.completed } : task
      );
    }
    default: {
      throw Error("Unknown Action" + action.type);
    }
  }
}

export default taskReducer;
