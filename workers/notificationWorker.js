const amqp = require('amqplib');
const sendEmail = require('../utils/sendEmail');
const sendSms = require('../utils/sendSms');

const startWorker = async () => {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    const channel = await connection.createChannel();
    const queue = process.env.NOTIFICATION_QUEUE || 'notification_queue';

    await channel.assertQueue(queue, { durable: true });
    
    // รับงานทีละ 1 ชิ้น เพื่อเฉลี่ยภาระงานหากรัน Worker หลายตัวพร้อมกัน
    channel.prefetch(1);

    console.log(`[*] Notification Worker waiting for messages in ${queue}`);

    channel.consume(queue, async (msg) => {
      if (msg !== null) {
        const payload = JSON.parse(msg.content.toString());
        console.log(`[x] Processing Job Type: ${payload.type} to ${payload.target}`);

        try {
          if (payload.type === 'EMAIL') {
            const htmlContent = `
              <div style="font-family: sans-serif; padding: 20px;">
                <h2>ยืนยันอีเมลของคุณ</h2>
                <p>รหัส OTP ของคุณคือ: <b>${payload.content.otpCode}</b></p>
                <p>รหัสมีอายุการใช้งาน ${payload.content.expiresInMinutes} นาที</p>
              </div>
            `;
            await sendEmail({
              to: payload.target,
              subject: payload.subject,
              html: htmlContent,
            });
          } else if (payload.type === 'SMS') {
            await sendSms({
              to: payload.target,
              message: payload.message,
            });
          }

          // ยืนยันว่างานเสร็จสิ้น เพื่อลบออกจากคิว
          channel.ack(msg);
          console.log(`[✔] Job ${payload.type} dispatched successfully`);
        } catch (jobError) {
          console.error(`[!] Failed to process job:`, jobError.message);
          
          // หากส่งไม่ผ่าน ปฏิเสธข้อความและส่งกลับเข้า Queue เพื่อ Retry (หรือตั้ง DLQ)
          channel.nack(msg, false, true); 
        }
      }
    });
  } catch (error) {
    console.error('Worker failed to connect:', error.message);
  }
};

startWorker();