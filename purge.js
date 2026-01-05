// Script to purge Cloudflare cache for all domains
// Usage: node purge.js

const mongoose = require("mongoose");
require("dotenv").config();

const cacheService = require("./services/cacheService");

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

    // Purge cache for all domains using the service
    console.log("📋 Purging cache for all domains...\n");
    const result = await cacheService.purgeAllDomainsCache();

    // Summary
    console.log(`\n\n📊 Summary:`);
    console.log(`✅ Successfully purged: ${result.successCount} domains`);
    console.log(`❌ Failed: ${result.failCount} domains`);
    console.log(`📝 Total: ${result.total} domains`);

    if (result.failedDomains.length > 0) {
      console.log(`\n❌ Failed domains:`);
      result.failedDomains.forEach(({ domain, error }) => {
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

