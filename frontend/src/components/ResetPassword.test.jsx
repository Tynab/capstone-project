import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ResetPassword from "./ResetPassword";
import { resetPassword } from "../api/authApi";

vi.mock("../api/authApi", () => ({
  resetPassword: vi.fn(),
}));

const renderReset = (token) =>
  render(
    <MemoryRouter initialEntries={[token ? `/resetPassword?token=${token}` : "/resetPassword"]}>
      <ResetPassword />
    </MemoryRouter>
  );

const fillAndSubmit = async (password, confirm) => {
  await userEvent.type(screen.getByLabelText("New password (at least 8 characters)"), password);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
};

describe("ResetPassword", () => {
  test("hai mật khẩu không khớp: hiện lỗi và KHÔNG gọi API", async () => {
    renderReset("tok-123");
    await fillAndSubmit("password1", "password2");

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(resetPassword).not.toHaveBeenCalled();
  });

  test("khớp nhau: gọi resetPassword với token trên query string và hiện message", async () => {
    resetPassword.mockResolvedValue("Đã đổi mật khẩu thành công");
    renderReset("tok-123");
    await fillAndSubmit("password1", "password1");

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith("tok-123", "password1"));
    expect(await screen.findByRole("status")).toHaveTextContent("Đã đổi mật khẩu thành công");
  });

  test("API lỗi: hiện thông báo lỗi từ server", async () => {
    resetPassword.mockRejectedValue({ response: { data: { message: "Token hết hạn" } } });
    renderReset("tok-cu");
    await fillAndSubmit("password1", "password1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Token hết hạn");
  });
});
