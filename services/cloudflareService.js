const axios = require("axios");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

/**
 * Get or create Cloudflare zone for a domain
 * Returns the full zone object so callers can inspect status.
 * @param {string} domain - Domain name
 * @returns {Promise<{id: string, name: string, status: string, name_servers: string[]}>}
 */
async function getOrCreateZone(domain) {
  try {
    if (
      !CLOUDFLARE_CONFIG.API_TOKEN ||
      CLOUDFLARE_CONFIG.API_TOKEN.trim() === ""
    ) {
      throw new Error(
        "Cloudflare API token is not set. Please check your .env file (CLOUDFLARE_API_TOKEN)"
      );
    }

    // First, try to get existing zone
    const response = await axios.get(`${CLOUDFLARE_CONFIG.BASE_URL}/zones`, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
        "Content-Type": "application/json",
      },
      params: {
        name: domain,
      },
    });

    if (response.data.result && response.data.result.length > 0) {
      const zone = response.data.result[0];
      console.log(`✅ Found existing zone: ${zone.name} (${zone.id})`);
      return {
        id: zone.id,
        name: zone.name,
        status: zone.status,
        name_servers: zone.name_servers,
      };
    }

    // Zone doesn't exist, create it
    const createResponse = await axios.post(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones`,
      {
        name: domain,
        account: { id: CLOUDFLARE_CONFIG.ACCOUNT_ID },
      },
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const newZone = createResponse.data.result;
    console.log(`✅ Created new zone: ${newZone.name} (${newZone.id})`);

    // ⚠️ IMPORTANT: Zone creation is not enough!
    // User must change nameservers at registrar to Cloudflare's nameservers
    console.warn(`⚠️  IMPORTANT: Update nameservers at registrar to:`);
    newZone.name_servers.forEach((ns) => console.warn(`   - ${ns}`));

    return {
      id: newZone.id,
      name: newZone.name,
      status: newZone.status,
      name_servers: newZone.name_servers,
    };
  } catch (error) {
    console.error("Error getting/creating zone:", error);

    if (error.response) {
      const cfError = error.response.data;
      console.error("Cloudflare API Error:", JSON.stringify(cfError, null, 2));

      if (cfError.errors && cfError.errors.length > 0) {
        const errorMessages = cfError.errors.map((e) => e.message).join(", ");
        throw new Error(`Cloudflare API Error: ${errorMessages}`);
      }
    }

    throw new Error(
      `Failed to get or create Cloudflare zone: ${error.message}`
    );
  }
}

/**
 * Backwards-compatible helper returning only the zone ID.
 * @param {string} domain
 * @returns {Promise<string>}
 */
async function getZoneId(domain) {
  const zone = await getOrCreateZone(domain);
  return zone.id;
}

/**
 * Disable proxy status for root + wildcard A records only
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 * @returns {Promise<boolean>}
 */
async function disableProxy(zoneId, domain) {
  try {
    // Get all DNS records
    const response = await axios.get(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
        },
      }
    );

    const records = response.data.result || [];

    // Only target the records we control: root domain and wildcard
    // "@" represents root domain, but Cloudflare may return it as the full domain name
    const targetNames = [domain, "@", `*.${domain}`];

    // Filter A and AAAA records that match our target names and are currently proxied
    const proxiableRecords = records.filter(
      (record) =>
        ["A", "AAAA"].includes(record.type) &&
        record.proxied === true &&
        (targetNames.includes(record.name) || record.name === domain)
    );

    // Update each record to disable proxy
    const updatePromises = proxiableRecords.map((record) =>
      axios.patch(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${record.id}`,
        { proxied: false },
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      )
    );

    await Promise.all(updatePromises);

    if (proxiableRecords.length > 0) {
      console.log(
        `✅ Disabled proxy for ${proxiableRecords.length} A/AAAA record(s)`
      );
    }

    return true;
  } catch (error) {
    console.error("Error disabling proxy:", error);
    throw new Error(`Failed to disable proxy: ${error.message}`);
  }
}

/**
 * Set A record for root domain and wildcard
 * ONLY uses Cloudflare API - NEVER performs DNS lookups, polling, or validation
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 * @param {string} serverIP - Server IP address
 * @returns {Promise<{createdRecordIds: string[], existingRecordIds: string[]}>}
 */
