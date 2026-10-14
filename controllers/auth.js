const bcrypt = require("bcryptjs");
const SALT_ROUNDS = 10;
const pool = require("../config/db");
const crypto = require('node:crypto');
const sendEmail = require('../utils/sendEmail');
const sendSms = require('../utils/sendSms');

const generateOtp = () => {
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");
  return { otpCode, otpHash };
};

exports.register = async (req, res, next) => {
  try {
    const { email, phoneNumber, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Hash Password
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const hashedPassword = await bcrypt.hash(password, salt);

    const passwordHash = await bcrypt.hash(password, salt);

    const query = `
  INSERT INTO users (email, phone_number, password_hash)
  VALUES ($1, $2, $3)
  RETURNING id, email, phone_number, created_at;
`;
    const result = await pool.query(query, [
      email,
      phoneNumber || null,
      passwordHash,
    ]);

    return res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ message: "Email or phone number already in use" });
    }
    next(error);
  }
};

exports.login = async (req, res, next) => {};
exports.logout = async (req, res, next) => {};

exports.refreshToken = async (req, res, next) => {};
exports.sendPhoneOtp = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    const cleanPhone = String(phoneNumber).trim();

    // 1. ตรวจสอบว่าเบอร์นี้มีอยู่ในระบบหรือไม่
    const userCheck = await pool.query(
      'SELECT id, is_phone_verified FROM users WHERE phone_number = $1',
      [cleanPhone]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User with this phone number does not exist',
      });
    }

    if (userCheck.rows[0].is_phone_verified) {
      return res.status(400).json({
        success: false,
        message: 'This phone number is already verified',
      });
    }

    // 2. ป้องกัน Spam (Cool-down 60 วินาที)
    // const recentOtpCheck = await pool.query(
    //   `SELECT created_at FROM otps 
    //    WHERE target = $1 AND otp_type = 'PHONE_VERIFICATION' AND is_used = FALSE
    //    ORDER BY created_at DESC LIMIT 1`,
    //   [cleanPhone]
    // );

    // if (recentOtpCheck.rows.length > 0) {
    //   const lastSent = new Date(recentOtpCheck.rows[0].created_at).getTime();
    //   const diffSeconds = Math.floor((Date.now() - lastSent) / 1000);

    //   if (diffSeconds < 60) {
    //     return res.status(429).json({
    //       success: false,
    //       message: `Please wait ${60 - diffSeconds} seconds before requesting a new OTP`,
    //     });
    //   }
    // }

    // 3. สร้าง OTP และตั้งอายุ 5 นาที
    const { otpCode, otpHash } = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // 4. บันทึก SHA-256 Hash ลงตาราง otps
    await pool.query(
      `INSERT INTO otps (target, otp_type, otp_code_hash, expires_at)
       VALUES ($1, 'PHONE_VERIFICATION', $2, $3)`,
      [cleanPhone, otpHash, expiresAt]
    );

    // 5. ส่ง SMS ผ่าน Twilio utility
    await sendSms({
      to: '66' + cleanPhone,
      message: `Your verification code is: ${otpCode}. Valid for 5 minutes.`,
    });

    return res.status(200).json({
      success: true,
      message: 'OTP sent to phone successfully',
      devOtpPreview: process.env.NODE_ENV === 'development' ? otpCode : undefined,
    });
  } catch (error) {
    next(error);
  }
};
exports.sendEmailOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. ตรวจสอบว่ามีผู้ใช้อีเมลนี้อยู่ในระบบหรือไม่
    const userCheck = await pool.query(
      "SELECT id, is_email_verified FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User with this email does not exist",
      });
    }

    if (userCheck.rows[0].is_email_verified) {
      return res.status(400).json({
        success: false,
        message: "This email is already verified",
      });
    }

    // 2. ป้องกัน Spam (Cool-down 60 วินาที)
    // const recentOtpCheck = await pool.query(
    //   `SELECT created_at FROM otps 
    //    WHERE target = $1 AND otp_type = 'EMAIL_VERIFICATION' AND is_used = FALSE
    //    ORDER BY created_at DESC LIMIT 1`,
    //   [normalizedEmail]
    // );

    // if (recentOtpCheck.rows.length > 0) {
    //   const lastSent = new Date(recentOtpCheck.rows[0].created_at).getTime();
    //   const now = Date.now();
    //   const diffSeconds = Math.floor((now - lastSent) / 1000);

    //   if (diffSeconds < 60) {
    //     return res.status(429).json({
    //       success: false,
    //       message: `Please wait ${60 - diffSeconds} seconds before requesting a new OTP`,
    //     });
    //   }
    // }

    // 3. สร้าง OTP และตั้งอายุ 5 นาที
    const { otpCode, otpHash } = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // 4. บันทึก Hash ลงตาราง otps
    await pool.query(
      `INSERT INTO otps (target, otp_type, otp_code_hash, expires_at)
       VALUES ($1, 'EMAIL_VERIFICATION', $2, $3)`,
      [normalizedEmail, otpHash, expiresAt]
    );

    // 5. เตรียมเนื้อหา HTML แล้วเรียกใช้ฟังก์ชันจาก utils
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e293b; margin-bottom: 12px;">ยืนยันอีเมลของคุณ</h2>
        <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
          กรุณานำรหัส OTP ด้านล่างนี้ไปกรอกเพื่อยืนยันที่อยู่อีเมลของคุณ:
        </p>
        <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb;">${otpCode}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">
          * รหัสนี้มีอายุการใช้งาน 5 นาที<br/>
          * หากคุณไม่ได้เป็นผู้ร้องขอ โปรดเพิกเฉยต่ออีเมลนี้
        </p>
      </div>
    `;

    await sendEmail({
      to: normalizedEmail,
      subject: 'รหัส OTP สำหรับยืนยันอีเมลของคุณ',
      html: emailHtml,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to email successfully",
      devOtpPreview: process.env.NODE_ENV === "development" ? otpCode : undefined,
    });
  } catch (error) {
    next(error);
  }
};
exports.verifyPhoneOtp = async (req, res, next) => {
  try {
    const { phoneNumber, otpCode } = req.body;

    if (!phoneNumber || !otpCode) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP code are required',
      });
    }

    const cleanPhone = String(phoneNumber).trim();
    const incomingHash = crypto
      .createHash('sha256')
      .update(String(otpCode).trim())
      .digest('hex');

    // 1. ดึง OTP รายการล่าสุดที่ยังไม่หมดอายุและยังไม่ได้ใช้
    const otpQuery = `
      SELECT id, otp_code_hash, attempts, max_attempts 
      FROM otps
      WHERE target = $1 
        AND otp_type = 'PHONE_VERIFICATION'
        AND is_used = FALSE 
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC 
      LIMIT 1;
    `;
    const otpResult = await pool.query(otpQuery, [cleanPhone]);

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.',
      });
    }

    const record = otpResult.rows[0];

    // 2. ป้องกัน Brute-force: ตรวจสอบจำนวนครั้งที่ลองกรอก
    if (record.attempts >= record.max_attempts) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. This OTP has been invalidated.',
      });
    }

    // 3. ตรวจสอบความถูกต้องของรหัส OTP
    if (record.otp_code_hash !== incomingHash) {
      const nextAttempt = record.attempts + 1;
      await pool.query('UPDATE otps SET attempts = $1 WHERE id = $2', [
        nextAttempt,
        record.id,
      ]);

      const remaining = record.max_attempts - nextAttempt;
      return res.status(400).json({
        success: false,
        message:
          remaining > 0
            ? `Incorrect OTP. ${remaining} attempts remaining.`
            : 'Incorrect OTP. Maximum attempts reached.',
      });
    }

    // 4. บันทึกผลสำเร็จแบบ Transaction
    await pool.query('BEGIN');

    // ปิดสถานะ OTP
    await pool.query('UPDATE otps SET is_used = TRUE WHERE id = $1', [
      record.id,
    ]);

    // อัปเดตสถานะผู้ใช้
    await pool.query(
      'UPDATE users SET is_phone_verified = TRUE WHERE phone_number = $1',
      [cleanPhone]
    );

    await pool.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Phone number verified successfully',
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    next(error);
  }
};
exports.verifyEmailOtp = async (req, res, next) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP code are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const incomingHash = crypto
      .createHash("sha256")
      .update(String(otpCode).trim())
      .digest("hex");

    // 1. ค้นหา OTP รายการล่าสุดของอีเมลนี้ที่ยังไม่หมดอายุและยังไม่ได้ใช้
    const otpQuery = `
      SELECT id, otp_code_hash, attempts, max_attempts 
      FROM otps
      WHERE target = $1 
        AND otp_type = 'EMAIL_VERIFICATION'
        AND is_used = FALSE 
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC 
      LIMIT 1;
    `;
    const otpResult = await pool.query(otpQuery, [normalizedEmail]);

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP. Please request a new one.",
      });
    }

    const record = otpResult.rows[0];

    // 2. ป้องกัน Brute-force: ตรวจสอบจำนวนครั้งที่ลองกรอก
    if (record.attempts >= record.max_attempts) {
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. This OTP has been invalidated.",
      });
    }

    // 3. ตรวจสอบความถูกต้องของรหัส
    if (record.otp_code_hash !== incomingHash) {
      const nextAttempt = record.attempts + 1;
      await pool.query("UPDATE otps SET attempts = $1 WHERE id = $2", [
        nextAttempt,
        record.id,
      ]);

      const remaining = record.max_attempts - nextAttempt;
      return res.status(400).json({
        success: false,
        message:
          remaining > 0
            ? `Incorrect OTP. ${remaining} attempts remaining.`
            : "Incorrect OTP. Maximum attempts reached.",
      });
    }

    // 4. ถ้ารหัสถูกต้อง: อัปเดตทั้ง otps และ users พร้อมกัน
    await pool.query("BEGIN");

    // มาร์ก OTP ว่าถูกใช้งานแล้ว
    await pool.query("UPDATE otps SET is_used = TRUE WHERE id = $1", [
      record.id,
    ]);

    // ปรับสถานะอีเมลของ user ให้ผ่านการยืนยัน
    await pool.query(
      "UPDATE users SET is_email_verified = TRUE WHERE email = $1",
      [normalizedEmail],
    );

    await pool.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    await pool.query("ROLLBACK");
    next(error);
  }
};
exports.requestPasswordReset = async (req, res, next) => {};
exports.resetPassword = async (req, res, next) => {};
exports.lockAccount = async (req, res, next) => {};
