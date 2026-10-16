import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import client from "./api/client";
import { saveToken, readToken } from "./utils/authStorage";

// jsdom không cho gán window.location trực tiếp; defineProperty tạo thuộc tính
// riêng đè lên getter nguyên bản, xoá đi là khôi phục (giống client.test.js).
// Kèm search/hash/origin vì react-router đọc window.location để xác định route
// đầu và dựng URL (createBrowserURLImpl) — thiếu origin là render ném invariant.
const mockLocation = (pathname) => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { pathname, search: "", hash: "", origin: "http://localhost", href: "http://localhost/" },
  });
};

describe("App — 401 phải xoá cả state, không chỉ localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    // Đúng kịch bản lỗi thật: trang công khai nên interceptor KHÔNG chuyển
    // hướng — không có gì "che" trạng thái đăng nhập ảo ngoài handler của App.
    mockLocation("/resetPassword");
  });

  afterEach(() => {
    delete window.location;
    localStorage.clear();
  });

  test("token cũ mở trang công khai: sau 401 Header không còn trạng thái đăng nhập", async () => {
    // Người dùng có token cũ mở link reset trong email -> App gọi getUser
    // -> 401 -> interceptor xoá token trong localStorage. Trước đây state
    // (userToken/user) vẫn còn nên Header cứ "welcome, ..." cho tới khi F5.
    saveToken("token-cu-het-han");
    // KHÔNG mock axios: thay adapter để mọi request reject 401, còn request và
    // response interceptor thật của client.js chạy đúng như production.
    client.defaults.adapter = () => Promise.reject({ response: { status: 401 } });

    render(<App />);

    // Trước khi 401 trả về, state khởi tạo từ localStorage nên Header vẫn đăng nhập.
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();

    // 401 về: state phải bị xoá cùng token — Header chuyển về giao diện chưa đăng nhập.
    await waitFor(() => {
      expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Login" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register" })).toBeInTheDocument();
    // localStorage cũng đã sạch (phần interceptor làm từ trước, nay chốt lại bằng test).
    expect(readToken()).toBeNull();
  });
});
