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

      // Enable proxy for trk.* CNAME records
      if (isTrkCNAME) {
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
    // 1. Get zone for domain
    const zoneRes = await axios.get(`${baseURL}/zones`, {
      params: { name: domain },
      headers: { Authorization: `Bearer ${token}` },
    });

    const zoneId = zoneRes.data?.result?.[0]?.id;
    if (!zoneId) {
      throw new Error(`Zone not found in Cloudflare for domain: ${domain}`);
    }

    // 2. Get trk CNAME record
    const trackingSubdomain = `trk.${domain}`;
    const recRes = await axios.get(`${baseURL}/zones/${zoneId}/dns_records`, {
      params: { name: trackingSubdomain, type: "CNAME" },
      headers: { Authorization: `Bearer ${token}` },
    });

    const records = recRes.data?.result || [];
    const trkRecord = records.find((rec) => rec.name === trackingSubdomain && rec.type === "CNAME");

    if (!trkRecord) {
      return { success: false, error: "trk CNAME record not found" };
    }

    if (trkRecord.proxied === true) {
      console.log(`✅ ${trkRecord.name} (CNAME) already proxied`);
      return { success: true };
    }

    // 3. Enable proxy for trk CNAME
    console.log(`⚡ Enabling proxy for ${trkRecord.name} (CNAME)`);
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

    console.log(`✅ Enabled Cloudflare proxy for trk CNAME: ${trkRecord.name}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error enabling proxy for trk CNAME:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { enableProxyForDomain, enableProxyForTrkCNAME };
