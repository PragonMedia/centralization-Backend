// Quick script to test Cloudflare cache purging
require("dotenv").config();
const { getZoneId, purgeCache } = require("./services/cloudflareService");

async function testCachePurge(domain) {
  try {
    console.log(`\n🔍 Testing cache purge for: ${domain}\n`);

    // Get zone ID
    const zoneId = await getZoneId(domain);
    console.log(`✅ Zone ID: ${zoneId}\n`);

    // Check if proxy is enabled (if DNS-only, there's no cache)
    console.log("⚠️  IMPORTANT: If Cloudflare proxy is DISABLED (DNS-only),");
    console.log("   there is NO cache to purge. Only proxied domains are cached.\n");

    // Purge everything
    console.log("🔄 Purging cache...");
    await purgeCache(zoneId);
    
    console.log("\n✅ Cache purge completed!");
    console.log("\n📝 Next steps:");
    console.log("   1. Wait 10-30 seconds for purge to propagate");
    console.log("   2. Test in incognito/private window");
    console.log("   3. Add ?nocache=" + Date.now() + " to URL to bypass browser cache");
    console.log("   4. Check response headers: curl -I https://" + domain);
    console.log("      Look for 'CF-Cache-Status' header\n");

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.message.includes("permission")) {
      console.error("\n💡 Fix: Update your Cloudflare API token permissions:");
      console.error("   - Go to Cloudflare Dashboard → My Profile → API Tokens");
      console.error("   - Edit your token and add: Zone → Cache Purge → Purge");
    }
  }
}

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: node testCachePurge.js <domain>");
  console.error("Example: node testCachePurge.js pgnmapprovedlanderv4.com");
  process.exit(1);
}

testCachePurge(domain).then(() => process.exit(0)).catch(() => process.exit(1));

