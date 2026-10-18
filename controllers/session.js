const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const sendSms = require('../utils/sendSms');
const { hash, normalizePhone, phoneRequired, verifyRefresh, cookieOptions, newSession } = require('../services/session');

const fail = (status, message) => Object.assign(new Error(message), { status });
const normalizeEmail = value => {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw fail(422, 'Valid email required');
  return email;
};
const validatePassword = password => {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) throw fail(422, 'Password must be at least 8 characters and no more than 72 UTF-8 bytes');
};
async function transaction(work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const handler = work => async (req, res, next) => {
  try { await work(req, res); } catch (error) { next(error); }
};

async function deliverPhoneOtp(phone) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expires = new Date(Date.now() + 5 * 60000);
  await transaction(async client => {
    // Lock the account so simultaneous resend requests respect the cooldown.
    const result = await client.query('SELECT id FROM users WHERE phone_number=$1 FOR UPDATE', [phone]);
    if (!result.rowCount) throw fail(404, 'Phone number not registered');
    const recent = await client.query("SELECT 1 FROM otps WHERE target=$1 AND otp_type='PHONE_VERIFICATION' AND created_at>NOW()-INTERVAL '60 seconds' LIMIT 1", [phone]);
    if (recent.rowCount) throw fail(429, 'Wait 60 seconds before requesting another code');
    await client.query("UPDATE otps SET is_used=TRUE WHERE target=$1 AND otp_type='PHONE_VERIFICATION' AND NOT is_used", [phone]);
    await client.query("INSERT INTO otps(target,otp_type,otp_code_hash,expires_at,max_attempts) VALUES ($1,'PHONE_VERIFICATION',$2,$3,5)", [phone, hash(code), expires]);
  });
  const adapter = process.env.OTP_DELIVERY || 'sms';
  if (adapter === 'console') {
    console.log(`[LOCAL CONSOLE OTP] phone=${phone} code=${code} (not an SMS delivery)`);
  } else if (adapter === 'sms') {
    await sendSms({ to: phone, message: `Your verification code is: ${code}. Valid for 5 minutes.` });
  } else { throw fail(503, 'Unsupported OTP delivery adapter'); }
  return { expiresAt: expires.toISOString(), deliveryAdapter: adapter === 'console' ? 'local-console' : 'sms' };
}

exports.register = handler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  validatePassword(req.body.password);
  if (req.body.pdpaConsent === false) throw fail(422, 'Consent is required');
  const phone = req.body.phoneNumber ? normalizePhone(req.body.phoneNumber) : null;
  if (phoneRequired() && !phone) throw fail(422, 'Phone number required');
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const result = await pool.query('INSERT INTO users(email,phone_number,password_hash) VALUES ($1,$2,$3) RETURNING id,email,phone_number,created_at', [email, phone, passwordHash]);
  const user = result.rows[0];
  const delivery = process.env.AUTO_SEND_PHONE_OTP === 'true' && phone ? await deliverPhoneOtp(phone) : {};
  res.status(201).json({ success: true, message: 'User registered successfully', user, registrationId: user.id,
    maskedPhone: phone ? phone.slice(0, 3) + '•••••' + phone.slice(-4) : null, ...delivery });
});

exports.login = handler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (typeof req.body.password !== 'string' || Buffer.byteLength(req.body.password) > 72) throw fail(422, 'Password required and must not exceed 72 UTF-8 bytes');
  // Commit failed attempts before returning the error; throwing inside the transaction would undo them.
  const outcome = await transaction(async client => {
    const result = await client.query('SELECT * FROM users WHERE email=$1 FOR UPDATE', [email]);
    const user = result.rows[0];
    if (!user) return { error: fail(401, 'Invalid email or password') };
    if (user.is_locked) return { error: fail(403, 'Account is locked') };
    if (!await bcrypt.compare(req.body.password, user.password_hash)) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      await client.query("UPDATE users SET failed_login_attempts=$1,is_locked=$2,locked_at=CASE WHEN $2 THEN NOW() ELSE locked_at END,lock_reason=CASE WHEN $2 THEN 'Too many failed login attempts' ELSE lock_reason END WHERE id=$3", [attempts, attempts >= 5, user.id]);
      if (attempts >= 5) await client.query('DELETE FROM refresh_tokens WHERE user_id=$1', [user.id]);
      return { error: fail(attempts >= 5 ? 403 : 401, attempts >= 5 ? 'Account is locked' : 'Invalid email or password') };
    }
    if (phoneRequired() && !user.is_phone_verified) return { error: fail(403, 'Verify phone ownership first') };
    await client.query('UPDATE users SET failed_login_attempts=0 WHERE id=$1', [user.id]);
    return { session: await newSession(client, user, res) };
  });
  if (outcome.error) throw outcome.error;
  res.json(outcome.session);
});

