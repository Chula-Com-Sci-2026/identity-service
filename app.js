const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const pool = require('./config/db');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.get('/up', async (req, res, next) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); } catch (error) { next(error); }
  });
  app.use('/api/v1/auth', require('./routes/auth'));
  app.use((req, res) => res.status(404).json({ code: 'not_found', message: 'Route not found' }));
  app.use((error, req, res, next) => {
    const status = error.code === '23505' ? 409 : error.status || 500;
    if (status >= 500) console.error('Identity request failed:', error.code || error.name);
    res.status(status).json({ code: String(status), message: status === 409 ? 'Email or phone number already in use' : status >= 500 ? 'Identity service unavailable' : error.message });
  });
  return app;
}
module.exports = { createApp };
