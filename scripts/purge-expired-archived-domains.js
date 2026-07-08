/**
 * Manually purge archived domains past retention (default 30 days).
 *
 * Usage:
 *   node scripts/purge-expired-archived-domains.js
 *   node scripts/purge-expired-archived-domains.js --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Domain = require("../models/domainModel");
const {
  getRetentionDays,
  purgeExpiredArchivedDomains,
} = require("../services/trashBinService");

const dryRun = process.argv.includes("--dry-run");

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Retention: ${getRetentionDays()} days`);

  if (dryRun) {
    const now = new Date();
    const fallbackCutoff = new Date(
      now.getTime() - getRetentionDays() * 24 * 60 * 60 * 1000
    );
    const candidates = await Domain.find({
      status: "archived",
      $or: [
        { purgeAt: { $lte: now } },
        { purgeAt: null, archivedAt: { $lte: fallbackCutoff } },
      ],
    }).select("domain archivedAt purgeAt");

    console.log(`Would permanently delete ${candidates.length} domain(s):`);
    for (const doc of candidates) {
      console.log(` - ${doc.domain} (archived ${doc.archivedAt}, purge ${doc.purgeAt})`);
    }
    await mongoose.disconnect();
    return;
  }

  const result = await purgeExpiredArchivedDomains();
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error("Purge failed:", err.message);
  process.exit(1);
});
