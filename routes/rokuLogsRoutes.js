const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const rokuLogsController = require("../controllers/rokuLogsController");

// GET /api/v1/roku-logs?limit=100
router.get("/roku-logs", authController.verifyToken, rokuLogsController.getAllRokuLogs);

module.exports = router;

