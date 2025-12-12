const express = require("express");
const router = express.Router();
const cloakController = require("../controllers/cloakController");

router.post("/cloak", cloakController.cloak);

module.exports = router;
