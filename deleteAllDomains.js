const mongoose = require("mongoose");
const Domain = require("./models/domainModel");
require("dotenv").config();

async function deleteAllDomains() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");

    // Get count before deletion
    const countBefore = await Domain.countDocuments();
    console.log(`📊 Found ${countBefore} domains before deletion`);

    if (countBefore === 0) {
      console.log("ℹ️  No domains found to delete");
      return;
    }

    // Get all domains before deletion (for cleanup)
    const allDomains = await Domain.find({}, { domain: 1 });
    const domainNames = allDomains.map((d) => d.domain);
    console.log(`📋 Domains to delete: ${domainNames.join(", ")}`);

    // Delete all domains
    const result = await Domain.deleteMany({});
    console.log(`🗑️  Successfully deleted ${result.deletedCount} domains`);

    // Clean up Nginx config files
    const { execSync } = require("child_process");
    const fs = require("fs");
    const dynamicDir = "/etc/nginx/dynamic";
    
    if (fs.existsSync(dynamicDir)) {
      console.log(`🧹 Cleaning up Nginx config files...`);
      let deletedCount = 0;
      
      for (const domainName of domainNames) {
        const configPath = `${dynamicDir}/${domainName}.conf`;
        try {
          if (fs.existsSync(configPath)) {
            execSync(`sudo rm -f ${configPath}`, { stdio: "pipe" });
            console.log(`  ✅ Deleted: ${configPath}`);
            deletedCount++;
          }
        } catch (err) {
          console.warn(`  ⚠️  Could not delete ${configPath}: ${err.message}`);
        }
      }
      
      console.log(`✅ Deleted ${deletedCount} Nginx config file(s)`);
      
      // Test and reload nginx
      try {
        execSync("sudo nginx -t", { stdio: "inherit" });
        execSync("sudo systemctl reload nginx", { stdio: "inherit" });
        console.log("✅ Nginx reloaded successfully");
      } catch (nginxError) {
        console.warn(`⚠️  Nginx reload failed: ${nginxError.message}`);
      }
    } else {
      console.log(`ℹ️  Nginx dynamic directory not found: ${dynamicDir}`);
    }

    // Verify deletion
    const countAfter = await Domain.countDocuments();
    console.log(`📊 Domains remaining after deletion: ${countAfter}`);

    if (countAfter === 0) {
      console.log("✅ All domains successfully deleted!");
    } else {
      console.log("⚠️  Some domains may still exist");
    }

  } catch (error) {
    console.error("❌ Error deleting domains:", error);
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed");
    process.exit(0);
  }
}

// Run the deletion function
console.log("🚨 WARNING: This will delete ALL domains and routes!");
console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");

setTimeout(() => {
  console.log("Starting deletion...");
  deleteAllDomains();
}, 5000);
