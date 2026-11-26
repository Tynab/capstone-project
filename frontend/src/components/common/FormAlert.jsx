import React from "react";

// Một chỗ duy nhất để hiển thị thông báo lỗi/thành công.
//
// Trước đây 4 form tự dựng khối riêng và lưu state theo hai kiểu khác nhau
// (object {message} ở Login/Register, string ở Forgot/Reset) nên không thể dùng
// chung, và hai bên cũng hiển thị bằng hai bảng màu khác nhau.
function FormAlert({ kind = "error", children }) {
  if (!children) return null;

  const palette =
    kind === "success" ? "bg-green-700 border-green-800" : "bg-red-700 border-red-800";

  return (
    <div
      role={kind === "success" ? "status" : "alert"}
      className={`${palette} mx-auto my-4 w-full rounded-lg border p-3 text-center text-white shadow-lg`}
    >
      {children}
    </div>
  );
}

export default FormAlert;
