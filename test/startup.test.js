const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.TEST_DATABASE_URL || !/_test(?:\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Isolated test database required');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.CONFIG_FILE = '/nonexistent';
process.env.RABBITMQ_REQUIRED = 'false';
process.env.AUTO_MIGRATE = 'true';
process.env.PORT = '0';
const express = require('express');
const { startServer } = require('../server');
const pool = require('../config/db');
test('startup opens one HTTP listener and exposes database readiness', async () => {
  const original = express.application.listen;
  let count = 0;
  express.application.listen = function (...args) { count++; return original.apply(this, args); };
  let server;
  try {
    server = await startServer();
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/up');
    assert.equal(response.status, 200);
    assert.equal(count, 1);
  } finally {
    express.application.listen = original;
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
