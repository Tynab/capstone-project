import React, { useState, useContext } from "react";
import TaskContext from "../context/TaskContext";
import FormAlert from "./common/FormAlert";
import { addTask } from "../api/taskApi";
import { getErrorMessage } from "../utils/getErrorMessage";
import { TASK_ACTIONS } from "../constants";

function CreateTask() {
  const { dispatch } = useContext(TaskContext);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError("");
    setSuccess("");
    try {
      // Task thêm vào state là task do server trả về (có _id), không phải
      // object tự dựng ở client.
      const task = await addTask(title, description);
      dispatch({ type: TASK_ACTIONS.ADD_TASK, task });
      setTitle("");
      setDescription("");
      setSuccess("Task added successfully");
    } catch (err) {
      // Trước đây dispatch nằm NGOÀI try/catch nên POST lỗi vẫn thêm task
      // vào UI: người dùng tưởng đã lưu, F5 mới biết là chưa.
      setError(getErrorMessage(err, "Không thêm được task. Vui lòng thử lại."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="addContainer md:w-1/3 md:mx-auto mx-3 mt-3 flex justify-center">
      <div className="w-11/12">
        <form onSubmit={handleAdd}>
          <div>
            <label htmlFor="title">Title</label>
            <input
              type="text"
              name="title"
              id="title"
              value={title}
              required
              onChange={(e) => setTitle(e.target.value)}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
            />
          </div>
          <div className="my-3">
            <label htmlFor="description">Description</label>
            <textarea
              rows={5}
              name="description"
              id="description"
              value={description}
              required
              onChange={(e) => setDescription(e.target.value)}
              style={{ resize: "none" }}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
            />
          </div>
          <div className="flex justify-center">
            <button
              type="submit"
              disabled={isLoading}
              className=" bg-blue-700 rounded-md text-white px-5 py-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
        <FormAlert kind="error">{error}</FormAlert>
        <FormAlert kind="success">{success}</FormAlert>
      </div>
    </div>
  );
}

export default CreateTask;
