// Service for purging Cloudflare cache
const Domain = require("../models/domainModel");
const {
  getOrCreateZone,
  purgeCache,
} = require("./cloudflareService");

/**
 * Purge Cloudflare cache for all domains
 * @returns {Promise<{successCount: number, failCount: number, total: number, failedDomains: Array}>}
 */
async function purgeAllDomainsCache() {
  try {
    // Fetch all domains
    const domains = await Domain.find({}).maxTimeMS(60000);

    if (domains.length === 0) {
      return {
        successCount: 0,
        failCount: 0,
        total: 0,
        failedDomains: [],
        message: "No domains found",
      };
    }

    // Purge cache for each domain
    let successCount = 0;
    let failCount = 0;
    const failedDomains = [];

    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];

      try {
        // Get zone ID (use existing zoneId from database if available, otherwise fetch it)
        let zoneId = domain.cloudflareZoneId;

        if (!zoneId) {
          const zone = await getOrCreateZone(domain.domain);
          zoneId = zone.id;
        }

        // Purge cache (purge everything)
        await purgeCache(zoneId);
        successCount++;

        // Small delay to avoid rate limiting
        if (i < domains.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
        }
      } catch (error) {
        failCount++;
        failedDomains.push({
          domain: domain.domain,
          error: error.message,
        });
      }
    }

    return {
      successCount,
      failCount,
      total: domains.length,
      failedDomains,
      message: `Purged cache for ${successCount} out of ${domains.length} domains`,
    };
  } catch (error) {
    throw new Error(`Failed to purge cache: ${error.message}`);
  }
}

/**
 * Purge Cloudflare cache for a specific domain
 * @param {string} domainName - Domain name
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function purgeDomainCache(domainName) {
  try {
    const domain = await Domain.findOne({ domain: domainName });

    if (!domain) {
      throw new Error(`Domain not found: ${domainName}`);
    }

    // Get zone ID
    let zoneId = domain.cloudflareZoneId;

    if (!zoneId) {
      const zone = await getOrCreateZone(domain.domain);
      zoneId = zone.id;
    }

    // Purge cache
    await purgeCache(zoneId);

    return {
      success: true,
      message: `Cache purged successfully for ${domainName}`,
    };
  } catch (error) {
    throw new Error(`Failed to purge cache for ${domainName}: ${error.message}`);
  }
}

module.exports = {
  purgeAllDomainsCache,
  purgeDomainCache,
};

