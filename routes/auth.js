const express = require('express');
const { register,sendEmailOtp,verifyEmailOtp,sendPhoneOtp,verifyPhoneOtp } = require('../controllers/auth');

const router = express.Router();
// const {protect}= require('../middleware/auth');

router.post('/register', register);

// Email Verification Flow
router.post('/email/send-otp', sendEmailOtp);
router.post('/email/verify-otp', verifyEmailOtp);

// Phone Verification Flow
router.post('/phone/send-otp', sendPhoneOtp);
router.post('/phone/verify-otp', verifyPhoneOtp);
// router.post('/login', login);
// router.get('/me', protect,getMe);

module.exports = router;