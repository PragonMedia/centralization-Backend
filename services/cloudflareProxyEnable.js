const axios = require("axios");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

/**
 * Enable Cloudflare proxy for ALL DNS records in a domain (except NS records)
 * This is called after SSL is successfully issued to enable orange-cloud proxy
 * @param {string} domain - Domain name
 * @returns {Promise<object>} Success status
 */
async function enableProxyForDomain(domain) {
  const token = CLOUDFLARE_CONFIG.API_TOKEN;
  const baseURL = CLOUDFLARE_CONFIG.BASE_URL;

  try {
    // 1. Get zone for domain
    const zoneRes = await axios.get(`${baseURL}/zones`, {
      params: { name: domain },
      headers: { Authorization: `Bearer ${token}` },
    });

    const zoneId = zoneRes.data?.result?.[0]?.id;
    if (!zoneId) {
      throw new Error(`Zone not found in Cloudflare for domain: ${domain}`);
    }

    console.log(`✅ Found zone: ${domain} (${zoneId})`);

    // 2. Get all DNS records
    const recRes = await axios.get(`${baseURL}/zones/${zoneId}/dns_records`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const records = recRes.data?.result || [];
    console.log(`📋 Found ${records.length} DNS record(s) for ${domain}`);

    // 3. Update all records to proxied:true (except NS records and trk.* records)
    const updatePromises = [];
    for (const rec of records) {
      // Skip NS records (nameservers cannot be proxied)
      if (rec.type === "NS") {
        console.log(`⏭️  Skipping NS record: ${rec.name}`);
        continue;
      }

      // Skip trk.* records (RedTrack CNAME must remain DNS-only)
      if (rec.name.startsWith("trk.")) {
        console.log(
          `⏭️  Skipping trk.* record: ${rec.name} (${rec.type}) - RedTrack CNAME must remain DNS-only`
        );
        continue;
      }

      // Skip if already proxied
      if (rec.proxied === true) {
        console.log(`✅ ${rec.name} (${rec.type}) already proxied`);
        continue;
      }

      console.log(`⚡ Enabling proxy for ${rec.name} (${rec.type})`);

      const updatePromise = axios.put(
        `${baseURL}/zones/${zoneId}/dns_records/${rec.id}`,
        {
          type: rec.type,
          name: rec.name,
          content: rec.content,
          ttl: rec.ttl === 1 ? "auto" : rec.ttl, // Preserve TTL, but use "auto" if it was 1
          proxied: true, // ← IMPORTANT: Enable orange cloud
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      updatePromises.push(updatePromise);
    }

    // Wait for all updates to complete
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      console.log(
        `✅ Enabled Cloudflare proxy for ${updatePromises.length} DNS record(s)`
      );
    } else {
      console.log(`ℹ️  All DNS records are already proxied`);
    }

    return { success: true, recordsUpdated: updatePromises.length };
  } catch (error) {
    console.error(`❌ Error enabling proxy for ${domain}:`, error.message);

    if (error.response) {
      console.error(
        "Cloudflare API Error:",
        JSON.stringify(error.response.data, null, 2)
      );
      throw new Error(
        `Failed to enable proxy: ${
          error.response.data?.errors?.[0]?.message || error.message
        }`
      );
    }

    throw new Error(`Failed to enable proxy: ${error.message}`);
  }
}

module.exports = { enableProxyForDomain };
