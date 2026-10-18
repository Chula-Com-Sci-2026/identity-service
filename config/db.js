const path = require('path');
const { Pool } = require('pg');

// Ensure correct path to config.env if not already loaded globally
require('dotenv').config({ path: process.env.CONFIG_FILE || path.resolve(__dirname, 'config.env'), quiet: true });

const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 } : {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD ?? ''),
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
  process.exit(-1);
});

module.exports = pool;
