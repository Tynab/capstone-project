import { getErrorMessage } from "./getErrorMessage";

// Hàm này tồn tại vì đọc thẳng error.response.data.message trong catch sẽ ném
// TypeError khi lỗi mạng (error.response là undefined) — người dùng không thấy
// thông báo nào. Test chốt lại hành vi đó không bao giờ quay lại.
describe("getErrorMessage", () => {
  test("lỗi mạng (error.response undefined) trả fallback, không ném TypeError", () => {
    expect(getErrorMessage(new Error("Network Error"))).toBe(
      "Không kết nối được máy chủ. Vui lòng thử lại."
    );
    expect(getErrorMessage(undefined)).toBe("Không kết nối được máy chủ. Vui lòng thử lại.");
    expect(getErrorMessage(null)).toBe("Không kết nối được máy chủ. Vui lòng thử lại.");
  });

  test("message không phải string thì trả fallback", () => {
    const err = { response: { data: { message: { nested: "object" } } } };
    expect(getErrorMessage(err, "fallback riêng")).toBe("fallback riêng");
  });

  test("message là chuỗi rỗng thì trả fallback", () => {
    const err = { response: { data: { message: "" } } };
    expect(getErrorMessage(err, "fallback riêng")).toBe("fallback riêng");
  });

  test("message hợp lệ thì trả đúng message của server", () => {
    const err = { response: { data: { message: "Email đã tồn tại" } } };
    expect(getErrorMessage(err, "fallback")).toBe("Email đã tồn tại");
  });
});
