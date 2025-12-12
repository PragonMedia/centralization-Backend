const mongoose = require("mongoose");
const Domain = require("./models/domainModel");

async function migrateRtkIdToDomain() {
  try {
    // Connect to MongoDB
    require("dotenv").config();
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(
      "🔄 Starting migration: Moving rtkID from routes to domain level..."
    );

    // Find all domains that have routes with rtkID
    const domains = await Domain.find({
      "routes.rtkID": { $exists: true, $ne: null },
    });

    console.log(
      `📋 Found ${domains.length} domains with routes containing rtkID`
    );

    for (const domain of domains) {
      console.log(`\n🔍 Processing domain: ${domain.domain}`);

      // Get the first rtkID from any route (assuming all routes under same domain use same rtkID)
      const firstRouteWithRtkId = domain.routes.find((route) => route.rtkID);

      if (firstRouteWithRtkId) {
        console.log(
          `  📝 Moving rtkID: ${firstRouteWithRtkId.rtkID} to domain level`
        );

        // Update domain with rtkID
        domain.rtkID = firstRouteWithRtkId.rtkID;

        // Remove rtkID from all routes
        domain.routes.forEach((route) => {
          if (route.rtkID) {
            console.log(`    🗑️  Removing rtkID from route: ${route.route}`);
            delete route.rtkID;
          }
        });

        // Save the updated domain
        await domain.save();
        console.log(`  ✅ Successfully migrated domain: ${domain.domain}`);
      }
    }

    console.log("\n🎉 Migration completed successfully!");
    console.log("📊 Summary:");
    console.log(`  - Processed ${domains.length} domains`);
    console.log(`  - Moved rtkID from routes to domain level`);
    console.log(`  - Removed rtkID from all individual routes`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrateRtkIdToDomain();
