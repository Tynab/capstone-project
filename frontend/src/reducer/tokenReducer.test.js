import tokenReducer from "./tokenReducer";
import { AUTH_ACTIONS } from "../constants";

describe("tokenReducer", () => {
  test("SET_TOKEN trả về token trong payload", () => {
    const next = tokenReducer(null, { type: AUTH_ACTIONS.SET_TOKEN, payload: "jwt-token-abc" });
    expect(next).toBe("jwt-token-abc");
  });

  test("UNSET_TOKEN trả về null", () => {
    const next = tokenReducer("jwt-token-abc", { type: AUTH_ACTIONS.UNSET_TOKEN });
    expect(next).toBeNull();
  });

  test("action lạ giữ nguyên state hiện tại", () => {
    const state = "jwt-token-abc";
    expect(tokenReducer(state, { type: "WEIRD_ACTION" })).toBe(state);
  });
});
