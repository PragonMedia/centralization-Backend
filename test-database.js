require("dotenv").config();
const mongoose = require("mongoose");
const Domain = require("./models/domainModel");

async function testDatabase() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB\n");

    const testDomain = process.argv[2] || "test-example.com";
    console.log(`🔍 Looking for domain: ${testDomain}\n`);

    const domain = await Domain.findOne({ domain: testDomain });

    if (!domain) {
      console.log(`❌ Domain "${testDomain}" not found in database`);
      console.log("\n💡 Make sure you've created a domain first using the API");
      process.exit(1);
    }

    console.log("✅ Domain found in database\n");
    console.log("=".repeat(60));
    console.log("DATABASE FIELD VERIFICATION");
    console.log("=".repeat(60));
    console.log("");

    const checks = {
      "Basic Fields": {
        domain: domain.domain,
        assignedTo: domain.assignedTo,
        organization: domain.organization,
        id: domain.id,
        platform: domain.platform,
        rtkID: domain.rtkID,
        certificationTags: domain.certificationTags || [],
      },
      "Cloudflare Fields": {
        cloudflareZoneId: domain.cloudflareZoneId || "❌ Missing",
        aRecordIP: domain.aRecordIP || "❌ Missing",
        sslStatus: domain.sslStatus || "❌ Missing",
        proxyStatus: domain.proxyStatus || "❌ Missing",
        sslActivatedAt: domain.sslActivatedAt || "Not set yet",
        sslError: domain.sslError || "None",
      },
      "RedTrack Fields": {
        redtrackDomainId: domain.redtrackDomainId || "❌ Missing",
        redtrackTrackingDomain: domain.redtrackTrackingDomain || "❌ Missing",
      },
    };

    let allPassed = true;

    Object.entries(checks).forEach(([category, fields]) => {
      console.log(`📋 ${category}:`);
      Object.entries(fields).forEach(([key, value]) => {
        const isMissing = value === "❌ Missing";
        const status = !isMissing ? "✅" : "❌";
        const displayValue =
          typeof value === "object" && Array.isArray(value)
            ? JSON.stringify(value)
            : value;
        console.log(`  ${status} ${key}: ${displayValue}`);
        if (isMissing) allPassed = false;
      });
      console.log("");
    });

    console.log("=".repeat(60));
    if (allPassed) {
      console.log("✅ All required fields are present!");
    } else {
      console.log("⚠️  Some fields are missing. Check integration logs.");
    }
    console.log("=".repeat(60));

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  }
}

testDatabase();




