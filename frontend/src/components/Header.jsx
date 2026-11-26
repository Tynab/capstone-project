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
        {/* whitespace-nowrap + shrink-0: ở màn hẹp (390px) cột w-1/4 chỉ còn ~97px, viên "Todo App"
            bị ngắt thành 2 dòng, tràn khỏi header cao 7vh và đè lên dòng "welcome" (đã chụp thật). */}
        <div className="logo shrink-0 whitespace-nowrap px-3 text-center sm:w-1/4">
          <NavLink to="/">Todo App</NavLink>
        </div>
        <div className="flex min-w-0 justify-between">
          {userToken ? (
            <div className="flex min-w-0 items-center justify-center">
              {/* truncate: tên dài thì cắt bằng "…" thay vì đẩy nút Logout ra khỏi màn hình. */}
              <p className="mr-3 min-w-0 truncate sm:mr-5">
                welcome,{" "}
                <span className="text-base text-blue-800 capitalize sm:text-xl">{user.name}</span>
              </p>
              <button
                onClick={logout}
                className="logout mr-3 shrink-0 whitespace-nowrap sm:mr-4"
                type="button"
              >
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
