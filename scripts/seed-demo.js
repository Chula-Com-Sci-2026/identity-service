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
    // Nok: the showcase runner with buddies, shared runs and a rating (running-buddy-integration demo_community.py).
    ['10101010-1010-4010-8010-101010101010', 'nok@example.com', '+66833333333'],
  ]) {
    await pool.query('INSERT INTO users(id,email,phone_number,password_hash,is_phone_verified) VALUES ($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING', [id,email,phone,passwordHash]);
  }
  console.log('Seeded Ray, Mali and Nok as verified demo fixtures; existing users preserved.');
}
main().then(() => pool.end()).catch(error => { console.error(error.message); process.exit(1); });
