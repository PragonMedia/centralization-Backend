/**
 * Accounting routes – revenue from Ringba and company CRUD.
 * Base path: /api/v1/accounting
 */
const express = require("express");
const router = express.Router();
const accountingController = require("../controllers/accountingController");

router.post("/revenue", accountingController.getRevenue);
router.get("/revenue/cached", accountingController.getCachedRevenue);
router.get("/ringba/pgnm/buyers", accountingController.getPgnmRingbaBuyers);
router.get("/retriever/test-data", accountingController.getRetrieverTestData);
router.get("/companies", accountingController.listCompanies);
router.post("/companies", accountingController.createCompany);
router.put("/companies/:accountID", accountingController.updateCompany);
router.delete("/companies/:accountID", accountingController.deleteCompany);

module.exports = router;
