import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import FormAlert from "./common/FormAlert";
import { resetPassword } from "../api/authApi";
import { getErrorMessage } from "../utils/getErrorMessage";

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setMessage("");
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
    } else {
      try {
        const token = searchParams.get("token");
        setMessage(await resetPassword(token, password));
      } catch (err) {
        setError(getErrorMessage(err, "Không đặt lại được mật khẩu. Vui lòng thử lại."));
      } finally {
        setIsLoading(false);
      }
    }
  };
  return (
    <div className="text-center">
      <h1 className="text-xl font-bold p-5">Reset Password</h1>
      <form className="w-2/5 mx-auto p-5" onSubmit={handleSubmit}>
        <label htmlFor="newPasswordInput" className="sr-only">
          New password (at least 8 characters)
        </label>
        <input
          type="password"
          id="newPasswordInput"
          className="p-3 rounded-md shadow-lg w-full my-4"
          placeholder="Enter new password"
          onChange={(e) => setPassword(e.target.value)}
          value={password}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <label htmlFor="confirmPasswordInput" className="sr-only">
          Confirm new password
        </label>
        <input
          type="password"
          id="confirmPasswordInput"
          className="p-3 rounded-md shadow-lg w-full my-4"
          placeholder="Confirm new password"
          onChange={(e) => setConfirmPassword(e.target.value)}
          value={confirmPassword}
          required
          autoComplete="new-password"
        />
        <button
          className="p-2 rounded-md shadow-md bg-indigo-700 text-white px-5 mt-10 disabled:bg-indigo-400"
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Reset"}
        </button>
      </form>
      <div className="w-2/5 mx-auto">
        <FormAlert kind="success">{message}</FormAlert>
        <FormAlert kind="error">{error}</FormAlert>
      </div>
    </div>
  );
}

export default ResetPassword;
