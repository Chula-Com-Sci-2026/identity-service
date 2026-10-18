const jwt = require('jsonwebtoken');
const { accessKey, issuer, audience } = require('../services/session');
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Valid access token required' });
  try {
    req.user = jwt.verify(header.slice(7), accessKey(), { algorithms: ['HS256'], issuer: issuer(), audience: audience() });
    if (!/^[0-9a-f-]{36}$/i.test(req.user.sub || '')) throw new Error('Invalid subject');
    next();
  } catch { return res.status(401).json({ message: 'Invalid or expired access token' }); }
}
module.exports = authenticateToken;
module.exports.protect = authenticateToken;
