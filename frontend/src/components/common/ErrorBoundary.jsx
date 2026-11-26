import React from "react";
import { clearToken } from "../../utils/authStorage";

// Không có Error Boundary thì bất kỳ lỗi khi render đều làm React 18 unmount
// cả cây component -> người dùng chỉ thấy trang trắng, không biết chuyện gì.
// Rủi ro có thật ở đây: taskReducer ném Error với action lạ, và trạng thái auth
// đọc từ localStorage có thể hỏng.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Lỗi không bắt được khi render:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleSignOut = () => {
    clearToken();
    window.location.href = "/login";
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="mx-auto mt-10 w-11/12 max-w-lg rounded-lg bg-white p-6 text-center shadow-lg">
        <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-slate-700">
          The page could not be displayed. Reloading usually fixes it; if it keeps happening, sign
          out and sign in again.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md bg-blue-700 px-4 py-2 text-white shadow-md hover:bg-blue-800"
          >
            Reload page
          </button>
          <button
            type="button"
            onClick={this.handleSignOut}
            className="rounded-md bg-slate-600 px-4 py-2 text-white shadow-md hover:bg-slate-700"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
