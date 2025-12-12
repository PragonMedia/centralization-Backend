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

    // Delete all domains
    const result = await Domain.deleteMany({});
    console.log(`🗑️  Successfully deleted ${result.deletedCount} domains`);

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
