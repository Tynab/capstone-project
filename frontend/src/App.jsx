import "./App.css";
import { useEffect, useMemo, useReducer } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Active from "./components/Active";
import Completed from "./components/Completed";
import AllTask from "./components/AllTask";
import Layout from "./components/Layout";
import TaskContext from "./context/TaskContext";
import TokenContext from "./context/TokenContext";
import taskReducer from "./reducer/taskReducer";
import tokenReducer from "./reducer/tokenReducer";
import userReducer from "./reducer/userReducer";
import Header from "./components/Header";
import Login from "./components/Login";
import Register from "./components/Register";
import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";
import { getCurrentUser } from "./api/authApi";
import { getTasks } from "./api/taskApi";
import { setUnauthorizedHandler } from "./api/client";
import { readToken } from "./utils/authStorage";
import { TASK_ACTIONS, AUTH_ACTIONS } from "./constants";

function App() {
  const [tasks, dispatch] = useReducer(taskReducer, []);
  // readToken() parse trong try/catch: trước đây JSON.parse chạy thẳng trong
  // render nên một giá trị hỏng trong localStorage làm trắng cả màn hình.
  const [userToken, tokenDispatch] = useReducer(tokenReducer, readToken());
  const [user, userDispatch] = useReducer(userReducer, {});

  // Đồng bộ state với localStorage khi có 401: response interceptor của client.js
  // xoá được token trong localStorage nhưng không với tới state React ở đây.
  // Thiếu bước này thì người dùng có token cũ mở link reset trong email (trang
  // công khai — interceptor KHÔNG chuyển hướng) vẫn thấy Header "welcome, <tên>"
  // dù mọi request sau đó đều 401, phải F5 mới hết. Đăng ký một lần lúc mount,
  // bỏ đăng ký khi unmount. Đặt TRƯỚC các effect fetch bên dưới để handler luôn
  // sẵn sàng trước khi bất kỳ 401 nào có thể trả về.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenDispatch({ type: AUTH_ACTIONS.UNSET_TOKEN });
      userDispatch({ type: AUTH_ACTIONS.UNSET_USER });
    });
    return () => setUnauthorizedHandler(null);
    // tokenDispatch/userDispatch do useReducer cấp nên ổn định suốt vòng đời
    // component — đăng ký đúng một lần là đủ, không cần đưa vào dependency.
  }, []);

  // Cờ `cancelled`: ở chế độ dev StrictMode gọi effect 2 lần, và người dùng có
  // thể đăng xuất trong lúc request đang bay — không được ghi state từ request cũ.
  useEffect(() => {
    if (!userToken) return undefined;
    let cancelled = false;
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!cancelled) userDispatch({ type: AUTH_ACTIONS.SET_USER, payload: currentUser });
      } catch (error) {
        // 401 đã được response interceptor xử lý (xoá token, chuyển hướng khi cần)
        console.error("Không tải được thông tin người dùng:", error.message);
      }
    };
    fetchUser();
    return () => {
      cancelled = true;
    };
  }, [userToken]);

  useEffect(() => {
    if (!userToken) return undefined;
    let cancelled = false;
    const fetchTasks = async () => {
      try {
        const data = await getTasks();
        if (!cancelled) dispatch({ type: TASK_ACTIONS.SET_TASK, payload: data });
      } catch (error) {
        console.error("Không tải được danh sách task:", error.message);
      }
    };
    fetchTasks();
    return () => {
      cancelled = true;
    };
  }, [userToken]);

  // value của context là object mới mỗi lần render -> mọi consumer re-render
  // theo, kể cả khi chỉ có một phần dữ liệu đổi.
  const tokenContextValue = useMemo(
    () => ({ userToken, tokenDispatch, user, userDispatch }),
    [userToken, user]
  );
  const taskContextValue = useMemo(() => ({ tasks, dispatch }), [tasks]);

  return (
    <BrowserRouter>
      <TokenContext.Provider value={tokenContextValue}>
        <TaskContext.Provider value={taskContextValue}>
          <Routes>
            {/* Điều kiện lấy từ state (userToken) thay vì đọc lại localStorage:
                một nguồn sự thật duy nhất cho trạng thái đăng nhập. */}
            <Route path="/" element={<Header />}>
              <Route path="/" element={userToken ? <Layout /> : <Login />}>
                <Route index element={<AllTask />} />
                <Route path="active" element={<Active />} />
                <Route path="completed" element={<Completed />} />
              </Route>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgotPassword" element={<ForgotPassword />} />
              <Route path="/resetPassword" element={<ResetPassword />} />
            </Route>
          </Routes>
        </TaskContext.Provider>
      </TokenContext.Provider>
    </BrowserRouter>
  );
}

export default App;
