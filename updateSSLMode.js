// Script to update Cloudflare SSL mode for a domain
require("dotenv").config();
const { getZoneId, setSSLMode } = require("./services/cloudflareService");

async function updateSSLModeForDomain(domain, sslMode = "full") {
  try {
    console.log(`\n🔍 Updating SSL mode for: ${domain}\n`);

    // Get zone ID
    const zoneId = await getZoneId(domain);
    console.log(`✅ Zone ID: ${zoneId}\n`);

    // Set SSL mode
    console.log(`🔄 Setting SSL mode to: ${sslMode}...`);
    const result = await setSSLMode(zoneId, sslMode);
    
    if (result?.skipped) {
      console.error(`\n❌ SSL mode update skipped: ${result.reason || "unknown reason"}`);
      if (result.reason === "insufficient_permissions") {
        console.error("\n💡 Fix: Update your Cloudflare API token permissions:");
        console.error("   - Go to Cloudflare Dashboard → My Profile → API Tokens");
        console.error("   - Edit your token and add: Zone → Zone Settings → Edit");
        console.error("   - Or use a token with Zone:Edit permissions\n");
      }
      process.exit(1);
    } else {
      console.log(`\n✅ SSL mode updated to: ${sslMode}`);
      console.log(`\n📝 Next steps:`);
      console.log(`   1. Wait 10-30 seconds for changes to propagate`);
      console.log(`   2. Test: curl -I https://${domain}/test/`);
      console.log(`   3. Check Cloudflare Dashboard → SSL/TLS → Overview\n`);
    }

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

const domain = process.argv[2];
const sslMode = process.argv[3] || "full";

if (!domain) {
  console.error("Usage: node updateSSLMode.js <domain> [sslMode]");
  console.error("Example: node updateSSLMode.js pgnmapprovedlanderv4.com full");
  console.error("\nSSL Modes:");
  console.error("  - full: Cloudflare → HTTPS → Origin (requires SSL cert on origin)");
  console.error("  - flexible: Cloudflare → HTTP → Origin (no SSL cert needed)");
  console.error("  - strict: Cloudflare → HTTPS → Origin (requires valid SSL cert)");
  process.exit(1);
}

if (!["full", "flexible", "strict"].includes(sslMode)) {
  console.error(`❌ Invalid SSL mode: ${sslMode}`);
  console.error("Valid modes: full, flexible, strict");
  process.exit(1);
}

updateSSLModeForDomain(domain, sslMode).then(() => process.exit(0)).catch(() => process.exit(1));



