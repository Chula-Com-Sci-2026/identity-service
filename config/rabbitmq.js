// config/rabbitmq.js
const amqp = require('amqplib');

let channel = null;

const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    channel = await connection.createChannel();
    
    // ประกาศ Queue แบบ durable (ไม่หายเมื่อ broker restart)
    await channel.assertQueue(process.env.NOTIFICATION_QUEUE || 'notification_queue', {
      durable: true,
    });

    console.log('RabbitMQ Producer connected successfully');
  } catch (error) {
    console.error('RabbitMQ connection failed:', error.message);
  }
};

const publishToQueue = async (queueName, data) => {
  if (!channel) {
    throw new Error('RabbitMQ channel is not available');
  }
  return channel.sendToQueue(
    queueName,
    Buffer.from(JSON.stringify(data)),
    { persistent: true } // ข้อความจะถูกเขียนลง Disk เพื่อป้องกันการสูญหาย
  );
};

module.exports = { connectRabbitMQ, publishToQueue };