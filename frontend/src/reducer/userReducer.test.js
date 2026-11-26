import userReducer from "./userReducer";
import { AUTH_ACTIONS } from "../constants";

describe("userReducer", () => {
  test("SET_USER trả về user trong payload", () => {
    const user = { _id: "u1", email: "a@b.c" };
    const next = userReducer({}, { type: AUTH_ACTIONS.SET_USER, payload: user });
    expect(next).toBe(user);
  });

  test("UNSET_USER trả về object rỗng", () => {
    const next = userReducer({ _id: "u1", email: "a@b.c" }, { type: AUTH_ACTIONS.UNSET_USER });
    expect(next).toEqual({});
  });

  test("action lạ giữ nguyên state hiện tại", () => {
    const state = { _id: "u1" };
    expect(userReducer(state, { type: "WEIRD_ACTION" })).toBe(state);
  });
});
