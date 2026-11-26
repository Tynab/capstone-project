import { readToken, saveToken, clearToken } from "./authStorage";
import { AUTH_TOKEN_KEY } from "../constants";

describe("authStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("saveToken ghi JSON.stringify(token) và readToken đọc lại đúng", () => {
    saveToken("jwt-abc");
    expect(readToken()).toBe("jwt-abc");
    // Ghi bằng JSON.stringify: giá trị thô trong localStorage là chuỗi kèm nháy.
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe(JSON.stringify("jwt-abc"));
  });

  test("clearToken xoá khoá khỏi localStorage", () => {
    saveToken("jwt-abc");
    clearToken();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  test("chưa có token thì readToken trả null", () => {
    expect(readToken()).toBeNull();
  });

  test("giá trị hỏng (JSON.parse ném) thì trả null chứ không ném — lỗi cũ làm trắng cả app", () => {
    // Trước đây lời gọi parse nằm thẳng trong render của App.js: một giá trị hỏng
    // (người dùng sửa tay, dữ liệu cũ) làm cả cây component unmount.
    localStorage.setItem(AUTH_TOKEN_KEY, "{not-json");
    expect(() => readToken()).not.toThrow();
    expect(readToken()).toBeNull();
  });
});
