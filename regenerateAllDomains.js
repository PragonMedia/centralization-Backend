// Script to regenerate all domain Nginx configs one by one
// This avoids MongoDB timeout issues when fetching all domains at once
// Usage: node regenerateAllDomains.js

const mongoose = require("mongoose");
require("dotenv").config();

const Domain = require("./models/domainModel");
const { generateNginxConfig } = require("./services/dynamicRoutes");

async function regenerateAllDomains() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("❌ MONGO_URI or MONGODB_URI environment variable not set");
      process.exit(1);
    }

    // Increase timeout for MongoDB connection
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000, // 45 seconds
    });
    console.log("✅ Connected to MongoDB\n");

    // Fetch all domains with a longer timeout
    console.log("📋 Fetching all domains...");
    const domains = await Domain.find({}).maxTimeMS(60000); // 60 second timeout
    console.log(`✅ Found ${domains.length} domains\n`);

    if (domains.length === 0) {
      console.log("⚠️  No domains found");
      process.exit(0);
    }

    // Regenerate each domain one by one
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      console.log(`\n[${i + 1}/${domains.length}] Regenerating: ${domain.domain}`);

      try {
        await generateNginxConfig(domain);
        successCount++;
        console.log(`✅ Successfully regenerated: ${domain.domain}`);
      } catch (error) {
        failCount++;
        console.error(`❌ Failed to regenerate ${domain.domain}: ${error.message}`);
      }

      // Small delay to avoid overwhelming the system
      if (i < domains.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`✅ Successfully regenerated: ${successCount} domains`);
    console.log(`❌ Failed: ${failCount} domains`);
    console.log(`📝 Total: ${domains.length} domains`);

    // Final Nginx test and reload
    console.log(`\n🧪 Testing Nginx configuration...`);
    const { execSync } = require("child_process");
    try {
      execSync("sudo nginx -t", { stdio: "inherit" });
      console.log("✅ Nginx config test passed");
      console.log("🔄 Reloading nginx...");
      execSync("sudo systemctl reload nginx", { stdio: "inherit" });
      console.log("✅ Nginx reloaded successfully");
    } catch (error) {
      console.error("❌ Nginx test/reload failed");
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

regenerateAllDomains();

