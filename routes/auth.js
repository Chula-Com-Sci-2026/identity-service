const express = require("express");
const {
  register,
  sendEmailOtp,
  verifyEmailOtp,
  sendPhoneOtp,
  verifyPhoneOtp,
  login,
  logout,
  refreshToken,
  requestPasswordReset,
  resetPassword,
  lockAccount,
} = require("../controllers/auth");

const router = express.Router();
const { protect } = require("../middleware/auth");

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

// Request Password Reset
router.post("/request-password-reset", requestPasswordReset);

// Reset Password
router.post("/password-reset", resetPassword);


// Lock Account
router.post("/lock-account", lockAccount);


module.exports = router;
