/**
 * CallGrid accounting routes — Paragon Media only.
 * Base path: /api/v1/callgrid-accounting
 */
const express = require("express");
const router = express.Router();
const callgridAccountingController = require("../controllers/callgridAccountingController");

router.get("/buyers", callgridAccountingController.getBuyers);
router.get("/revenue", callgridAccountingController.getRevenueLive);
router.post("/revenue", callgridAccountingController.refreshRevenue);
router.get("/revenue/refresh-status", callgridAccountingController.getRevenueRefreshStatus);
router.get("/revenue/cached", callgridAccountingController.getCachedRevenue);

module.exports = router;
