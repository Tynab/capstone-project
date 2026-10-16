// Nạp matcher của jest-dom cho Vitest (toBeInTheDocument, toBeDisabled...).
// Phải dùng entry "/vitest" — bản gốc "@testing-library/jest-dom" gắn matcher vào
// `expect` của jest nên với Vitest sẽ báo "Invalid Chai property".
import "@testing-library/jest-dom/vitest";
