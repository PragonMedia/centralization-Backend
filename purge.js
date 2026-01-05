// Script to purge Cloudflare cache for all domains
// Usage: node purge.js

const mongoose = require("mongoose");
require("dotenv").config();

const Domain = require("./models/domainModel");
const {
  getOrCreateZone,
  purgeCache,
} = require("./services/cloudflareService");

async function purgeAllDomainsCache() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("❌ MONGO_URI or MONGODB_URI environment variable not set");
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ Connected to MongoDB\n");

    // Fetch all domains
    console.log("📋 Fetching all domains...");
    const domains = await Domain.find({}).maxTimeMS(60000);
    console.log(`✅ Found ${domains.length} domains\n`);

    if (domains.length === 0) {
      console.log("⚠️  No domains found");
      process.exit(0);
    }

    // Purge cache for each domain
    let successCount = 0;
    let failCount = 0;
    const failedDomains = [];

    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      console.log(
        `\n[${i + 1}/${domains.length}] Purging cache for: ${domain.domain}`
      );

      try {
        // Get zone ID (use existing zoneId from database if available, otherwise fetch it)
        let zoneId = domain.cloudflareZoneId;

        if (!zoneId) {
          console.log(`   🔍 Fetching zone ID for ${domain.domain}...`);
          const zone = await getOrCreateZone(domain.domain);
          zoneId = zone.id;
        } else {
          console.log(`   ✅ Using existing zone ID: ${zoneId}`);
        }

        // Purge cache (purge everything)
        await purgeCache(zoneId);
        successCount++;
        console.log(`   ✅ Successfully purged cache for ${domain.domain}`);

        // Small delay to avoid rate limiting
        if (i < domains.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
        }
      } catch (error) {
        failCount++;
        failedDomains.push({ domain: domain.domain, error: error.message });
        console.error(`   ❌ Failed to purge cache for ${domain.domain}: ${error.message}`);
      }
    }

    // Summary
    console.log(`\n\n📊 Summary:`);
    console.log(`✅ Successfully purged: ${successCount} domains`);
    console.log(`❌ Failed: ${failCount} domains`);
    console.log(`📝 Total: ${domains.length} domains`);

    if (failedDomains.length > 0) {
      console.log(`\n❌ Failed domains:`);
      failedDomains.forEach(({ domain, error }) => {
        console.log(`   - ${domain}: ${error}`);
      });
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

purgeAllDomainsCache();

