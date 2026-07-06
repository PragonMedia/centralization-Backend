require("dotenv").config();
const mongoose = require("mongoose");
const Domain = require("../models/domainModel");

const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/check-domain-redtrack.js <domain>");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const d = await Domain.findOne({ domain: name });
  if (!d) {
    console.log("NOT IN MONGO:", name);
  } else {
    console.log(
      JSON.stringify(
        {
          domain: d.domain,
          redtrackDomainId: d.redtrackDomainId || null,
          redtrackTrackingDomain: d.redtrackTrackingDomain || null,
          sslStatus: d.sslStatus,
          proxyStatus: d.proxyStatus,
          cloudflareZoneId: d.cloudflareZoneId || null,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        },
        null,
        2
      )
    );
  }
  process.exit(0);
});
