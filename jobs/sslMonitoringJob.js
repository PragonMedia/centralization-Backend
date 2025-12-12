const cloudflareService = require("../services/cloudflareService");
const Domain = require("../models/domainModel");

/**
 * Monitor SSL activation and enable proxy when ready
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 */
async function monitorSSLAndEnableProxy(zoneId, domain) {
  try {
    console.log(`🔄 Starting SSL monitoring for ${domain}`);
    console.log(`📋 Waiting for Let's Encrypt certificate to be active...`);

    // Wait for SSL to be active on origin server (polling)
    await cloudflareService.waitForSSLActivation(domain);

    console.log(`✅ SSL certificate is active for ${domain}`);
    console.log(`🔄 Enabling Cloudflare proxy (Orange Cloud) for ${domain}...`);

    // SSL is active on origin, enable proxy
    await cloudflareService.enableProxy(zoneId, domain);

    console.log(`✅ Proxy enabled successfully for ${domain}`);

    // Update database
    await Domain.updateOne(
      { domain },
      {
        sslStatus: "active",
        proxyStatus: "enabled",
        sslActivatedAt: new Date(),
      }
    );

    console.log(
      `✅✅ SSL activated and proxy enabled for ${domain} - Domain is fully configured!`
    );
  } catch (error) {
    console.error(`❌ SSL monitoring failed for ${domain}:`, error);
    console.error(`Error details:`, error.message);

    // Update database with error status
    await Domain.updateOne(
      { domain },
      {
        sslStatus: "failed",
        sslError: error.message,
      }
    );

    throw error; // Re-throw so caller knows it failed
  }
}

module.exports = { monitorSSLAndEnableProxy };
