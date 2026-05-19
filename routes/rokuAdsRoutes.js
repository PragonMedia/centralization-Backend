const express = require("express");
const router = express.Router();
const rokuAdsController = require("../controllers/rokuAdsController");

// Roku Ads API (beta) — account list + async spend reports
router.get("/roku/ad-accounts", rokuAdsController.getAdAccounts);
router.get("/roku/permissions", rokuAdsController.getDeveloperPermissions);
router.get("/roku/organizations", rokuAdsController.getOrganizations);
router.get("/roku/spend", rokuAdsController.getSpend);

module.exports = router;
