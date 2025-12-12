require("dotenv").config();
const cloudflareService = require("./services/cloudflareService");
const CLOUDFLARE_CONFIG = require("./config/cloudflare");

async function testCloudflare() {
  try {
    console.log("🧪 Testing Cloudflare Integration...\n");

    // Validate configuration
    if (!CLOUDFLARE_CONFIG.API_TOKEN) {
      throw new Error("CLOUDFLARE_API_TOKEN is not set in .env");
    }
    if (!CLOUDFLARE_CONFIG.ACCOUNT_ID) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is not set in .env");
    }
    if (!CLOUDFLARE_CONFIG.SERVER_IP) {
      throw new Error("SERVER_IP is not set in .env");
    }

    // Test domain (use a domain you own or have access to)
    const testDomain = process.argv[2] || "example.com"; // Pass domain as argument
    console.log(`Testing with domain: ${testDomain}\n`);

    // 1. Test getZoneId
    console.log("1. Testing getZoneId...");
    const zoneId = await cloudflareService.getZoneId(testDomain);
    console.log(`✅ Zone ID: ${zoneId}\n`);

    // 2. Test disableProxy
    console.log("2. Testing disableProxy...");
    await cloudflareService.disableProxy(zoneId, testDomain);
    console.log("✅ Proxy disabled\n");

    // 3. Test setARecord
    console.log("3. Testing setARecord...");
    await cloudflareService.setARecord(
      zoneId,
      testDomain,
      CLOUDFLARE_CONFIG.SERVER_IP
    );
    console.log("✅ A records set\n");

    // 4. Test setSSLMode
    console.log("4. Testing setSSLMode...");
    await cloudflareService.setSSLMode(zoneId, CLOUDFLARE_CONFIG.SSL_MODE);
    console.log(`✅ SSL mode set to ${CLOUDFLARE_CONFIG.SSL_MODE}\n`);

    console.log("✅ All Cloudflare tests passed!");
    console.log("\n💡 Next steps:");
    console.log("   - Check Cloudflare dashboard to verify changes");
    console.log("   - Verify DNS records are correct");
    console.log("   - Check SSL/TLS settings");
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

testCloudflare();




