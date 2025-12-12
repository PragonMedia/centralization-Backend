const Route = require("../models/domainModel");

async function getRoutesFromDatabase() {
  return await Route.find({});
}

module.exports = { getRoutesFromDatabase };
