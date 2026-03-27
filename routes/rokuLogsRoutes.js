const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const rokuLogsController = require("../controllers/rokuLogsController");

// GET /api/v1/roku-logs?limit=100
router.get("/roku-logs", authController.verifyToken, rokuLogsController.getAllRokuLogs);
// DELETE /api/v1/roku-logs/:id
router.delete("/roku-logs/:id", authController.verifyToken, rokuLogsController.deleteRokuLogById);

module.exports = router;

