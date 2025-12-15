const axios = require("axios");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

/**
 * Enable Cloudflare proxy for DNS records in a domain (except NS and trk.* records)
 * Only enables proxy for records specified by targetRecordIds, or all root/wildcard A records if empty
 * @param {string} domain - Domain name
 * @param {string[]} targetRecordIds - Array of DNS record IDs to enable proxy for (empty = all root/wildcard A records)
 * @returns {Promise<object>} Success status
 */
async function enableProxyForDomain(domain, targetRecordIds = []) {
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

    // 3. Update only the records we created in this flow:
    //    - root A (@ / domain) and wildcard A (*.domain)
    //    - trk.* CNAME records (enable proxy for RedTrack)
    //    - skip NS always
    //    - if targetRecordIds provided, only touch those IDs
    const updatePromises = [];
    for (const rec of records) {
      const isTargetType = ["A", "AAAA"].includes(rec.type);
      const isTrkCNAME = rec.type === "CNAME" && rec.name.startsWith("trk.");
      const isRoot = rec.name === domain || rec.name === "@";
      const isWildcard = rec.name === `*.${domain}`;
      const isTargetId =
        targetRecordIds.length === 0 || targetRecordIds.includes(rec.id);

      // Skip NS records (nameservers cannot be proxied)
      if (rec.type === "NS") {
        console.log(`⏭️  Skipping NS record: ${rec.name}`);
        continue;
      }

      // Skip trk.* CNAME records - they should remain DNS-only until AFTER RedTrack registration
      // trk CNAME proxy is handled separately by enableProxyForTrkCNAME() after RedTrack succeeds
      if (isTrkCNAME) {
        console.log(`⏭️  Skipping trk CNAME record: ${rec.name} (must stay DNS-only for RedTrack verification)`);
        continue;
      }

      // Only touch target root/wildcard A/AAAA records
      if (!isTargetType || !(isRoot || isWildcard) || !isTargetId) {
        continue;
      }

      // Skip if already proxied
      if (rec.proxied === true) {
        console.log(`✅ ${rec.name} (${rec.type}) already proxied`);
        continue;
      }

      console.log(`⚡ Enabling proxy for ${rec.name} (${rec.type})`);

      const updatePromise = axios.patch(
        `${baseURL}/zones/${zoneId}/dns_records/${rec.id}`,
        { proxied: true },
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

/**
 * Enable Cloudflare proxy specifically for trk CNAME record
 * @param {string} domain - Domain name
 * @returns {Promise<object>} Success status
 */
async function enableProxyForTrkCNAME(domain) {
  const token = CLOUDFLARE_CONFIG.API_TOKEN;
  const baseURL = CLOUDFLARE_CONFIG.BASE_URL;

  try {
    console.log(`🔍 [enableProxyForTrkCNAME] Starting for domain: ${domain}`);

    // 1. Get zone for domain
    console.log(
      `🔍 [enableProxyForTrkCNAME] Fetching Cloudflare zone for: ${domain}`
    );
    const zoneRes = await axios.get(`${baseURL}/zones`, {
      params: { name: domain },
      headers: { Authorization: `Bearer ${token}` },
    });

    const zoneId = zoneRes.data?.result?.[0]?.id;
    if (!zoneId) {
      console.error(
        `❌ [enableProxyForTrkCNAME] Zone not found for domain: ${domain}`
      );
      throw new Error(`Zone not found in Cloudflare for domain: ${domain}`);
    }
    console.log(`✅ [enableProxyForTrkCNAME] Found zone: ${zoneId}`);

    // 2. Get trk CNAME record
    const trackingSubdomain = `trk.${domain}`;
    console.log(
      `🔍 [enableProxyForTrkCNAME] Fetching CNAME record: ${trackingSubdomain}`
    );
    const recRes = await axios.get(`${baseURL}/zones/${zoneId}/dns_records`, {
      params: { name: trackingSubdomain, type: "CNAME" },
      headers: { Authorization: `Bearer ${token}` },
    });

    const records = recRes.data?.result || [];
    const trkRecord = records.find(
      (rec) => rec.name === trackingSubdomain && rec.type === "CNAME"
    );

    if (!trkRecord) {
      console.error(
        `❌ [enableProxyForTrkCNAME] trk CNAME record not found: ${trackingSubdomain}`
      );
      return { success: false, error: "trk CNAME record not found" };
    }

    console.log(
      `📋 [enableProxyForTrkCNAME] Current trk CNAME status: proxied=${trkRecord.proxied}, target=${trkRecord.content}`
    );

    if (trkRecord.proxied === true) {
      console.log(
        `✅ [enableProxyForTrkCNAME] ${trkRecord.name} (CNAME) already proxied - no action needed`
      );
      return { success: true };
    }

    // 3. Enable proxy for trk CNAME
    console.log(
      `⚡ [enableProxyForTrkCNAME] Enabling proxy for ${trkRecord.name} (CNAME)`
    );
    console.log(
      `📝 [enableProxyForTrkCNAME] Updating record ID: ${trkRecord.id} in zone: ${zoneId}`
    );
    await axios.patch(
      `${baseURL}/zones/${zoneId}/dns_records/${trkRecord.id}`,
      { proxied: true },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `✅ [enableProxyForTrkCNAME] Successfully enabled Cloudflare proxy for trk CNAME: ${trkRecord.name}`
    );
    return { success: true };
  } catch (error) {
    console.error(
      `❌ [enableProxyForTrkCNAME] Error enabling proxy for trk CNAME:`,
      error.message
    );
    if (error.response) {
      console.error(
        `❌ [enableProxyForTrkCNAME] Cloudflare API error:`,
        JSON.stringify(error.response.data, null, 2)
      );
    }
    return { success: false, error: error.message };
  }
}

/**
 * Disable Cloudflare proxy for trk CNAME record (for RedTrack verification)
 * @param {string} domain - Domain name
 * @returns {Promise<object>} Success status
 */
async function disableProxyForTrkCNAME(domain) {
  const token = CLOUDFLARE_CONFIG.API_TOKEN;
  const baseURL = CLOUDFLARE_CONFIG.BASE_URL;

  try {
    console.log(`🔍 [disableProxyForTrkCNAME] Starting for domain: ${domain}`);

    // 1. Get zone for domain
    console.log(
      `🔍 [disableProxyForTrkCNAME] Fetching Cloudflare zone for: ${domain}`
    );
    const zoneRes = await axios.get(`${baseURL}/zones`, {
      params: { name: domain },
      headers: { Authorization: `Bearer ${token}` },
    });

    const zoneId = zoneRes.data?.result?.[0]?.id;
    if (!zoneId) {
      console.error(
        `❌ [disableProxyForTrkCNAME] Zone not found for domain: ${domain}`
      );
      throw new Error(`Zone not found in Cloudflare for domain: ${domain}`);
    }
    console.log(`✅ [disableProxyForTrkCNAME] Found zone: ${zoneId}`);

    // 2. Get trk CNAME record
    const trackingSubdomain = `trk.${domain}`;
    console.log(
      `🔍 [disableProxyForTrkCNAME] Fetching CNAME record: ${trackingSubdomain}`
    );
    const recRes = await axios.get(`${baseURL}/zones/${zoneId}/dns_records`, {
      params: { name: trackingSubdomain, type: "CNAME" },
      headers: { Authorization: `Bearer ${token}` },
    });

    const records = recRes.data?.result || [];
    const trkRecord = records.find(
      (rec) => rec.name === trackingSubdomain && rec.type === "CNAME"
    );

    if (!trkRecord) {
      console.error(
        `❌ [disableProxyForTrkCNAME] trk CNAME record not found: ${trackingSubdomain}`
      );
      return { success: false, error: "trk CNAME record not found" };
    }

    console.log(
      `📋 [disableProxyForTrkCNAME] Current trk CNAME status: proxied=${trkRecord.proxied}, target=${trkRecord.content}`
    );

    if (trkRecord.proxied === false) {
      console.log(
        `✅ [disableProxyForTrkCNAME] ${trkRecord.name} (CNAME) already DNS-only - no action needed`
      );
      return { success: true };
    }

    // 3. Disable proxy for trk CNAME
    console.log(
      `⚡ [disableProxyForTrkCNAME] Disabling proxy for ${trkRecord.name} (CNAME) - needed for RedTrack verification`
    );
    console.log(
      `📝 [disableProxyForTrkCNAME] Updating record ID: ${trkRecord.id} in zone: ${zoneId}`
    );
    await axios.patch(
      `${baseURL}/zones/${zoneId}/dns_records/${trkRecord.id}`,
      { proxied: false },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `✅ [disableProxyForTrkCNAME] Successfully disabled Cloudflare proxy for trk CNAME: ${trkRecord.name} (now DNS-only)`
    );
    return { success: true };
  } catch (error) {
    console.error(
      `❌ [disableProxyForTrkCNAME] Error disabling proxy for trk CNAME:`,
      error.message
    );
    if (error.response) {
      console.error(
        `❌ [disableProxyForTrkCNAME] Cloudflare API error:`,
        JSON.stringify(error.response.data, null, 2)
      );
    }
    return { success: false, error: error.message };
  }
}

module.exports = {
  enableProxyForDomain,
  enableProxyForTrkCNAME,
  disableProxyForTrkCNAME,
};
