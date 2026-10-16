// Operator-only local demo setup. Keeps UUIDs aligned with Profile/Scheduling/Reputation.
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { migrate } = require('./migrate');
async function main() {
  await migrate();
  const passwordHash = await bcrypt.hash('runner123', 12);
  for (const [id, email, phone] of [
    ['11111111-1111-4111-8111-111111111111', 'ray@example.com', '+66811111111'],
    ['22222222-2222-4222-8222-222222222222', 'mali@example.com', '+66822222222'],
  ]) {
    await pool.query('INSERT INTO users(id,email,phone_number,password_hash,is_phone_verified) VALUES ($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING', [id,email,phone,passwordHash]);
  }
  console.log('Seeded Ray and Mali as verified demo fixtures; existing users preserved.');
}
main().then(() => pool.end()).catch(error => { console.error(error.message); process.exit(1); });
