// utils/sendSms.js
const twilio = require('twilio');

// Helper: แปลงเบอร์ในไทยให้อยู่ในรูปแบบ E.164 (+66...)
const formatE164 = (phone) => {
  let cleaned = phone.replace(/\D/g, ''); // ตัดเครื่องหมายขีด ช่องว่างออกทั้งหมด

  if (cleaned.startsWith('0')) {
    cleaned = '66' + cleaned.substring(1);
  }

  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  return cleaned;
};

/**
 * ส่ง SMS ผ่าน Twilio
 * @param {Object} options
 * @param {string} options.to - เบอร์โทรศัพท์ปลายทาง (เช่น 0812345678 หรือ +66812345678)
 * @param {string} options.message - ข้อความที่จะส่ง
 */
const sendSms = async ({ to, message }) => {
  const formattedTo = formatE164(to);

  // สลับไปใช้ Twilio client เมื่อมี credentials ครบ
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedTo,
    });

    return result;
  }

  throw Object.assign(new Error('SMS provider is not configured; select OTP_DELIVERY=console explicitly for local demos'), { status: 503 });
};

module.exports = sendSms;
