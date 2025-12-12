const mongoose = require("mongoose");
const Domain = require("./models/domainModel");

// Test database connection
const testConnection = async () => {
  try {
    await mongoose.connect("mongodb://localhost:27017/paragonApi", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Test domain update
const testDomainUpdate = async () => {
  try {
    console.log("\n🔍 Testing domain update...");

    // First, let's see what domains exist
    const existingDomains = await Domain.find({});
    console.log(
      "📋 Existing domains:",
      existingDomains.map((d) => d.domain)
    );

    if (existingDomains.length === 0) {
      console.log("❌ No domains found to test with");
      return;
    }

    const testDomain = existingDomains[0];
    const oldDomainName = testDomain.domain;
    const newDomainName = `test-${Date.now()}.com`;

    console.log(`\n🔄 Testing update: ${oldDomainName} -> ${newDomainName}`);

    // Test the update
    const updatedDomain = await Domain.findOneAndUpdate(
      { domain: oldDomainName },
      { domain: newDomainName },
      { new: true, runValidators: true }
    );

    if (updatedDomain) {
      console.log("✅ Update successful:", updatedDomain.domain);

      // Verify the update
      const verificationDoc = await Domain.findOne({ domain: newDomainName });
      if (verificationDoc) {
        console.log("✅ Verification successful:", verificationDoc.domain);
      } else {
        console.log("❌ Verification failed - new domain not found");
      }

      // Check if old domain still exists
      const oldDomainDoc = await Domain.findOne({ domain: oldDomainName });
      if (oldDomainDoc) {
        console.log("❌ Old domain still exists:", oldDomainDoc.domain);
      } else {
        console.log("✅ Old domain properly removed");
      }

      // Revert the change for testing
      await Domain.findOneAndUpdate(
        { domain: newDomainName },
        { domain: oldDomainName },
        { new: true }
      );
      console.log("🔄 Reverted change back to:", oldDomainName);
    } else {
      console.log("❌ Update failed");
    }
  } catch (error) {
    console.error("❌ Test error:", error);
  }
};

// Run tests
const runTests = async () => {
  await testConnection();
  await testDomainUpdate();

  console.log("\n🏁 Tests completed");
  process.exit(0);
};

runTests();

