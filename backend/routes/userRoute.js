import express from 'express';
import { loginUser, registerUser,getUser } from '../controllers/userController.js';
import requireAuth from '../middleware/requireAuth.js';
import rateLimit from '../middleware/rateLimit.js';
const router = express.Router();

// chống dò mật khẩu: không có giới hạn thì /login cho phép thử mật khẩu vô hạn
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts, please try again later.' })
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many accounts created from this IP, please try again later.' })

router.post("/login", loginLimiter, loginUser);
router.post("/register", registerLimiter, registerUser);
router.get("/getuser", requireAuth, getUser)

export default router;
