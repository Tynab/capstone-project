import React, { useState, useContext } from "react";
import { Navigate } from "react-router-dom";
import TokenContext from "../context/TokenContext.js";
import FormAlert from "./common/FormAlert";
import { register } from "../api/authApi";
import { getErrorMessage } from "../utils/getErrorMessage";
import { saveToken } from "../utils/authStorage";
import { AUTH_ACTIONS } from "../constants";

function Register() {
  const [formData, setFormData] = useState({});
  const { userToken, tokenDispatch, userDispatch } = useContext(TokenContext);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError("");
    try {
      const { user, token } = await register(formData);
      tokenDispatch({ type: AUTH_ACTIONS.SET_TOKEN, payload: token });
      userDispatch({ type: AUTH_ACTIONS.SET_USER, payload: user });
      saveToken(token);
    } catch (err) {
      setError(getErrorMessage(err, "Không đăng ký được. Vui lòng thử lại."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      {userToken && <Navigate to="/" />}
      <section className="register-container">
        <div className="container px-6 py-12 h-full">
          <div className="flex justify-center items-center flex-wrap h-full g-6 text-gray-800">
            <div className="md:w-8/12 lg:w-6/12 mb-12 md:mb-0">
              <img
                src="https://png.pngtree.com/png-clipart/20240502/original/pngtree-flat-design-concepts-online-learning-with-online-teacher-in-computer-png-image_14991353.png"
                className="w-full"
                alt="Illustration of someone setting up a new account"
              />
            </div>
            <div className="md:w-8/12 lg:w-5/12 lg:ml-20">
              <form method="post" onSubmit={handleSubmit}>
                <FormAlert kind="error">{error}</FormAlert>
                <div className="mb-6">
                  <label htmlFor="nameInput" className="sr-only">
                    Full name
                  </label>
                  <input
                    type="text"
                    name="name"
                    id="nameInput"
                    className="form-control block w-full px-4 py-2 text-xl font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none"
                    placeholder="Full name"
                    onChange={handleChange}
                  />
                </div>
                <div className="mb-6">
                  <label htmlFor="registerEmailInput" className="sr-only">
                    Email address
                  </label>
                  <input
                    type="text"
                    name="email"
                    id="registerEmailInput"
                    className="form-control block w-full px-4 py-2 text-xl font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none"
                    placeholder="Email address"
                    onChange={handleChange}
                  />
                </div>
                <div className="mb-6">
                  <label htmlFor="registerPassInput" className="sr-only">
                    Password (at least 8 characters)
                  </label>
                  <input
                    type="password"
                    name="password"
                    id="registerPassInput"
                    minLength={8}
                    className="form-control block w-full px-4 py-2 text-xl font-normal text-gray-700 bg-white bg-clip-padding border border-solid border-gray-300 rounded transition ease-in-out m-0 focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none"
                    placeholder="Password (at least 8 characters)"
                    onChange={handleChange}
                  />
                </div>
                {/* Ô "Remember me" và hai nút Facebook/Twitter đã bỏ:
                                    ô tick không điều khiển gì (token luôn được lưu) và hai
                                    nút kia là href="#!" nên chỉ là hình thức gây nhầm. */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-block px-7 py-3 bg-blue-600 text-white font-medium text-sm leading-snug uppercase rounded shadow-md hover:bg-blue-700 hover:shadow-lg focus:bg-blue-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-blue-800 active:shadow-lg transition duration-150 ease-in-out w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading ? "Creating account..." : "Register"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Register;
