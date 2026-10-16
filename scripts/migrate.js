const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('identity_schema_migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS identity_schema_migrations(version text PRIMARY KEY)');
    for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).filter(file => file.endsWith('.sql')).sort()) {
      const exists = await client.query('SELECT 1 FROM identity_schema_migrations WHERE version=$1', [file]);
      if (!exists.rowCount) {
        await client.query(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
        await client.query('INSERT INTO identity_schema_migrations VALUES ($1)', [file]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
if (require.main === module) migrate().then(() => pool.end()).catch(error => { console.error(error.message); process.exit(1); });
module.exports = { migrate };
