import React, { useContext, useState } from "react";
import "../styles/task.css";
import TaskContext from "../context/TaskContext";
import DeleteIcon from "./icons/DeleteIcon";
import { removeTask, setTaskCompleted } from "../api/taskApi";
import { getErrorMessage } from "../utils/getErrorMessage";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import { TASK_ACTIONS } from "../constants";

// `task` đến từ server nên đã có _id. Không còn nhận prop `id` theo index:
// index chỉ đúng trong phiên hiện tại và không map được sang bản ghi nào ở backend.
function Task({ task }) {
  const { dispatch } = useContext(TaskContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // Chỉ dispatch sau khi server xác nhận. Trước đây xoá/tick chỉ đổi state
  // client nên F5 là mọi thay đổi biến mất.
  const runPersisted = async (request, action, fallbackMessage) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await request();
      dispatch(action(result));
    } catch (err) {
      setError(getErrorMessage(err, fallbackMessage));
    } finally {
      setPending(false);
    }
  };

  const handleRemove = (e) => {
    e.preventDefault();
    runPersisted(
      () => removeTask(task._id),
      () => ({ type: TASK_ACTIONS.REMOVE_TASK, id: task._id }),
      "Không xoá được task. Vui lòng thử lại."
    );
  };

  const handleMarkDone = () => {
    runPersisted(
      () => setTaskCompleted(task._id, !task.completed),
      (updated) => ({
        type: TASK_ACTIONS.MARK_DONE,
        id: task._id,
        completed: updated.completed,
      }),
      "Không cập nhật được task. Vui lòng thử lại."
    );
  };

  return (
    <div className="bg-slate-300 py-4 rounded-lg shadow-md flex items-center justify-center gap-2 mb-3">
      <div className="mark-done">
        <input
          type="checkbox"
          className="checkbox"
          onChange={handleMarkDone}
          checked={task.completed}
          disabled={pending}
          aria-label={
            task.completed ? `Mark "${task.title}" as active` : `Mark "${task.title}" as completed`
          }
        />
      </div>
      <div className="task-info text-slate-900 text-sm w-10/12">
        <h4 className="task-title text-lg capitalize">{task.title}</h4>
        <p className="task-description">{task.description}</p>
        <div className=" italic opacity-60">
          {task?.createdAt ? <p>{formatRelativeTime(task.createdAt)}</p> : <p>just now</p>}
        </div>
        {error && (
          <p role="alert" className="mt-1 text-red-800">
            {error}
          </p>
        )}
      </div>
      <div className="remove-task text-sm text-white">
        {/* Nút thật thay cho icon gắn onClick: icon trần không nhận được
                    focus bằng bàn phím và không có tên cho screen reader. */}
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          aria-label={`Delete task "${task.title}"`}
          title="Delete task"
          className="remove-task-btn flex items-center justify-center rounded-full border-2 border-white bg-blue-700 p-1 shadow-2xl focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DeleteIcon size={22} />
        </button>
      </div>
    </div>
  );
}

export default Task;
