import React, { useContext } from "react";
import Task from "./Task";
import TaskContext from "../context/TaskContext";

function AllTask() {
  const { tasks } = useContext(TaskContext);
  return (
    <div>
      {tasks.length > 0 ? (
        tasks.map((task) => <Task key={task._id} task={task} />)
      ) : (
        <h1>No Task Found</h1>
      )}
    </div>
  );
}

export default AllTask;