exports.refreshToken = handler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) throw fail(401, 'Refresh token required');
  let decoded;
  try { decoded = verifyRefresh(token); } catch { throw fail(401, 'Invalid or expired refresh token'); }
  const session = await transaction(async client => {
    // DELETE locks and consumes exactly one old session; concurrent replay cannot also succeed.
    const consumed = await client.query('DELETE FROM refresh_tokens WHERE token_hash=$1 AND expires_at>NOW() AND NOT is_revoked RETURNING user_id', [hash(token)]);
    if (!consumed.rowCount || consumed.rows[0].user_id !== decoded.sub) throw fail(401, 'Refresh session revoked or expired');
    const result = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [decoded.sub]);
    const user = result.rows[0];
    if (!user || user.is_locked || (phoneRequired() && !user.is_phone_verified)) throw fail(403, 'Account is not eligible to sign in');
    return newSession(client, user, res);
  });
  res.json(session);
});

exports.logout = handler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (token) await pool.query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hash(token)]);
  res.clearCookie('refreshToken', cookieOptions());
  res.status(204).end();
});

exports.sendPhoneOtp = handler(async (req, res) => {
  const phone = normalizePhone(req.body.phoneNumber);
  res.json({ success: true, ...await deliverPhoneOtp(phone) });
});

exports.verifyPhoneOtp = handler(async (req, res) => {
  let phone;
  if (req.body.registrationId) {
    if (!/^[0-9a-f-]{36}$/i.test(req.body.registrationId)) throw fail(422, 'Invalid registration ID');
    const result = await pool.query('SELECT phone_number FROM users WHERE id=$1', [req.body.registrationId]);
    if (!result.rowCount) throw fail(400, 'Invalid verification');
    phone = result.rows[0].phone_number;
  } else { phone = normalizePhone(req.body.phoneNumber); }
  const code = String(req.body.code || req.body.otpCode || '');
  if (!/^\d{6}$/.test(code)) throw fail(422, 'Six-digit OTP required');
  const outcome = await transaction(async client => {
    const account = await client.query('SELECT * FROM users WHERE phone_number=$1 FOR UPDATE', [phone]);
    const user = account.rows[0];
    if (!user || user.is_locked) return { error: fail(400, 'Invalid verification') };
    const result = await client.query("SELECT * FROM otps WHERE target=$1 AND otp_type='PHONE_VERIFICATION' AND NOT is_used AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [phone]);
    const otp = result.rows[0];
    if (!otp) return { error: fail(400, 'Expired or invalid verification code') };
    if (otp.attempts >= otp.max_attempts) return { error: fail(429, 'Verification attempt limit reached') };
    if (!crypto.timingSafeEqual(Buffer.from(otp.otp_code_hash), Buffer.from(hash(code)))) {
      await client.query('UPDATE otps SET attempts=attempts+1 WHERE id=$1', [otp.id]);
      return { error: fail(400, 'Incorrect verification code') };
    }
    await client.query('UPDATE otps SET is_used=TRUE WHERE id=$1', [otp.id]);
    await client.query('UPDATE users SET is_phone_verified=TRUE WHERE id=$1', [user.id]);
    // Compatibility endpoint completes registration; original phone endpoint remains verification-only.
    return req.body.registrationId ? { session: await newSession(client, { ...user, is_phone_verified: true }, res) } : { session: { success: true, message: 'Phone number verified successfully' } };
  });
  if (outcome.error) throw outcome.error;
  res.json(outcome.session);
});
