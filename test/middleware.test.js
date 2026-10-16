const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const authenticate = require('../middleware/auth');
const { tokens } = require('../services/session');
const subject = crypto.randomUUID();
function check(token) {
  let status, passed = false;
  const req = { headers: token ? { authorization: 'Bearer ' + token } : {} };
  const res = { status(value) { status = value; return this; }, json() { return this; } };
  authenticate(req, res, () => { passed = true; });
  return { status, passed, req };
}
test('service middleware accepts standard claims and UUID subjects', () => {
  const result = check(tokens({ id: subject }).accessToken);
  assert.equal(result.passed, true);
  assert.equal(result.req.user.sub, subject);
});
test('service middleware rejects missing, expired, forged and wrong-audience tokens', () => {
  const key = process.env.ACCESS_TOKEN_SECRET;
  const claims = { sub: subject, iss: 'cant-run-alone-local', aud: 'cant-run-alone-services' };
  const variants = [undefined,
    jwt.sign(claims, key, { expiresIn: -1 }),
    jwt.sign(claims, 'incorrect-key', { expiresIn: '15m' }),
    jwt.sign({ ...claims, aud: 'different-service' }, key, { expiresIn: '15m' }),
  ];
  for (const token of variants) { const result = check(token); assert.equal(result.status, 401); assert.equal(result.passed, false); }
});
