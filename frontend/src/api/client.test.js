import { readToken, clearToken } from "../utils/authStorage";

// Mock axios: bắt lấy hai interceptor mà client.js đăng ký lúc import để test
// gọi thẳng handler, không cần server HTTP thật.
jest.mock("axios", () => {
  const handlers = {};
  const instance = {
    interceptors: {
      request: {
        use: jest.fn((onFulfilled) => {
          handlers.request = onFulfilled;
        }),
      },
      response: {
        use: jest.fn((_onFulfilled, onRejected) => {
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
      create: jest.fn((config) => {
        handlers.baseURL = config && config.baseURL;
        return instance;
      }),
      __handlers: handlers,
      __instance: instance,
    },
  };
});

jest.mock("../utils/authStorage", () => ({
  readToken: jest.fn(),
  clearToken: jest.fn(),
}));

// Import sau mock để client.js nhận đúng instance giả và đăng ký interceptor.
import client from "./client";

const { __handlers } = require("axios").default;

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
  beforeEach(() => jest.clearAllMocks());

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

  test("instance được tạo với baseURL mặc định khi chưa có REACT_APP_API_URL", () => {
    // baseURL mặc định http://localhost:8000/api nằm trong mã (repo không có
    // frontend/.env nên REACT_APP_API_URL không được đặt trong môi trường test).
    expect(__handlers.baseURL).toBe("http://localhost:8000/api");
    expect(client).toBe(require("axios").default.__instance);
  });
});

describe("client.js — response interceptor 401", () => {
  beforeEach(() => jest.clearAllMocks());
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
