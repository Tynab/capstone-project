import React, { useContext } from "react";
import TaskContext from "../context/TaskContext";
import CompletedTask from "./CompletedTask";

function Completed() {
  const { tasks } = useContext(TaskContext);
  // Lọc trước rồi mới kiểm tra rỗng — xem ghi chú trong Active.jsx.
  const completedTasks = tasks.filter((task) => task.completed);

  return (
    <div>
      {completedTasks.length > 0 ? (
        completedTasks.map((task) => (
          // CompletedTask không nhận prop id: trước đây cha vẫn truyền
          // id={index} nhưng component bỏ qua, thành prop chết.
          <CompletedTask key={task._id} task={task} />
        ))
      ) : (
        <h1>No Task Found</h1>
      )}
    </div>
  );
}

export default Completed;
