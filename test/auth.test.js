const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
if (!process.env.TEST_DATABASE_URL || !/_test(?:\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('TEST_DATABASE_URL must point to an isolated _test database');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.CONFIG_FILE = '/nonexistent';
process.env.OTP_DELIVERY = 'console';
process.env.AUTO_SEND_PHONE_OTP = 'true';
process.env.REQUIRE_PHONE_VERIFICATION = 'true';
process.env.COOKIE_SECURE = 'false';
const pool = require('../config/db');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('../app');
const { hash, tokens, normalizePhone } = require('../services/session');
let server, base;

test.before(async () => {
  await migrate();
  server = createApp().listen(0, '0.0.0.0');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
async function request(path, body, cookie) {
  const response = await fetch(base + '/api/v1/auth' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
async function register() {
  const marker = crypto.randomUUID();
  const phone = '+66' + crypto.randomInt(100000000, 999999999);
  let code;
  const original = console.log;
  console.log = (...args) => { const match = args.join(' ').match(/code=(\d{6})/); if (match) code = match[1]; };
  const body = { email: marker + '@example.com', phoneNumber: phone, password: 'runner123', pdpaConsent: true };
  let result;
  try { result = await request('/register', body); } finally { console.log = original; }
  assert.equal(result.status, 201);
  assert.ok(code);
  return { ...body, id: result.body.registrationId, code };
}
async function verified() {
  const account = await register();
  const result = await request('/verify-otp', { registrationId: account.id, code: account.code });
  assert.equal(result.status, 200);
  return { account, result };
}

test('registration, verification and login produce interoperable JWTs and HttpOnly cookies', async () => {
  const account = await register();
  assert.equal((await request('/login', account)).status, 403);
  const verified = await request('/verify-otp', { registrationId: account.id, code: account.code });
  assert.equal(verified.status, 200);
  assert.ok(verified.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(verified.headers.get('set-cookie').includes('Path=/api/v1/auth'));
  const login = await request('/login', account);
  assert.equal(login.status, 200);
  assert.equal(login.body.userId, account.id);
  assert.equal(login.body.refreshToken, undefined);
  const claims = jwt.verify(login.body.accessToken, process.env.ACCESS_TOKEN_SECRET, { algorithms: ['HS256'], issuer: 'cant-run-alone-local', audience: 'cant-run-alone-services' });
  assert.equal(claims.sub, account.id);
  assert.equal(claims.phoneVerified, true);
  const stored = await pool.query('SELECT password_hash,is_phone_verified FROM users WHERE id=$1', [account.id]);
  assert.ok(stored.rows[0].password_hash.startsWith('$2'));
  assert.equal(stored.rows[0].is_phone_verified, true);
});

test('refresh tokens differ even within one second; replay and logout are rejected', async () => {
  const { account, result } = await verified();
  const a = tokens({ id: account.id }), b = tokens({ id: account.id });
  assert.notEqual(a.refreshToken, b.refreshToken);
  const fresh = await request('/refresh', {}, result.cookie);
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.cookie, result.cookie);
  assert.equal((await request('/refresh-token', {}, result.cookie)).status, 401);
  assert.equal((await request('/logout', {}, fresh.cookie)).status, 204);
  assert.equal((await request('/refresh', {}, fresh.cookie)).status, 401);
});

test('two simultaneous refreshes consume the old token only once', async () => {
  const { result } = await verified();
  const responses = await Promise.all([request('/refresh', {}, result.cookie), request('/refresh', {}, result.cookie)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
});

test('OTP failures persist and lock out after five attempts; resend is rate limited', async () => {
  const account = await register();
  const wrong = account.code === '000000' ? '999999' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await request('/verify-otp', { registrationId: account.id, code: wrong })).status, 400);
  assert.equal((await request('/verify-otp', { registrationId: account.id, code: account.code })).status, 429);
  assert.equal((await request('/phone/send-otp', { phoneNumber: account.phoneNumber })).status, 429);
  const result = await pool.query("SELECT attempts FROM otps WHERE target=$1 AND otp_type='PHONE_VERIFICATION'", [account.phoneNumber]);
  assert.equal(result.rows[0].attempts, 5);
});

test('OTP expiry and single-use are enforced', async () => {
  const account = await register();
  await pool.query('UPDATE otps SET expires_at=NOW()-INTERVAL \'1 minute\' WHERE target=$1', [account.phoneNumber]);
  assert.equal((await request('/verify-otp', { registrationId: account.id, code: account.code })).status, 400);
  const other = await verified();
  assert.equal((await request('/verify-otp', { registrationId: other.account.id, code: other.account.code })).status, 400);
});

test('invalid credentials persist lockout and revoke refresh sessions', async () => {
  const { account, result } = await verified();
  for (let i = 0; i < 4; i++) assert.equal((await request('/login', { email: account.email, password: 'incorrect' })).status, 401);
  assert.equal((await request('/login', { email: account.email, password: 'incorrect' })).status, 403);
  assert.equal((await request('/login', account)).status, 403);
  assert.equal((await request('/refresh', {}, result.cookie)).status, 401);
});

test('admin locking remains unavailable without introducing an unprotected endpoint', async () => {
  assert.equal((await request('/lock-account', { userId: crypto.randomUUID(), isLocked: false })).status, 404);
});

test('legacy phone verification accepts normalized Thai numbers without double prefixing', async () => {
  assert.equal(normalizePhone('081 234 5678'), '+66812345678');
  assert.equal(normalizePhone('+66812345678'), '+66812345678');
  const account = await register();
  const response = await request('/phone/verify-otp', { phoneNumber: account.phoneNumber, otpCode: account.code });
  assert.equal(response.status, 200);
  assert.equal((await request('/login', account)).status, 200);
});

test('registration validation normalizes emails and rejects duplicates and short passwords', async () => {
  const account = await register();
  assert.equal((await request('/register', { ...account, email: account.email.toUpperCase() })).status, 409);
  assert.equal((await request('/register', { ...account, email: 'new@example.com', password: 'short' })).status, 422);
  assert.equal((await request('/register', { ...account, email: 'bad' })).status, 422);
  assert.equal((await request('/refresh', {})).status, 401);
});
