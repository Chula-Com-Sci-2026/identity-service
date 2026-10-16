const express = require("express");
const {
  sendEmailOtp,
  verifyEmailOtp,
  requestPasswordReset,
  resetPassword,
} = require("../controllers/auth");

const router = express.Router();
const { register, sendPhoneOtp, verifyPhoneOtp, login, logout, refreshToken } = require("../controllers/session");

router.post("/register", register);

// Email Verification Flow
router.post("/email/send-otp", sendEmailOtp);
router.post("/email/verify-otp", verifyEmailOtp);

// Phone Verification Flow
router.post("/phone/send-otp", sendPhoneOtp);
router.post("/phone/verify-otp", verifyPhoneOtp);

// Login
router.post("/login", login);

// Logout
router.post("/logout", logout);

// Refresh Token
router.post("/refresh-token", refreshToken);
router.post("/refresh", refreshToken);
router.post("/verify-otp", verifyPhoneOtp);

// Request Password Reset
router.post("/request-password-reset", requestPasswordReset);

// Reset Password
router.post("/password-reset", resetPassword);


// Lock Account
// Admin account locking is outside the delivery scope; do not expose an unguarded route.


module.exports = router;
