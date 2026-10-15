import express from "express"
import { forgotPassword, resetPassword } from "../controllers/forgotPasswordController.js"
import rateLimit from "../middleware/rateLimit.js"

const router = express.Router();

// chống spam mail và chống dò token
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many reset requests, please try again later.' })
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts, please try again later.' })

router.post("/forgotPassword", forgotLimiter, forgotPassword)
router.post("/resetPassword", resetLimiter, resetPassword)

export default router;
