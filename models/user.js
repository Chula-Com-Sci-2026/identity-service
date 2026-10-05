//  -- เปิดใช้ Extension สำหรับสร้าง UUID
// CREATE EXTENSION IF NOT EXISTS "pgcrypto";

// -- ตารางผู้ใช้งานหลัก
// CREATE TABLE users (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     email VARCHAR(255) UNIQUE NOT NULL,
//     phone_number VARCHAR(20) UNIQUE,
//     password_hash VARCHAR(255) NOT NULL,
//     is_email_verified BOOLEAN DEFAULT FALSE,
//     is_phone_verified BOOLEAN DEFAULT FALSE,
    
//     -- รองรับ lockAccount & Auto-lock หลัง Login พลาดหลายครั้ง
//     is_locked BOOLEAN DEFAULT FALSE,
//     locked_at TIMESTAMPTZ,
//     lock_reason VARCHAR(255),
//     failed_login_attempts INT DEFAULT 0,
    
//     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
//     updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
// );

// -- ตารางจัดเก็บ Refresh Token (รองรับ login, logout, refreshToken)
// CREATE TABLE refresh_tokens (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//     token_hash VARCHAR(255) NOT NULL, -- เก็บ Hash ของ Token เพื่อความปลอดภัย
//     device_info VARCHAR(255),          -- เช่น User-Agent / Mobile Model
//     ip_address VARCHAR(45),
//     is_revoked BOOLEAN DEFAULT FALSE,  -- เปลี่ยนเป็น true เมื่อ logout หรือ token rotation
//     expires_at TIMESTAMPTZ NOT NULL,
//     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
// );

// -- ตาราง OTP (รองรับ sendPhoneOtp, verifyPhoneOtp, verifyEmailOtp)
// CREATE TABLE otps (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     target VARCHAR(255) NOT NULL,          -- เบอร์โทรศัพท์ หรือ Email
//     otp_type VARCHAR(20) NOT NULL,         -- 'PHONE_VERIFICATION', 'EMAIL_VERIFICATION', '2FA'
//     otp_code_hash VARCHAR(255) NOT NULL,   -- เก็บ hash ของ OTP ป้องกัน DB หลุด
//     attempts INT DEFAULT 0,                -- ป้องกัน Brute-force OTP
//     max_attempts INT DEFAULT 3,
//     is_used BOOLEAN DEFAULT FALSE,
//     expires_at TIMESTAMPTZ NOT NULL,
//     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
// );

// -- ตาราง Token รีเซ็ตรหัสผ่าน (รองรับ requestPasswordReset, resetPassword)
// CREATE TABLE password_reset_tokens (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//     token_hash VARCHAR(255) NOT NULL,
//     is_used BOOLEAN DEFAULT FALSE,
//     expires_at TIMESTAMPTZ NOT NULL,
//     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
// );