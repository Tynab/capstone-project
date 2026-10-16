import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Login from "./Login";
import TokenContext from "../context/TokenContext.js";
import { AUTH_ACTIONS } from "../constants";
import { login } from "../api/authApi";
import { saveToken } from "../utils/authStorage";

// Mock toàn bộ lớp API và nơi ghi token: test Login không cần server, chỉ kiểm
// chứng luồng dispatch/save và luồng báo lỗi.
jest.mock("../api/authApi", () => ({
  login: jest.fn(),
}));
jest.mock("../utils/authStorage", () => ({
  saveToken: jest.fn(),
}));

const renderLogin = () => {
  const tokenDispatch = jest.fn();
  const userDispatch = jest.fn();
  render(
    <MemoryRouter>
      <TokenContext.Provider value={{ userToken: null, tokenDispatch, userDispatch }}>
        <Login />
      </TokenContext.Provider>
    </MemoryRouter>
  );
  return { tokenDispatch, userDispatch };
};

const fillAndSubmit = async (email, password) => {
  await userEvent.type(screen.getByLabelText("Email address"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Login" }));
};

describe("Login", () => {
  test("đăng nhập thành công: dispatch SET_TOKEN + SET_USER và saveToken", async () => {
    const user = { _id: "u1", email: "a@b.c" };
    login.mockResolvedValue({ user, token: "jwt-abc" });
    const { tokenDispatch, userDispatch } = renderLogin();

    await fillAndSubmit("a@b.c", "secret");

    await waitFor(() => expect(saveToken).toHaveBeenCalledWith("jwt-abc"));
    expect(tokenDispatch).toHaveBeenCalledWith({
      type: AUTH_ACTIONS.SET_TOKEN,
      payload: "jwt-abc",
    });
    expect(userDispatch).toHaveBeenCalledWith({ type: AUTH_ACTIONS.SET_USER, payload: user });
    expect(login).toHaveBeenCalledWith({ email: "a@b.c", password: "secret" });
  });

  test("đăng nhập lỗi: hiện message qua FormAlert, không dispatch, không saveToken", async () => {
    login.mockRejectedValue({ response: { data: { message: "Sai mật khẩu" } } });
    const { tokenDispatch, userDispatch } = renderLogin();

    await fillAndSubmit("a@b.c", "sai");

    expect(await screen.findByRole("alert")).toHaveTextContent("Sai mật khẩu");
    expect(tokenDispatch).not.toHaveBeenCalled();
    expect(userDispatch).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });

  test("lỗi mạng: hiện fallback thay vì ném TypeError trong catch", async () => {
    login.mockRejectedValue(new Error("Network Error"));
    renderLogin();

    await fillAndSubmit("a@b.c", "secret");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không đăng nhập được. Vui lòng thử lại."
    );
  });
});
