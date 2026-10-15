import React, { useState } from "react";
import FormAlert from "./common/FormAlert";
import { requestPasswordReset } from "../api/authApi";
import { getErrorMessage } from "../utils/getErrorMessage";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setMessage("");
    setError("");
    try {
      setMessage(await requestPasswordReset(email));
    } catch (err) {
      setError(getErrorMessage(err, "Không gửi được yêu cầu. Vui lòng thử lại."));
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="text-center">
      <h1 className="text-xl font-bold p-5">Forgot Password</h1>
      <form className="w-2/5 mx-auto p-5" onSubmit={handleSubmit}>
        <label htmlFor="forgotEmailInput" className="sr-only">
          Email address
        </label>
        <input
          type="email"
          id="forgotEmailInput"
          className="p-3 rounded-md shadow-lg w-full"
          placeholder="Enter your email"
          onChange={(e) => setEmail(e.target.value)}
          value={email}
          required
        />
        <button
          className="p-2 rounded-md shadow-md bg-indigo-700 text-white px-5 mt-10 disabled:bg-indigo-500"
          disabled={isLoading}
        >
          {isLoading ? "Sending..." : "Reset"}
        </button>
      </form>
      <div className="w-2/5 mx-auto">
        <FormAlert kind="success">{message}</FormAlert>
        <FormAlert kind="error">{error}</FormAlert>
      </div>
    </div>
  );
}

export default ForgotPassword;
