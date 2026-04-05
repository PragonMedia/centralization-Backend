const express = require("express");
const router = express.Router();

const rokuLogsController = require("../controllers/rokuLogsController");

// GET /api/v1/roku-logs?limit=100
router.get("/roku-logs", rokuLogsController.getAllRokuLogs);
// DELETE /api/v1/roku-logs/:id
router.delete("/roku-logs/:id", rokuLogsController.deleteRokuLogById);

module.exports = router;

