const axios = require("axios");
const REDTRACK_CONFIG = require("../config/redtrack");

// Create axios client with base configuration
// RedTrack uses api_key as a query parameter for authentication
const client = axios.create({
  baseURL: REDTRACK_CONFIG.API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add axios interceptor to automatically add api_key query parameter to all requests
client.interceptors.request.use(
  (config) => {
    // Add api_key as query parameter to all requests
    if (REDTRACK_CONFIG.API_KEY) {
      config.params = config.params || {};
      config.params.api_key = REDTRACK_CONFIG.API_KEY;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Build tracking domain from root domain
 * @param {string} rootDomain - Root domain name
 * @returns {string} Tracking domain (trk.{rootDomain})
 */
function buildTrackingDomain(rootDomain) {
  return `trk.${rootDomain}`; // e.g., trk.sample123.com
}

/**
 * Get RedTrack dedicated domain from config
 * @returns {string} Dedicated domain
 */
function getRedTrackDedicatedDomain() {
  return REDTRACK_CONFIG.DEDICATED_DOMAIN;
}

/**
 * Add domain to RedTrack
 * @param {string} rootDomain - Root domain name
 * @returns {Promise<object>} Domain ID and tracking domain
 */
async function addRedTrackDomain(rootDomain, maxRetries = 3) {
  const trackingDomain = buildTrackingDomain(rootDomain); // trk.sample123.com

  // 1. Create domain in RedTrack
  // Based on RedTrack API, we need to send the tracking domain
  const payload = {
    url: trackingDomain, // e.g., trk.example.com
    rootDomain: rootDomain, // e.g., example.com (for redirects)
    type: "track", // Required: domain type (track, redirect, etc.)
    use_auto_generated_ssl: true, // Enable auto-generated SSL certificate
  };

  console.log(`📤 Sending to RedTrack:`, JSON.stringify(payload, null, 2));

  let lastError = null;

  // Retry logic - DNS propagation can take time
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const createRes = await client.post("/domains", payload);

      console.log(
        `📥 RedTrack response:`,
        JSON.stringify(createRes.data, null, 2)
      );

      // RedTrack API might return the domain in different formats
      const domainId =
        createRes.data?.id ||
        createRes.data?.domain?.id ||
        createRes.data?.data?.id ||
        createRes.data?.result?.id;

      if (!domainId) {
        console.error(
          "RedTrack response structure:",
          JSON.stringify(createRes.data, null, 2)
        );
        throw new Error("Failed to get domain ID from RedTrack response");
      }

      // 2. Enable Free SSL (via regenerated_free_ssl endpoint)
      // Note: RedTrack may auto-enable SSL, so we'll try but not fail if it errors
      try {
        await client.post(`/domains/regenerated_free_ssl/${domainId}`);
        console.log(`✅ Free SSL enabled for ${trackingDomain}`);
      } catch (sslError) {
        // Check if it's a conflict error (SSL already enabled or custom SSL in use)
        const errorMessage =
          sslError.response?.data?.error || sslError.message || "";

        if (
          errorMessage.includes("custom ssl certificate") ||
          errorMessage.includes("auto-generated ssl") ||
          errorMessage.includes("already enabled") ||
          errorMessage.includes("already active") ||
          errorMessage.includes("choose one of them")
        ) {
          console.log(
            `ℹ️  SSL is already configured for ${trackingDomain}. Skipping SSL regeneration.`
          );
          // This is not an error - SSL is already set up or auto-enabled
        } else {
          console.warn(
            `⚠️  SSL regeneration may have failed: ${sslError.message}`
          );
          // SSL might auto-enable, so this is not necessarily fatal
        }
      }

      return {
        domainId: String(domainId),
        trackingDomain,
        status: "pending", // RedTrack will verify DNS
      };
    } catch (error) {
      lastError = error;

      // Check if it's a DNS propagation error
      const isDNSError =
        error.response?.data?.error?.includes("cname should point to") ||
        error.response?.data?.error?.includes("DNS") ||
        error.response?.data?.error?.includes("dns");

      if (isDNSError && attempt < maxRetries) {
        const waitTime = attempt * 10; // 10s, 20s, 30s
        console.warn(
          `⚠️  DNS propagation error (attempt ${attempt}/${maxRetries}). Waiting ${waitTime}s before retry...`
        );
        console.warn(`Error: ${error.response?.data?.error || error.message}`);
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
        continue; // Retry
      }

      // If not a DNS error or last attempt, throw
      console.error("Error adding RedTrack domain:", error);

      // Log detailed error information
      if (error.response) {
        console.error("RedTrack API Error Status:", error.response.status);
        console.error("RedTrack API Error Headers:", error.response.headers);
        console.error(
          "RedTrack API Error Data:",
          JSON.stringify(error.response.data, null, 2)
        );

        const errorMessage =
          error.response.data?.error ||
          error.response.data?.message ||
          error.response.data?.errors?.[0]?.message ||
          error.message;

        throw new Error(`Failed to add domain to RedTrack: ${errorMessage}`);
      }
      throw new Error(`Failed to add domain to RedTrack: ${error.message}`);
    }
  }

  // If we get here, all retries failed
  throw (
    lastError || new Error("Failed to add domain to RedTrack after retries")
  );
}

/**
 * Check domain status in RedTrack
 * @param {string} domainId - RedTrack domain ID
 * @returns {Promise<object>} Domain status information
 */
async function checkDomainStatus(domainId) {
  try {
    const response = await client.get(`/domains/${domainId}`);
    const domain = response.data;

    return {
      id: domain.id,
      url: domain.url,
      status: domain.status || "pending", // 'active', 'pending', 'failed'
      sslEnabled: domain.sslEnabled || false,
      verified: domain.verified || false,
    };
  } catch (error) {
    console.error("Error checking domain status:", error);
    if (error.response) {
      throw new Error(
        `Failed to check domain status: ${
          error.response.data?.message || error.message
        }`
      );
    }
    throw new Error(`Failed to check domain status: ${error.message}`);
  }
}

/**
 * Delete domain from RedTrack
 * @param {string} domainId - RedTrack domain ID
 * @returns {Promise<boolean>}
 */
async function deleteRedTrackDomain(domainId) {
  try {
    await client.delete(`/domains/${domainId}`);
    console.log(`✅ Deleted RedTrack domain (ID: ${domainId})`);
    return true;
  } catch (error) {
    console.error("Error deleting RedTrack domain:", error);
    // If domain doesn't exist, that's okay - it's already deleted
    if (error.response && error.response.status === 404) {
      console.log(
        `ℹ️  RedTrack domain (ID: ${domainId}) not found, already deleted`
      );
      return true;
    }
    throw new Error(`Failed to delete RedTrack domain: ${error.message}`);
  }
}

/**
 * Quick test function to verify API key works
 * @returns {Promise<object>} Test result
 */
async function testAPIKey() {
  try {
    const res = await client.get("/domains");
    console.log("✅ RedTrack API Key Test - Status:", res.status);
    console.log(
      "✅ RedTrack API Key Test - Data:",
      JSON.stringify(res.data, null, 2)
    );
    return { success: true, status: res.status, data: res.data };
  } catch (err) {
    console.error(
      "❌ RedTrack API Key Test Error:",
      err.response?.status,
      err.response?.data || err.message
    );
    if (err.response) {
      console.error(
        "Error Details:",
        JSON.stringify(err.response.data, null, 2)
      );
    }
    return {
      success: false,
      status: err.response?.status,
      error: err.response?.data || err.message,
    };
  }
}

module.exports = {
  buildTrackingDomain,
  addRedTrackDomain,
  checkDomainStatus,
  getRedTrackDedicatedDomain,
  deleteRedTrackDomain,
  testAPIKey,
};
