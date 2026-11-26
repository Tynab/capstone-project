import React from "react";

// Thay cho @mui/icons-material/Delete. Cả app chỉ dùng đúng một icon này, nhưng
// đường import đó kéo theo @mui/material + emotion + styled-components vào bundle.
// Icon thừa hưởng màu chữ (fill="currentColor") nên vẫn ăn theo class Tailwind.
function DeleteIcon({ size = 24, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

export default DeleteIcon;
