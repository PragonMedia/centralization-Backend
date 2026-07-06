/**
 * Register (or re-register) a domain in RedTrack and save redtrackDomainId in Mongo.
 * Usage: node scripts/register-redtrack-domain.js creditadviser.org
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Domain = require("../models/domainModel");
const redtrackService = require("../services/redtrackService");

const domainName = process.argv[2];
if (!domainName) {
  console.error("Usage: node scripts/register-redtrack-domain.js <domain>");
  process.exit(1);
}

(async () => {
  if (!process.env.REDTRACK_API_KEY) {
    console.error("REDTRACK_API_KEY is not set");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const doc = await Domain.findOne({ domain: domainName });
  if (!doc) {
    console.error("Domain not found in Mongo:", domainName);
    process.exit(1);
  }

  console.log("Current state:", {
    redtrackDomainId: doc.redtrackDomainId,
    redtrackTrackingDomain: doc.redtrackTrackingDomain,
  });

  console.log("\nRegistering with RedTrack...");
  const result = await redtrackService.addRedTrackDomain(domainName);

  console.log("\nRedTrack result:", result);

  if (!result.domainId) {
    console.error("RedTrack registration did not return a domain ID:", result.reason);
    process.exit(1);
  }

  doc.redtrackDomainId = String(result.domainId);
  doc.redtrackTrackingDomain = result.trackingDomain || doc.redtrackTrackingDomain;
  await doc.save();

  console.log("\nMongo updated:", {
    domain: doc.domain,
    redtrackDomainId: doc.redtrackDomainId,
    redtrackTrackingDomain: doc.redtrackTrackingDomain,
  });

  process.exit(0);
})();
