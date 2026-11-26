// ESLint 9 flat config — thay cho `eslintConfig: { extends: ["react-app"] }` của CRA.
//
// Vì sao cần file này: CRA nhúng ESLint vào chính `npm run build` (build đỏ nếu có lỗi
// lint). Vite KHÔNG làm vậy, nên nếu không thêm thì mất luôn lưới lint mà không ai để ý.
// Ở đây tách thành script riêng `npm run lint` và CI chạy nó thành một bước độc lập.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "build/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs["recommended-latest"].rules,
      // React 17+ dùng JSX runtime tự động nên không cần import React trong mọi file.
      "react/react-in-jsx-scope": "off",
      // Repo không dùng prop-types (thuần JavaScript, không có kiểm kiểu).
      "react/prop-types": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["src/**/*.{test,spec}.{js,jsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
  },
];