async function setARecord(zoneId, domain, serverIP) {
  try {
    // We need to create/update both root and wildcard A records
    // Use "@" for root domain (Cloudflare standard)
    const recordsToEnsure = [
      { name: "@", displayName: "root" }, // @ represents root domain
      { name: `*.${domain}`, displayName: "wildcard" }, // *.example.com
    ];

    const createdRecordIds = [];
    const existingRecordIds = [];

    for (const { name, displayName } of recordsToEnsure) {
      // Get existing A records for this name
      // For "@", we need to search by the actual domain name
      const searchName = name === "@" ? domain : name;

      const response = await axios.get(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
          },
          params: {
            type: "A",
            name: searchName,
          },
        }
      );

      const existingRecords = response.data.result || [];
      // For "@" records, Cloudflare returns the full domain name, so we need to match by domain
      const existingRecord = existingRecords.find((record) =>
        name === "@"
          ? record.name === domain || record.name === "@"
          : record.name === name
      );

      if (existingRecord) {
        // Record already exists - use it regardless of IP (no IP verification)
        console.log(
          `✅ ${displayName} A record already present: ${existingRecord.name} → ${existingRecord.content}`
        );
        existingRecordIds.push(existingRecord.id);
      } else {
        const payload = {
          type: "A",
          name: name, // Use "@" for root, "*.domain" for wildcard
          content: serverIP,
          ttl: 1, // Auto
          proxied: false, // Start DNS-only per flow requirements
        };

        // Create new A record
        const createRes = await axios.post(
          `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        const createdId = createRes.data?.result?.id;
        if (createdId) {
          createdRecordIds.push(createdId);
        }
        console.log(
          `✅ Created ${displayName} A record: ${name} → ${serverIP} (proxied: false)`
        );
      }
    }

    return { createdRecordIds, existingRecordIds };
  } catch (error) {
    console.error("Error setting A record:", error);
    throw new Error(`Failed to set A record: ${error.message}`);
  }
}

/**
 * Create CNAME record for RedTrack tracking domain
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} rootDomain - Root domain name
 * @param {string} redtrackDedicatedDomain - RedTrack dedicated domain
 * @returns {Promise<boolean>}
 */
async function createRedTrackCNAME(
  zoneId,
  rootDomain,
  redtrackDedicatedDomain
) {
  try {
    const trackingSubdomain = `trk.${rootDomain}`;

    // Get ALL existing records for trk subdomain (A, AAAA, or CNAME)
    // Use full subdomain name: trk.{domain}
    const response = await axios.get(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
        },
        params: {
          name: trackingSubdomain, // Use full subdomain: trk.example.com
        },
      }
    );

    const existingRecords = response.data.result || [];
    const existingRecord = existingRecords.find(
      (record) => record.name === trackingSubdomain
    );

    if (existingRecord) {
      if (existingRecord.type === "CNAME") {
        if (existingRecord.content === redtrackDedicatedDomain) {
          console.log(
            `✅ CNAME already exists and is correct: ${trackingSubdomain} → ${redtrackDedicatedDomain}`
          );
          return { recordId: existingRecord.id, created: false };
        }
        throw new Error(
          `CNAME for ${trackingSubdomain} already points to ${existingRecord.content}. Not modifying existing records.`
        );
      }

      // Different record type exists; do not delete per safety requirement
      throw new Error(
        `${existingRecord.type} record already exists for ${trackingSubdomain}. Please remove it manually before creating CNAME to ${redtrackDedicatedDomain}.`
      );
    }

    const payload = {
      type: "CNAME",
      name: trackingSubdomain, // Use full subdomain: trk.example.com
      content: redtrackDedicatedDomain, // e.g., dx8jy.ttrk.io
      ttl: 1, // Auto (lowest TTL)
      proxied: false, // DNS only per requirements
    };

    const createResponse = await axios.post(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const createdId = createResponse.data?.result?.id;

    console.log(
      `✅ Created CNAME: ${trackingSubdomain} → ${redtrackDedicatedDomain} (proxied: false)`
    );

    return { recordId: createdId, created: true };
  } catch (error) {
    console.error("Error creating RedTrack CNAME:", error);

    // Log detailed error from Cloudflare
    if (error.response && error.response.data) {
      console.error(
        "Cloudflare API Error:",
        JSON.stringify(error.response.data, null, 2)
      );
    }

    throw new Error(`Failed to create CNAME record: ${error.message}`);
  }
}

/**
 * Set Cloudflare SSL mode
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} sslMode - SSL mode (full, flexible, strict)
 * @returns {Promise<object>}
 */
async function setSSLMode(zoneId, sslMode = "full") {
  try {
    // Set Cloudflare SSL mode (full, flexible, or strict)
    // This determines how Cloudflare handles SSL between edge and origin
    const response = await axios.patch(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/settings/ssl`,
      {
        value: sslMode, // 'full', 'flexible', or 'strict'
      },
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ SSL mode set to: ${sslMode}`);
    return response.data.result;
  } catch (error) {
    // Make SSL mode setting non-fatal - log warning but don't block domain creation
    // Common reasons for failure: API token lacks Zone:Edit:SSL permissions, or zone is on a plan that doesn't support it
    if (error.response?.status === 403) {
      console.warn(`⚠️  Could not set SSL mode to ${sslMode}: API token lacks Zone:Edit:SSL permission (non-fatal)`);
      console.warn(`⚠️  You can set SSL mode manually in Cloudflare dashboard or update API token permissions`);
      return { skipped: true, reason: "insufficient_permissions" };
    } else if (error.response?.status === 400) {
      console.warn(`⚠️  Could not set SSL mode to ${sslMode}: Invalid request (non-fatal)`);
      return { skipped: true, reason: "invalid_request" };
    } else {
      console.warn(`⚠️  Could not set SSL mode to ${sslMode}: ${error.message} (non-fatal)`);
      return { skipped: true, reason: error.message };
    }
  }
}

/**
 * Enable proxy status for root + wildcard A records only
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 * @returns {Promise<boolean>}
 */
async function enableProxy(zoneId, domain, targetRecordIds = [], serverIP = CLOUDFLARE_CONFIG.SERVER_IP) {
  try {
    // Get all DNS records
    const response = await axios.get(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
        },
      }
    );

    const records = response.data.result || [];

    // Only target the records we control: root domain and wildcard
    // "@" represents root domain, but Cloudflare may return it as the full domain name
    const targetNames = [domain, "@", `*.${domain}`];

    const aRecords = records.filter((record) => {
      const isTargetName =
        targetNames.includes(record.name) || record.name === domain;
      const isTargetType = ["A", "AAAA"].includes(record.type);
      const isTargetId =
        targetRecordIds.length === 0 || targetRecordIds.includes(record.id);

      // Never touch tracking subdomain or unrelated records
      if (record.name?.startsWith("trk.")) return false;

      // Honor safety rule: only change records we just created or explicitly target
      return isTargetName && isTargetType && isTargetId;
    });

    if (aRecords.length === 0) {
      console.log(
        `ℹ️  No eligible A/AAAA records to proxy for ${domain}. Skipping proxy enablement.`
      );
      return { updated: 0 };
    }

    const updatePromises = aRecords.map((record) => {
      // If a record points somewhere else and isn't ours, skip touching it
      if (serverIP && record.content !== serverIP) {
        console.log(
          `⏭️  Skipping ${record.name} (${record.type}) — content ${record.content} differs from ${serverIP}`
        );
        return Promise.resolve(null);
      }

      if (record.proxied === true) {
        console.log(`✅ ${record.name} (${record.type}) already proxied`);
        return Promise.resolve(null);
      }

      console.log(`⚡ Enabling proxy for ${record.name} (${record.type})`);
      return axios.patch(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${record.id}`,
        { proxied: true },
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    });

    const results = await Promise.all(updatePromises);
    const updatedCount = results.filter(Boolean).length;
    console.log(
      `✅ Enabled Cloudflare proxy for ${updatedCount} record(s) on ${domain}`
    );

    return { updated: updatedCount };
  } catch (error) {
    console.error("Error enabling proxy:", error);
    throw new Error(`Failed to enable proxy: ${error.message}`);
  }
}

