const axios = require("axios");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

/**
 * Get or create Cloudflare zone for a domain
 * @param {string} domain - Domain name
 * @returns {Promise<string>} Zone ID
 */
async function getZoneId(domain) {
  try {
    // Validate API token is set
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
      return zone.id;
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

    return newZone.id;
  } catch (error) {
    console.error("Error getting/creating zone:", error);

    // Show more detailed error information
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
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 * @param {string} serverIP - Server IP address
 * @returns {Promise<boolean>}
 */
async function setARecord(zoneId, domain, serverIP) {
  try {
    // We need to create/update both root and wildcard A records
    // Use "@" for root domain (Cloudflare standard)
    const recordsToEnsure = [
      { name: "@", displayName: "root" }, // @ represents root domain
      { name: `*.${domain}`, displayName: "wildcard" }, // *.example.com
    ];

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

      const payload = {
        type: "A",
        name: name, // Use "@" for root, "*.domain" for wildcard
        content: serverIP,
        ttl: 1, // Auto
        proxied: false, // Disabled for SSL setup
      };

      if (existingRecord) {
        // Update existing A record
        await axios.put(
          `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${existingRecord.id}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(
          `✅ Updated ${displayName} A record: ${name} → ${serverIP}`
        );
      } else {
        // Create new A record
        await axios.post(
          `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(
          `✅ Created ${displayName} A record: ${name} → ${serverIP}`
        );
      }
    }

    return true;
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

    // If there's an A or AAAA record, we need to delete it first (can't have both)
    if (existingRecord && existingRecord.type !== "CNAME") {
      console.log(
        `⚠️  Found existing ${existingRecord.type} record for "${trackingSubdomain}". Deleting it to create CNAME...`
      );
      await axios.delete(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${existingRecord.id}`,
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`✅ Deleted existing ${existingRecord.type} record`);
    }

    const payload = {
      type: "CNAME",
      name: trackingSubdomain, // Use full subdomain: trk.example.com
      content: redtrackDedicatedDomain, // e.g., dx8jy.ttrk.io
      ttl: 1, // Auto (lowest TTL)
      proxied: false, // CRITICAL: DNS only (not proxied)
    };

    // Check if CNAME already exists and is correct
    const existingCNAME = existingRecords.find(
      (record) => record.name === trackingSubdomain && record.type === "CNAME"
    );

    if (existingCNAME) {
      // Check if it's already pointing to the correct target
      if (existingCNAME.content === redtrackDedicatedDomain) {
        console.log(
          `✅ CNAME already exists and is correct: ${trackingSubdomain} → ${redtrackDedicatedDomain}`
        );
        // Skip verification wait since it's already correct
        return true;
      }

      // Update existing CNAME record
      await axios.put(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${existingCNAME.id}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(
        `✅ Updated CNAME: ${trackingSubdomain} → ${redtrackDedicatedDomain}`
      );
    } else {
      // Create new CNAME record
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
      console.log(
        `✅ Created CNAME: ${trackingSubdomain} → ${redtrackDedicatedDomain}`
      );
    }

    // Verify the CNAME was created correctly
    console.log(`🔄 Verifying CNAME record...`);
    const verifyResponse = await axios.get(
      `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
        },
        params: {
          type: "CNAME",
          name: trackingSubdomain, // Use full subdomain for verification
        },
      }
    );

    const verifiedRecords = verifyResponse.data.result || [];
    const verifiedCNAME = verifiedRecords.find(
      (record) => record.name === trackingSubdomain
    );

    if (!verifiedCNAME || verifiedCNAME.content !== redtrackDedicatedDomain) {
      throw new Error(
        `CNAME verification failed. Expected ${redtrackDedicatedDomain}, got ${
          verifiedCNAME?.content || "none"
        }`
      );
    }

    console.log(
      `✅ Verified CNAME: ${verifiedCNAME.name} → ${verifiedCNAME.content}`
    );

    // Wait for DNS propagation (RedTrack needs time to see the CNAME)
    console.log(`⏳ Waiting 10 seconds for DNS propagation...`);
    await new Promise((resolve) => setTimeout(resolve, 10000));

    return true;
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
    console.error("Error setting SSL mode:", error);
    throw new Error(`Failed to set SSL mode: ${error.message}`);
  }
}

/**
 * Enable proxy status for root + wildcard A records only
 * @param {string} zoneId - Cloudflare zone ID
 * @param {string} domain - Domain name
 * @returns {Promise<boolean>}
 */
async function enableProxy(zoneId, domain) {
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

    // Filter A and AAAA records that match our target names
    const aRecords = records.filter(
      (record) =>
        ["A", "AAAA"].includes(record.type) &&
        (targetNames.includes(record.name) || record.name === domain)
    );

    // Update each record to enable proxy
    const updatePromises = aRecords.map((record) =>
      axios.patch(
        `${CLOUDFLARE_CONFIG.BASE_URL}/zones/${zoneId}/dns_records/${record.id}`,
        { proxied: true },
        {
          headers: {
            Authorization: `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      )
    );

    await Promise.all(updatePromises);
    console.log(`✅ Proxy enabled for ${domain} and *.${domain}`);

    return true;
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
  getZoneId,
  disableProxy,
  setARecord,
  createRedTrackCNAME,
  setSSLMode,
  enableProxy,
  deleteDNSRecords,
};
