import React from "react";
import { NavLink } from "react-router-dom";

function TaskIndicator() {
  return (
    <div className=" flex-grow">
      <nav>
        <ul className="flex gap-3 justify-between p-3 bg-slate-400 rounded-lg shadow-2xl">
          <li>
            {/* `end` bắt buộc: mọi đường dẫn đều bắt đầu bằng "/", nên
                            không có `end` thì tab này sáng ở cả /active và /completed. */}
            <NavLink to="/" end>
              All Task
            </NavLink>
          </li>
          <li>
            <NavLink to="/active">Active</NavLink>
          </li>
          <li>
            <NavLink to="/completed">Completed</NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export default TaskIndicator;
