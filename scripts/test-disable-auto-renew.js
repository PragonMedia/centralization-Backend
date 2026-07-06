/**
 * Dry-run style test: calls disableRegistrarAutoRenew (safe if already off).
 * Usage: node scripts/test-disable-auto-renew.js example.com
 */
require("dotenv").config();
const cloudflareService = require("../services/cloudflareService");

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: node scripts/test-disable-auto-renew.js <domain>");
  process.exit(1);
}

(async () => {
  try {
    const result = await cloudflareService.disableRegistrarAutoRenew(domain);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
  }
})();
