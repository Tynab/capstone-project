import React, { useContext } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import TokenContext from "../context/TokenContext.js";
import { clearToken } from "../utils/authStorage";
import { AUTH_ACTIONS } from "../constants";
import "../styles/header.css";

function Header() {
  // Lấy từ context thay vì đọc thẳng localStorage: trước đây trang này có
  // nguồn sự thật thứ hai cho token, song song với state của App.
  const { userToken, user, tokenDispatch, userDispatch } = useContext(TokenContext);
  const navigate = useNavigate();

  // Đăng xuất bằng cách cập nhật state thay vì reload cả trang: reload xoá
  // sạch state một cách thô bạo và làm mất luôn mọi thứ đang dở.
  const logout = () => {
    clearToken();
    tokenDispatch({ type: AUTH_ACTIONS.UNSET_TOKEN });
    userDispatch({ type: AUTH_ACTIONS.UNSET_USER });
    navigate("/login");
  };

  return (
    <div>
      <nav className="header bg-slate-200 flex justify-between items-center">
        <div className="logo w-1/4 text-center">
          <NavLink to="/">Todo App</NavLink>
        </div>
        <div className="flex justify-between">
          {userToken ? (
            <div className="flex items-center justify-center">
              <p className="mr-5">
                welcome, <span className=" text-xl text-blue-800 capitalize">{user.name}</span>
              </p>
              <button onClick={logout} className="logout mr-4" type="button">
                Logout
              </button>
            </div>
          ) : (
            <ul className="flex justify-end gap-3 w-3/4 pr-6">
              <li>
                <NavLink to="/login">Login</NavLink>
              </li>
              <li>
                <NavLink to="/register">Register</NavLink>
              </li>
            </ul>
          )}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}

export default Header;
