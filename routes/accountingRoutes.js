/**
 * Accounting routes – revenue from Ringba for frontend display.
 * Base path: /api/v1/accounting
 */
const express = require("express");
const router = express.Router();
const accountingController = require("../controllers/accountingController");

router.get("/revenue", accountingController.getRevenue);

module.exports = router;
