const express = require("express");
const router = express.Router();
const routeController = require("../controllers/routeController");

// Basic CRUD operations - More specific routes first
router.get("/", routeController.getAllDomains);
router.get("/names", routeController.getDomainNames);
router.post("/domain", routeController.createDomain);
router.post("/data", routeController.getRouteData);
router.get("/domain-route-details", routeController.getDomainRouteDetails);
router.put("/updateDomain", routeController.updateDomainName);
router.put("/updateData", routeController.updateRouteData);
router.post("/route", routeController.createRoute);

// Delete operations
router.delete("/domain/:domain", routeController.deleteDomain);
router.delete("/domain/:domain/route/:route", routeController.deleteSubRoute);

// Advanced filtering and analytics
router.get("/recent", routeController.getRecentDomains);
router.get("/date-range", routeController.getDomainsByDateRange);
router.get("/stats", routeController.getDomainStats);

// Creator-based operations
router.get("/by-creator", routeController.getRoutesByCreator);
router.get("/creator-stats", routeController.getCreatorStats);

// Cache purging operations
router.post("/purge-cache/all", routeController.purgeAllCache);
router.post("/purge-cache/domain/:domain", routeController.purgeDomainCache);

module.exports = router;
