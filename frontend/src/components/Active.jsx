import React, { useContext } from "react";
import Task from "./Task";
import TaskContext from "../context/TaskContext";

function Active() {
  const { tasks } = useContext(TaskContext);
  // Lọc trước rồi mới kiểm tra rỗng. Trước đây điều kiện kiểm tra mảng gốc
  // nên khi có task nhưng không task nào đang active thì trang trắng trơn.
  const activeTasks = tasks.filter((task) => !task.completed);

  return (
    <div>
      {activeTasks.length > 0 ? (
        activeTasks.map((task) => <Task key={task._id} task={task} />)
      ) : (
        <h1>No Task Found</h1>
      )}
    </div>
  );
}

export default Active;
