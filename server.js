const express = require("express");
const dotenv = require("dotenv");
const app = express();
const auth = require('./routes/auth');

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

//Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
    console.log(`Error: ${err.message}`)
    server.close(()=>process.exit(1));
});
