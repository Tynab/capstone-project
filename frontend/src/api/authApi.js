import axios from "./client";

// Lớp API cho người dùng. Header Authorization do request interceptor gắn,
// nên không nơi nào ở đây phải dựng header bằng tay.

export const login = async ({ email, password }) => {
  const res = await axios.post("/user/login", { email, password });
  return res.data; // { user, token }
};

export const register = async ({ name, email, password }) => {
  const res = await axios.post("/user/register", { name, email, password });
  return res.data; // { user, token }
};

export const getCurrentUser = async () => {
  const res = await axios.get("/user/getUser");
  return res.data.user;
};

export const requestPasswordReset = async (email) => {
  const res = await axios.post("/forgotPassword/forgotPassword", { email });
  return res.data.message;
};

export const resetPassword = async (token, password) => {
  const res = await axios.post("/forgotPassword/resetPassword", { token, password });
  return res.data.message;
};