/**
 * Delete DNS records we created for a domain
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 * @returns {Promise<boolean>}
 */
async function deleteDNSRecords(zoneId, domain) {
  try {
    // Get all DNS records for the zone
    const response = await axios.get(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
        },
      }
    );

    const records = response.data.result || [];

    // Find records we created:
    // 1. A records for root domain (may be "@" or domain name) and wildcard
    // Note: CNAME for trk subdomain is managed by RedTrack, not us
    const recordsToDelete = records.filter(
      (record) =>
        // A records for root (as "@" or domain name) and wildcard pointing to our server IP
        ["A", "AAAA"].includes(record.type) &&
        (record.name === domain ||
          record.name === "@" ||
          record.name === `*.${domain}`) &&
        record.content === CLOUDFLARE_CONFIG.SERVER_IP
    );

    if (recordsToDelete.length === 0) {
      console.log(`ℹ️  No DNS records found to delete for ${domain}`);
      return true;
    }

    // Delete each record
    const deletePromises = recordsToDelete.map((record) =>
      axios.delete(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${record.id}`,
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      )
    );

    await Promise.all(deletePromises);
    console.log(
      `✅ Deleted ${recordsToDelete.length} DNS record(s) for ${domain}`
    );

    return true;
  } catch (error) {
    console.error("Error deleting DNS records:", error);
    throw new Error(`Failed to delete DNS records: ${error.message}`);
  }
}

module.exports = {
  getOrCreateZone,
  getZoneId,
  disableProxy,
  setARecord,
  createRedTrackCNAME,
  setSSLMode,
  enableProxy,
  deleteDNSRecords,
};
