/**
 * One-time backfill:
 * - set status="active" on domains missing status
 * - set purgeAt on archived domains missing purgeAt
 *
 * Usage:
 *   node scripts/backfill-domain-status-active.js
 *   node scripts/backfill-domain-status-active.js --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Domain = require("../models/domainModel");
const { computePurgeAt } = require("../services/trashBinService");

const dryRun = process.argv.includes("--dry-run");

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const missingStatusFilter = { status: { $exists: false } };
  const missingStatusCount = await Domain.countDocuments(missingStatusFilter);
  console.log(`Domains missing status field: ${missingStatusCount}`);

  const missingPurgeFilter = {
    status: "archived",
    archivedAt: { $exists: true, $ne: null },
    $or: [{ purgeAt: { $exists: false } }, { purgeAt: null }],
  };
  const missingPurgeCount = await Domain.countDocuments(missingPurgeFilter);
  console.log(`Archived domains missing purgeAt: ${missingPurgeCount}`);

  if (missingStatusCount === 0 && missingPurgeCount === 0) {
    console.log("Nothing to backfill.");
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    if (missingStatusCount > 0) {
      const sample = await Domain.find(missingStatusFilter, { domain: 1 }).limit(5);
      console.log("Would set status=active on:", sample.map((d) => d.domain).join(", "));
    }
    if (missingPurgeCount > 0) {
      const sample = await Domain.find(missingPurgeFilter, {
        domain: 1,
        archivedAt: 1,
      }).limit(5);
      for (const doc of sample) {
        console.log(
          `Would set purgeAt on ${doc.domain} -> ${computePurgeAt(doc.archivedAt).toISOString()}`
        );
      }
    }
    await mongoose.disconnect();
    return;
  }

  if (missingStatusCount > 0) {
    const statusResult = await Domain.updateMany(missingStatusFilter, {
      $set: { status: "active" },
    });
    console.log(`Updated ${statusResult.modifiedCount} domain(s) to status=active`);
  }

  if (missingPurgeCount > 0) {
    const archived = await Domain.find(missingPurgeFilter);
    let purgeUpdated = 0;
    for (const doc of archived) {
      doc.purgeAt = computePurgeAt(doc.archivedAt);
      await doc.save();
      purgeUpdated += 1;
    }
    console.log(`Set purgeAt on ${purgeUpdated} archived domain(s)`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
