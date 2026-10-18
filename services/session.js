const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const issuer = () => process.env.JWT_ISSUER || 'cant-run-alone-local';
const audience = () => process.env.JWT_AUDIENCE || 'cant-run-alone-services';
const accessKey = () => process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;
const refreshKey = () => process.env.REFRESH_TOKEN_SECRET;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  const international = digits.startsWith('0') ? '66' + digits.slice(1) : digits;
  if (!/^66\d{9}$/.test(international)) throw Object.assign(new Error('Valid Thai phone number required'), { status: 422 });
  return '+' + international;
};
const phoneRequired = () => process.env.REQUIRE_PHONE_VERIFICATION !== 'false';

function tokens(user) {
  const payload = { id: user.id, email: user.email, phoneVerified: Boolean(user.is_phone_verified) };
  const options = { algorithm: 'HS256', issuer: issuer(), subject: user.id };
  return {
    accessToken: jwt.sign(payload, accessKey(), { ...options, audience: audience(), expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }),
    refreshToken: jwt.sign({ id: user.id }, refreshKey(), { ...options, audience: audience() + '-refresh', expiresIn: '7d', jwtid: crypto.randomUUID() }),
  };
}
function verifyRefresh(token) {
  return jwt.verify(token, refreshKey(), { algorithms: ['HS256'], issuer: issuer(), audience: audience() + '-refresh' });
}
function cookieOptions() {
  return { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1/auth' };
}
async function newSession(client, user, res) {
  const pair = tokens(user);
  await client.query('INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL \'7 days\')', [user.id, hash(pair.refreshToken)]);
  res.cookie('refreshToken', pair.refreshToken, { ...cookieOptions(), maxAge: 7 * 86400000 });
  // Refresh token is only in an HttpOnly cookie, never browser-readable JSON.
  return { success: true, accessToken: pair.accessToken, userId: user.id, profileComplete: false,
    user: { id: user.id, email: user.email, isEmailVerified: user.is_email_verified, isPhoneVerified: user.is_phone_verified } };
}
module.exports = { issuer, audience, accessKey, hash, normalizePhone, phoneRequired, tokens, verifyRefresh, cookieOptions, newSession };
