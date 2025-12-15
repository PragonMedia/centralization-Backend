// Script to manually generate nginx config for a domain
// Usage: node generateNginxConfig.js <domain>
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const Route = require("./models/domainModel");
const { buildDomainFragment } = require("./services/dynamicRoutes");

async function generateConfigForDomain(domainName) {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("❌ MONGO_URI or MONGODB_URI environment variable not set");
      process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Find domain
    const domain = await Route.findOne({ domain: domainName });
    if (!domain) {
      console.error(`❌ Domain not found: ${domainName}`);
      process.exit(1);
    }

    console.log(`✅ Found domain: ${domainName}`);
    console.log(`📋 Routes: ${JSON.stringify(domain.routes, null, 2)}`);

    // Generate nginx config
    const fragment = buildDomainFragment(domain);
    console.log("\n📝 Generated nginx config:\n");
    console.log(fragment);

    // Write to file
    const configPath = `/etc/nginx/dynamic/${domainName}.conf`;
    fs.writeFileSync(configPath, fragment, "utf8");
    console.log(`\n✅ Written to: ${configPath}`);

    // Test nginx config
    const { execSync } = require("child_process");
    try {
      execSync("sudo nginx -t", { stdio: "inherit" });
      console.log("✅ Nginx config test passed");
      console.log("💡 Run: sudo systemctl reload nginx");
    } catch (error) {
      console.error("❌ Nginx config test failed");
      process.exit(1);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

const domainName = process.argv[2];
if (!domainName) {
  console.error("Usage: node generateNginxConfig.js <domain>");
  process.exit(1);
}

generateConfigForDomain(domainName);

