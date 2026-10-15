const amqp = require("amqplib");

let channel = null;

const connectRabbitMQ = async () => {
  try {
    const queueName = process.env.NOTIFICATION_QUEUE || "notification_queue";
    const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

    const connection = await amqp.connect(rabbitUrl);
    channel = await connection.createChannel();

    // สร้าง Queue
    await channel.assertQueue(queueName, { durable: true });
    console.log("Connected to RabbitMQ and Channel is ready");

    connection.on("close", () => {
      console.error("RabbitMQ connection closed. Reconnecting...");
      channel = null;
      setTimeout(connectRabbitMQ, 5000);
    });

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err.message);
    });

    return channel;
  } catch (error) {
    console.error("Failed to connect to RabbitMQ:", error.message);
    channel = null;
    setTimeout(connectRabbitMQ, 5000);
    throw error;
  }
};

const sendNotification = async (payload) => {
  // หาก channel ยังไม่พร้อม ให้ดักไว้
  if (!channel) {
    throw new Error("RabbitMQ channel is not ready");
  }

  const queueName = process.env.NOTIFICATION_QUEUE || "notification_queue";
  const messageBuffer = Buffer.from(JSON.stringify(payload));
  return channel.sendToQueue(queueName, messageBuffer, { persistent: true });
};

module.exports = { connectRabbitMQ, sendNotification };