require("dotenv").config();
const redtrackService = require("./services/redtrackService");

async function testRedTrack() {
  try {
    console.log("🧪 Testing RedTrack Integration...\n");

    // Validate configuration
    if (!process.env.REDTRACK_API_KEY) {
      throw new Error("REDTRACK_API_KEY is not set in .env");
    }
    if (!process.env.REDTRACK_DEDICATED_DOMAIN) {
      throw new Error("REDTRACK_DEDICATED_DOMAIN is not set in .env");
    }

    // Test domain (use a domain you own)
    const testDomain = process.argv[2] || "example.com"; // Pass domain as argument
    console.log(`Testing with domain: ${testDomain}\n`);

    // 1. Test buildTrackingDomain
    console.log("1. Testing buildTrackingDomain...");
    const trackingDomain = redtrackService.buildTrackingDomain(testDomain);
    console.log(`✅ Tracking domain: ${trackingDomain}\n`);

    // 2. Test getRedTrackDedicatedDomain
    console.log("2. Testing getRedTrackDedicatedDomain...");
    const dedicatedDomain = redtrackService.getRedTrackDedicatedDomain();
    console.log(`✅ Dedicated domain: ${dedicatedDomain}\n`);

    // 3. Test addRedTrackDomain (only if you want to actually create a domain)
    // Uncomment the lines below to test actual domain creation:
    /*
    console.log("3. Testing addRedTrackDomain...");
    console.log("⚠️  WARNING: This will create a domain in RedTrack!");
    const result = await redtrackService.addRedTrackDomain(testDomain);
    console.log(`✅ Domain added:`, result);
    console.log(`   - Domain ID: ${result.domainId}`);
    console.log(`   - Tracking Domain: ${result.trackingDomain}`);
    console.log(`   - Status: ${result.status}\n`);
    */

    console.log("✅ All RedTrack tests passed!");
    console.log("\n💡 Next steps:");
    console.log("   - Uncomment domain creation test if you want to test full integration");
    console.log("   - Check RedTrack dashboard to verify domain creation");
    console.log("   - Verify CNAME record is set correctly in Cloudflare");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }
    console.error("\nFull error:", error);
    process.exit(1);
  }
}

testRedTrack();




