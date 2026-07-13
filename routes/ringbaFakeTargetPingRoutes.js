const express = require("express");
const ringbaFakeTargetPingController = require("../controllers/ringbaFakeTargetPingController");

const router = express.Router();

router.get("/", ringbaFakeTargetPingController.getPings);
router.get("/:id", ringbaFakeTargetPingController.getPingById);

module.exports = router;
