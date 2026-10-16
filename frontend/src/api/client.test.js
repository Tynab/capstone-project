import axiosMock from "axios";
import { readToken, clearToken } from "../utils/authStorage";
import client from "./client";

// Mock axios: bắt lấy hai interceptor mà client.js đăng ký lúc import để test
// gọi thẳng handler, không cần server HTTP thật.
// vi.mock được hoist lên trên MỌI import trong file (kể cả import "./client")
// nên client.js nhận đúng instance giả ngay lúc module load — không cần đặt
// import sau mock như jest.
vi.mock("axios", () => {
  const handlers = {};
  const instance = {
    interceptors: {
      request: {
        use: vi.fn((onFulfilled) => {
          handlers.request = onFulfilled;
        }),
      },
      response: {
        use: vi.fn((_onFulfilled, onRejected) => {
          handlers.responseError = onRejected;
        }),
      },
    },
  };
  return {
    __esModule: true,
    default: {
      // Bắt baseURL ngay lúc create chạy (module load): clearAllMocks xoá
      // lịch sử gọi của create nên không thể assert toHaveBeenCalledWith.
      create: vi.fn((config) => {
        handlers.baseURL = config && config.baseURL;
        return instance;
      }),
      __handlers: handlers,
      __instance: instance,
    },
  };
});

vi.mock("../utils/authStorage", () => ({
  readToken: vi.fn(),
  clearToken: vi.fn(),
}));

// Thay cho require("axios").default của jest (Vitest chạy ESM thật, không có
// require): module giả trả cùng một object cho mọi nơi import nên bóc
// __handlers trực tiếp từ import này.
const { __handlers } = axiosMock;

// jsdom không cho gán window.location trực tiếp; defineProperty tạo thuộc tính
// riêng đè lên getter nguyên bản, xoá đi là khôi phục.
const mockLocation = (pathname) => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { pathname, href: "http://localhost/" },
  });
};

describe("client.js — request interceptor", () => {
  beforeEach(() => vi.clearAllMocks());

  test("gắn Authorization: Bearer khi có token", () => {
    readToken.mockReturnValue("jwt-abc");
    const config = { headers: {} };
    const result = __handlers.request(config);
    expect(result.headers.Authorization).toBe("Bearer jwt-abc");
  });

  test("không có token thì không gắn Authorization", () => {
    readToken.mockReturnValue(null);
    const config = { headers: {} };
    const result = __handlers.request(config);
    expect(result.headers.Authorization).toBeUndefined();
    expect(result).toBe(config);
  });

  test("instance được tạo với baseURL mặc định là đường dẫn tương đối /api", () => {
    // Mặc định phải là TƯƠNG ĐỐI: production nginx proxy /api sang backend, dev server
    // Vite proxy tương tự (xem vite.config.mjs). Trỏ cứng localhost:8000 ở đây là bản
    // deploy gọi vào chính máy người dùng — lỗi đã từng có trong repo này.
    // (repo không có frontend/.env nên VITE_API_URL không được đặt trong môi trường test)
    expect(__handlers.baseURL).toBe("/api");
    expect(client).toBe(axiosMock.__instance);
  });
});

describe("client.js — response interceptor 401", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete window.location;
  });

  test("401 ở trang cần đăng nhập: xoá token và chuyển hướng /login", async () => {
    mockLocation("/active");
    const error = { response: { status: 401 } };
    await expect(__handlers.responseError(error)).rejects.toBe(error);
    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe("/login");
  });

  // Bốn đường công khai: người dùng có token cũ mở link reset trong email
  // (/resetPassword?token=...) vẫn bị App.js gọi getUser -> 401, nhưng KHÔNG
  // được đá sang /login — làm vậy là mất token trên query string. Đây là lỗi
  // thật đã từng xảy ra, đừng thu hẹp danh sách này.
  test.each(["/login", "/register", "/forgotPassword", "/resetPassword"])(
    "401 ở trang công khai %s: vẫn xoá token chết nhưng KHÔNG chuyển hướng",
    async (pathname) => {
      mockLocation(pathname);
      const error = { response: { status: 401 } };
      await expect(__handlers.responseError(error)).rejects.toBe(error);
      expect(clearToken).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe("http://localhost/");
    }
  );

  test("lỗi không phải 401 thì không xoá token, không chuyển hướng", async () => {
    mockLocation("/active");
    const error = { response: { status: 500 } };
    await expect(__handlers.responseError(error)).rejects.toBe(error);
    expect(clearToken).not.toHaveBeenCalled();
    expect(window.location.href).toBe("http://localhost/");
  });

  test("lỗi mạng (không có response) thì không xoá token", async () => {
    mockLocation("/active");
    const error = new Error("Network Error");
    await expect(__handlers.responseError(error)).rejects.toBe(error);
    expect(clearToken).not.toHaveBeenCalled();
    expect(window.location.href).toBe("http://localhost/");
  });
});
