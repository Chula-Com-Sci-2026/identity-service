CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) UNIQUE NOT NULL,
 phone_number varchar(20) UNIQUE, password_hash varchar(255) NOT NULL,
 is_email_verified boolean NOT NULL DEFAULT false, is_phone_verified boolean NOT NULL DEFAULT false,
 is_locked boolean NOT NULL DEFAULT false, locked_at timestamptz, lock_reason varchar(255),
 failed_login_attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash varchar(255) UNIQUE NOT NULL, device_info varchar(255), ip_address varchar(45),
 is_revoked boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS otps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target varchar(255) NOT NULL,
 otp_type varchar(30) NOT NULL, otp_code_hash varchar(255) NOT NULL,
 attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
 is_used boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_lookup ON otps(target,otp_type,created_at DESC);
