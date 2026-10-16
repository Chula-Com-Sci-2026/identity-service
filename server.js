// Load configuration before importing modules that use it. Injected environment wins.
require('dotenv').config({ path: process.env.CONFIG_FILE || './config/config.env', quiet: true });
const { createApp } = require('./app');
const pool = require('./config/db');
const { migrate } = require('./scripts/migrate');
const { connectRabbitMQ } = require('./config/rabbitmq');

async function startServer() {
  if (!(process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET) || !process.env.REFRESH_TOKEN_SECRET) {
    throw new Error('Access and refresh signing keys must be configured');
  }
  await pool.query('SELECT 1');
  if (process.env.AUTO_MIGRATE === 'true') await migrate();
  if (process.env.RABBITMQ_REQUIRED !== 'false') await connectRabbitMQ();
  const app = createApp();
  const server = app.listen(process.env.PORT || 5000, '0.0.0.0', () => console.log(`Identity listening on port ${process.env.PORT || 5000}`));
  return server;
}
if (require.main === module) {
  startServer().then(server => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
    }
  }).catch(error => { console.error('Identity startup failed:', error.message); process.exit(1); });
}
module.exports = { startServer };
