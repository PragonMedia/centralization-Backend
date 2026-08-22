/**
 * CallGrid lander proxy routes.
 * Base path: /api/v1/callgrid
 */
const express = require("express");
const router = express.Router();
const callgridLanderController = require("../controllers/callgridLanderController");

router.get("/campaigns", callgridLanderController.listCampaigns);
router.get(
  "/campaigns/:campaignId/media-buyers",
  callgridLanderController.listMediaBuyers,
);
router.get("/destinations", callgridLanderController.listDestinations);

module.exports = router;
