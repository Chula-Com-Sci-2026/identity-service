const express = require("express");
const dotenv = require("dotenv");
const app = express();
const auth = require('./routes/auth');
const { connectRabbitMQ } = require("./config/rabbitmq");
const cors = require("cors");

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

// Load env vars
dotenv.config({ path: "./config/config.env" });

// Connect Database
require('./config/db');

//Parse
app.use(express.json());

// Call Routes
app.use('/api/v1/auth',auth);

const PORT = process.env.PORT || 5000;
const server = app.listen(
  PORT,
  console.log(
    "Server running in ",
    process.env.NODE_ENV,
    " mode on port ",
    PORT,
  ),
);

const startServer = async () => {
  try {
    // 1. รอเชื่อมต่อ RabbitMQ ให้เสร็จก่อน
    await connectRabbitMQ();

    // 2. เมื่อพร้อมแล้วค่อยเปิดพอร์ตรับ Request
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to bootstrap server:", error);
    process.exit(1);
  }
};

startServer();
//Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
    console.log(`Error: ${err.message}`)
    server.close(()=>process.exit(1));
});
