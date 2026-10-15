const bcrypt = require("bcryptjs");
const SALT_ROUNDS = 10;
const pool = require("../config/db");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");
const sendSms = require("../utils/sendSms");
const MAX_FAILED_ATTEMPTS = 5;
const { sendNotification } = require("../config/rabbitmq");

const generateOtp = () => {
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");
  return { otpCode, otpHash };
};

const generateTokens = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
  };

  const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
  });

  const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
  });

  return { accessToken, refreshToken };
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

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. ดึงข้อมูล User พร้อมสถานะการล็อก
    const userResult = await pool.query(
      `SELECT id, email, password_hash, is_email_verified, 
              is_locked, locked_at, lock_reason, failed_login_attempts 
       FROM users 
       WHERE email = $1`,
      [normalizedEmail],
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = userResult.rows[0];

    // 2. ตรวจสอบว่าบัญชีถูกล็อกอยู่หรือไม่
    if (user.is_locked) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is locked. Please contact support or reset your password.",
        reason: user.lock_reason,
        lockedAt: user.locked_at,
      });
    }

    // 3. ตรวจสอบรหัสผ่าน
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      const currentAttempts = (user.failed_login_attempts || 0) + 1;

      // ตรวจสอบว่าจำนวนครั้งที่ผิดถึงเกณฑ์ล็อกหรือไม่
      if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
        // ล็อกบัญชีทันที และเคลียร์ session เดิมทั้งหมด
        await pool.query(
          `UPDATE users 
           SET is_locked = TRUE, 
               locked_at = CURRENT_TIMESTAMP, 
               lock_reason = 'Too many failed login attempts',
               failed_login_attempts = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [currentAttempts, user.id],
        );

        await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [
          user.id,
        ]);

        return res.status(403).json({
          success: false,
          message: `Account has been locked due to ${MAX_FAILED_ATTEMPTS} consecutive failed attempts.`,
        });
      }

      // หากยังไม่ถึงเกณฑ์ ให้อัปเดตตัวนับ failed_login_attempts
      await pool.query(
        `UPDATE users 
         SET failed_login_attempts = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [currentAttempts, user.id],
      );

      const remainingAttempts = MAX_FAILED_ATTEMPTS - currentAttempts;
      return res.status(401).json({
        success: false,
        message: `Invalid email or password. ${remainingAttempts} attempt(s) remaining before account lockout.`,
      });
    }

    // 4. ถ้ารหัสผ่านถูกต้อง: รีเซ็ตจำนวนครั้งที่ล็อกอินผิดกลับเป็น 0
    if (user.failed_login_attempts > 0) {
      await pool.query(
        `UPDATE users 
         SET failed_login_attempts = 0, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [user.id],
      );
    }

    // 5. ออก Tokens
    const { accessToken, refreshToken } = generateTokens(user);

    const tokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt],
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        isEmailVerified: user.is_email_verified,
      },
    });
  } catch (error) {
    next(error);
  }
};
exports.logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required to logout",
      });
    }

    // 1. ตรวจสอบ Signature ของ JWT เพื่อกัน Token มั่ว
    try {
      jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    // 2. แฮชและสั่งลบออกจากตาราง
    const tokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const deleteResult = await pool.query(
      "DELETE FROM refresh_tokens WHERE token_hash = $1",
      [tokenHash],
    );

    // 3. ตรวจสอบว่ามีแถวถูกลบจริงหรือไม่
    if (deleteResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Token not found or already logged out",
      });
    }

    // 4. ล้าง Cookie เมื่อตรวจสอบผ่านทั้งหมด
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    // ดึง Refresh Token จาก Cookie (หรือจาก Request Body)
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is missing",
      });
    }

    // 1. ตรวจสอบความถูกต้องของ JWT Signature
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    // 2. ตรวจสอบว่า Token Hash มีอยู่ใน Database และยังไม่หมดอายุ
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const tokenCheck = await pool.query(
      `SELECT id, user_id FROM refresh_tokens 
       WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP;`,
      [tokenHash],
    );

    if (tokenCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Refresh token revoked or expired",
      });
    }

    // 3. Token Rotation (ลบ Token เก่าทิ้ง แล้วสร้าง Token ใหม่คู่กัน)
    const oldTokenId = tokenCheck.rows[0].id;
    const userId = tokenCheck.rows[0].user_id;

    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      id: userId,
      email: decoded.email,
    });

    const newHash = crypto
      .createHash("sha256")
      .update(newRefreshToken)
      .digest("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // ทำงานแบบ Transaction โดยดึง client ออกมาจาก pool
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM refresh_tokens WHERE id = $1;", [
        oldTokenId,
      ]);
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3);`,
        [userId, newHash, newExpiresAt],
      );
      await client.query("COMMIT");
    } catch (dbErr) {
      await client.query("ROLLBACK");
      throw dbErr;
    } finally {
      client.release();
    }

    // 4. ตั้งค่า Cookie ใหม่
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      accessToken,
    });
  } catch (error) {
    next(error);
  }
};
exports.sendPhoneOtp = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const cleanPhone = String(phoneNumber).trim();

    // 1. ตรวจสอบว่าเบอร์นี้มีอยู่ในระบบหรือไม่
    const userCheck = await pool.query(
      "SELECT id, is_phone_verified FROM users WHERE phone_number = $1",
      [cleanPhone],
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User with this phone number does not exist",
      });
    }

    if (userCheck.rows[0].is_phone_verified) {
      return res.status(400).json({
        success: false,
        message: "This phone number is already verified",
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
      [cleanPhone, otpHash, expiresAt],
    );

    // 5. ส่ง SMS ผ่าน Twilio utility
    await sendSms({
      to: "66" + cleanPhone,
      message: `Your verification code is: ${otpCode}. Valid for 5 minutes.`,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to phone successfully",
      devOtpPreview:
        process.env.NODE_ENV === "development" ? otpCode : undefined,
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
      [normalizedEmail],
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
      [normalizedEmail, otpHash, expiresAt],
    );

    const emailHtml = `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px;">
    <h2 style="color: #1e293b; margin-bottom: 12px;">Verify Your Email Address</h2>
    <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
      Please enter the OTP code below to verify your email address:
    </p>
    <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb;">${otpCode}</span>
    </div>
    <p style="color: #64748b; font-size: 13px;">
      * This OTP code will expire in 5 minutes.<br/>
      * If you did not request this verification, please ignore this email.
    </p>
  </div>
`;

    // await sendEmail({
    //   to: normalizedEmail,
    //   subject: "OTP for E-mail Address Verification",
    //   html: emailHtml,
    // });
    await sendNotification({
      channelType: "EMAIL",
      target: normalizedEmail,
      subject: "OTP for E-mail Address Verification",
      templateType: "EMAIL_VERIFICATION",
      otpCode: otpCode,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to email successfully",
      devOtpPreview:
        process.env.NODE_ENV === "development" ? otpCode : undefined,
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
        message: "Phone number and OTP code are required",
      });
    }

    const cleanPhone = String(phoneNumber).trim();
    const incomingHash = crypto
      .createHash("sha256")
      .update(String(otpCode).trim())
      .digest("hex");

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

    // 3. ตรวจสอบความถูกต้องของรหัส OTP
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

    // 4. บันทึกผลสำเร็จแบบ Transaction
    await pool.query("BEGIN");

    // ปิดสถานะ OTP
    await pool.query("UPDATE otps SET is_used = TRUE WHERE id = $1", [
      record.id,
    ]);

    // อัปเดตสถานะผู้ใช้
    await pool.query(
      "UPDATE users SET is_phone_verified = TRUE WHERE phone_number = $1",
      [cleanPhone],
    );

    await pool.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Phone number verified successfully",
    });
  } catch (error) {
    await pool.query("ROLLBACK");
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
// ==========================================================
// 1. ขอรหัส OTP สำหรับรีเซ็ตรหัสผ่าน (Request Password Reset OTP)
// ==========================================================
exports.requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const userResult = await pool.query(
      "SELECT id, is_locked FROM users WHERE email = $1",
      [normalizedEmail],
    );

    if (userResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, an OTP has been sent.",
      });
    }

    const user = userResult.rows[0];

    if (user.is_locked) {
      return res.status(403).json({
        success: false,
        message: "This account has been locked. Please contact support.",
      });
    }

    const { otpCode, otpHash } = generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // อายุ 15 นาที

    await pool.query(
      `INSERT INTO otps (target, otp_type, otp_code_hash, expires_at)
       VALUES ($1, 'PASSWORD_RESET', $2, $3)`,
      [normalizedEmail, otpHash, expiresAt],
    );

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e293b; margin-bottom: 12px;">Password Reset Code</h2>
        <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
          Please use the verification code below to reset your password:
        </p>
        <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb;">${otpCode}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">
          - This code is valid for 15 minutes.<br/>
          - If you did not request this, please ignore this email. Your password will remain unchanged.
        </p>
      </div>
    `;

    // await sendEmail({
    //   to: normalizedEmail,
    //   subject: "Password Reset Verification Code",
    //   html: emailHtml,
    // });
    await sendNotification({
      channelType: "EMAIL",
      target: normalizedEmail,
      subject: "Password Reset Verification Code",
      templateType: "PASSWORD_RESET",
      otpCode: otpCode,
    });
    return res.status(200).json({
      success: true,
      message: "If an account with that email exists, an OTP has been sent.",
      devOtpPreview:
        process.env.NODE_ENV === "development" ? otpCode : undefined,
    });
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { email, otpCode, newPassword } = req.body;

    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP code, and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const incomingHash = crypto
      .createHash("sha256")
      .update(String(otpCode).trim())
      .digest("hex");

    // 1. ค้นหา OTP สำหรับ PASSWORD_RESET ล่าสุดที่ยังไม่หมดอายุและยังไม่ได้ใช้
    const otpQuery = `
      SELECT id, otp_code_hash, attempts, max_attempts 
      FROM otps
      WHERE target = $1 
        AND otp_type = 'PASSWORD_RESET'
        AND is_used = FALSE 
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC 
      LIMIT 1;
    `;
    const otpResult = await client.query(otpQuery, [normalizedEmail]);

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP. Please request a new one.",
      });
    }

    const record = otpResult.rows[0];

    if (record.attempts >= record.max_attempts) {
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. This OTP has been invalidated.",
      });
    }

    if (record.otp_code_hash !== incomingHash) {
      const nextAttempt = record.attempts + 1;
      await client.query("UPDATE otps SET attempts = $1 WHERE id = $2", [
        nextAttempt,
        record.id,
      ]);

      const remaining = record.max_attempts - nextAttempt;
      return res.status(400).json({
        success: false,
        message:
          remaining > 0
            ? `Incorrect OTP. ${remaining} attempt(s) remaining.`
            : "Incorrect OTP. Maximum attempts reached.",
      });
    }

    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await client.query("BEGIN");

    const userUpdate = await client.query(
      `UPDATE users 
       SET password_hash = $1,
           is_locked = FALSE,
           locked_at = NULL,
           lock_reason = NULL,
           failed_login_attempts = 0,
           updated_at = CURRENT_TIMESTAMP 
       WHERE email = $2
       RETURNING id`,
      [newPasswordHash, normalizedEmail],
    );

    if (userUpdate.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userId = userUpdate.rows[0].id;

    // มาร์ก OTP ว่าถูกใช้งานแล้ว
    await client.query("UPDATE otps SET is_used = TRUE WHERE id = $1", [
      record.id,
    ]);

    await client.query("DELETE FROM refresh_tokens WHERE user_id = $1", [
      userId,
    ]);

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message:
        "Password has been reset successfully. Please log in with your new password.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};
exports.lockAccount = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { userId, isLocked = true, reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    await client.query("BEGIN");

    let updateQuery;
    let queryParams;

    if (Boolean(isLocked)) {
      updateQuery = `
        UPDATE users 
        SET is_locked = TRUE,
            locked_at = CURRENT_TIMESTAMP,
            lock_reason = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, email, is_locked, locked_at, lock_reason;
      `;
      queryParams = [reason || "Locked by administrator", userId];

      // เตะออกจากทุกระบบทันที
      await client.query("DELETE FROM refresh_tokens WHERE user_id = $1;", [
        userId,
      ]);
    } else {
      updateQuery = `
        UPDATE users 
        SET is_locked = FALSE,
            locked_at = NULL,
            lock_reason = NULL,
            failed_login_attempts = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, email, is_locked;
      `;
      queryParams = [userId];
    }

    const updateResult = await client.query(updateQuery, queryParams);

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: isLocked
        ? "Account has been locked successfully"
        : "Account has been unlocked successfully",
      user: updateResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};
