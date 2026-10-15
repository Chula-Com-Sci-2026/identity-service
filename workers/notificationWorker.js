const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../config/config.env") });

const amqp = require("amqplib");
const sendEmail = require("../utils/sendEmail");
const sendSms = require("../utils/sendSms");

const startWorker = async () => {
  try {

    const queueName = process.env.NOTIFICATION_QUEUE || "notification_queue";
    const connection = await amqp.connect(process.env.RABBITMQ_URL || "amqp://localhost:5672");
    const channel = await connection.createChannel();

    await channel.assertQueue(queueName, { durable: true });
    channel.prefetch(1);

    console.log(`Notification Worker listening on queue: ${queueName}`);

    channel.consume(queueName, async (msg) => {
      if (msg !== null) {
        try {
          const payload = JSON.parse(msg.content.toString());
          console.log(`Processing job for: ${payload.target} (${payload.channelType})`);

          if (payload.channelType === "EMAIL") {
            const emailHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #1e293b;">Verification Code</h2>
                <div style="background-color: #f1f5f9; padding: 16px; border-radius: 6px; text-align: center; margin: 20px 0;">
                  <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #2563eb;">${payload.otpCode}</span>
                </div>
                <p style="color: #64748b; font-size: 13px;">This code is valid for 15 minutes.</p>
              </div>
            `;

            await sendEmail({
              to: payload.target,
              subject: payload.subject,
              html: emailHtml,
            });
            console.log(`Email successfully sent to ${payload.target}`);
          } else if (payload.channelType === "SMS") {
            await sendSms({
              to: payload.target,
              message: payload.message,
            });
            console.log(`SMS successfully sent to ${payload.target}`);
          }

          // ยืนยันว่างานเสร็จสมบูรณ์ ลบออกจาก Queue
          channel.ack(msg);
        } catch (err) {
          console.error("Worker processing failed:", err.message);
          // หากส่งไม่สำเร็จ ไม่นำกลับเข้าคิวซ้ำทันที (กัน infinite loop)
          channel.nack(msg, false, false);
        }
      }
    });
  } catch (error) {
    console.error("Worker failed to start:", error.message);
    setTimeout(startWorker, 5000);
  }
};

startWorker();