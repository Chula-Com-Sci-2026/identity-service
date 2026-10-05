const { Pool } = require('pg');
require('dotenv').config();

// กำหนดการตั้งค่าการเชื่อมต่อ PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'auth_db',
  max: 20, // จำนวน connection สูงสุดใน pool
  idleTimeoutMillis: 30000, // ปิด idle connection หลังไม่มีการใช้งาน 30 วินาที
  connectionTimeoutMillis: 2000, // เวลารอเชื่อมต่อสูงสุด 2 วินาที ก่อนเกิด timeout
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Event listener เมื่อเกิดข้อผิดพลาดกับ idle client ใน pool
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
  process.exit(-1);
});

// ฟังก์ชันทดสอบการเชื่อมต่อฐานข้อมูลตอนเริ่มต้นระบบ
const testDbConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('PostgreSQL connected successfully');
    client.release();
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.message);
  }
};

testDbConnection();

module.exports = pool;