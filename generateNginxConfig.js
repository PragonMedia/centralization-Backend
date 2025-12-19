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

    // Write to file (requires sudo)
    const configPath = `/etc/nginx/dynamic/${domainName}.conf`;
    const { execSync } = require("child_process");
    
    // Ensure directory exists
    try {
      execSync(`sudo mkdir -p /etc/nginx/dynamic`, { stdio: "inherit" });
    } catch (err) {
      console.warn(`⚠️  Could not create directory: ${err.message}`);
    }
    
    // Write to temp file first, then move with sudo
    const tempFile = `/tmp/nginx_${domainName}_${Date.now()}.conf`;
    fs.writeFileSync(tempFile, fragment, "utf8");
    execSync(`sudo mv ${tempFile} ${configPath}`, { stdio: "inherit" });
    execSync(`sudo chmod 644 ${configPath}`, { stdio: "inherit" });
    console.log(`\n✅ Written to: ${configPath}`);

    // Test and reload nginx
    try {
      execSync("sudo nginx -t", { stdio: "inherit" });
      console.log("✅ Nginx config test passed");
      console.log("🔄 Reloading nginx...");
      execSync("sudo systemctl reload nginx", { stdio: "inherit" });
      console.log("✅ Nginx reloaded successfully");
    } catch (error) {
      console.error("❌ Nginx test/reload failed");
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
  // If no domain provided, regenerate all domains
  console.log("🔄 Regenerating nginx configs for all domains...\n");
  const { generateNginxConfig } = require("./services/dynamicRoutes");
  
  generateNginxConfig()
    .then(() => {
      console.log("\n✅ All domains regenerated successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error regenerating all domains:", error.message);
      process.exit(1);
    });
} else {
  generateConfigForDomain(domainName);
}

