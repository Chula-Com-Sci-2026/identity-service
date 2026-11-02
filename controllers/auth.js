const bcrypt = require("bcryptjs");
const SALT_ROUNDS = 10;
const pool = require("../config/db");
const crypto = require("node:crypto");
const sendEmail = require("../utils/sendEmail");
const { sendNotification } = require("../config/rabbitmq");

const generateOtp = () => {
  const otpCode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");
  return { otpCode, otpHash };
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

exports.verifyEmailOtp = async (req, res, next) => {
  const client = await pool.connect();
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
    const otpResult = await client.query(otpQuery, [normalizedEmail]);

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
      await client.query("UPDATE otps SET attempts = $1 WHERE id = $2", [
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
    await client.query("BEGIN");

    // มาร์ก OTP ว่าถูกใช้งานแล้ว
    await client.query("UPDATE otps SET is_used = TRUE WHERE id = $1", [
      record.id,
    ]);

    // ปรับสถานะอีเมลของ user ให้ผ่านการยืนยัน
    await client.query(
      "UPDATE users SET is_email_verified = TRUE WHERE email = $1",
      [normalizedEmail],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
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
