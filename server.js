// Load environment variables FIRST before requiring any modules that use them
require("dotenv").config();

const app = require("./app");
const mongoose = require("mongoose");

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 500, // Increased for higher tier MongoDB Atlas (can handle up to 1000+)
    minPoolSize: 50, // Maintain more connections ready
    serverSelectionTimeoutMS: 5000, // Fail fast if MongoDB is unreachable
    socketTimeoutMS: 45000, // Close connections after 45s of inactivity
    connectTimeoutMS: 10000, // Connection timeout
  })
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// 🟢 Start listening for requests
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
});
