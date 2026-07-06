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
 * Add domain to RedTrack with retry logic
 * @param {string} rootDomain - Root domain name
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
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

  // Retry logic for transient RedTrack API issues
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 2), 10000); // Exponential backoff, max 10s
        console.log(`🔄 [RedTrack] Retrying registration (attempt ${attempt}/${maxRetries}) after ${delay}ms...`);
        console.log(`⏳ [RedTrack] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        console.log(`✅ [RedTrack] Retry delay complete, attempting registration...`);
      } else {
        console.log(`🚀 [RedTrack] Attempting domain registration (attempt ${attempt}/${maxRetries})...`);
      }

      console.log(`📤 [RedTrack] POST /domains with payload:`, JSON.stringify(payload, null, 2));
      const createRes = await client.post("/domains", payload);
      console.log(`✅ [RedTrack] API request successful (status: ${createRes.status})`);

    console.log(
      `📥 [RedTrack] Response data:`,
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
    console.log(`🔐 [RedTrack] Attempting to enable SSL for domain ID: ${domainId}`);
    try {
      await client.post(`/domains/regenerated_free_ssl/${domainId}`);
      console.log(`✅ [RedTrack] Free SSL enabled for ${trackingDomain}`);
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
          `ℹ️  [RedTrack] SSL is already configured for ${trackingDomain}. Skipping SSL regeneration.`
        );
        // This is not an error - SSL is already set up or auto-enabled
      } else {
        console.warn(
          `⚠️  [RedTrack] SSL regeneration may have failed: ${sslError.message}`
        );
        if (sslError.response) {
          console.warn(`⚠️  [RedTrack] SSL error response:`, JSON.stringify(sslError.response.data, null, 2));
        }
        // SSL might auto-enable, so this is not necessarily fatal
      }
    }

      // Success - return immediately
      return {
        domainId: String(domainId),
        trackingDomain,
        status: "pending",
      };
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      const isRetryable = 
        error.response?.status >= 500 || // Server errors
        error.response?.status === 429 || // Rate limiting
        error.code === "ETIMEDOUT" ||
        error.code === "ECONNRESET" ||
        error.code === "ECONNREFUSED" ||
        (error.response?.data?.error?.includes("time limit") || 
         error.response?.data?.error?.includes("timeout") ||
         error.response?.data?.error?.includes("MaxTimeMSExpired"));

              // If it's the last attempt or not retryable, break and handle error
              if (attempt === maxRetries || !isRetryable) {
                console.log(`🛑 [RedTrack] Stopping retries - ${attempt === maxRetries ? 'max attempts reached' : 'error is not retryable'}`);
                break;
              }

              console.warn(`⚠️  [RedTrack] Registration attempt ${attempt} failed (retryable): ${error.message}`);
              if (error.response) {
                console.warn(`⚠️  [RedTrack] Error response:`, JSON.stringify(error.response.data, null, 2));
              }
    }
  }

  // All retries exhausted or non-retryable error
  if (!lastError) {
    // This shouldn't happen, but handle it gracefully
    console.error("❌ [RedTrack] Registration failed with unknown error after retries.");
    return {
      domainId: null,
      trackingDomain,
      status: "skipped",
      reason: "Unknown error - no error captured",
    };
  }

  const error = lastError;
  console.error(`❌ [RedTrack] All retries exhausted (${maxRetries} attempts). Final error:`, error.message);

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

    // Make RedTrack registration non-fatal - return skipped status instead of throwing
    // Common reasons: RedTrack API timeout, database issues on their end, domain already exists
    console.warn(
      `⚠️  RedTrack registration failed (non-fatal): ${errorMessage}`
    );
    console.warn(
      `⚠️  Domain will be created successfully, but RedTrack registration will need to be done manually`
    );

    return {
      domainId: null,
      trackingDomain,
      status: "skipped",
      reason: errorMessage,
    };
  }

  // For non-HTTP errors (network issues, etc.)
  console.warn(
    `⚠️  RedTrack registration failed (non-fatal): ${error.message}`
  );
  return {
    domainId: null,
    trackingDomain,
    status: "skipped",
    reason: error.message,
  };
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
 * Classify a traffic channel (source) by naming prefix.
 * GG - = Google, FB - = Facebook, everything else = other.
 * @param {string} title - Channel title from RedTrack
 * @returns {"google"|"facebook"|"other"}
 */
function getTrafficChannelPlatform(title) {
  const name = String(title || "").trim();
  if (/^GG\s*-/i.test(name)) return "google";
  if (/^FB\s*-/i.test(name)) return "facebook";
  return "other";
}

/**
 * Fetch all traffic sources (RedTrack UI: "traffic channels") with pagination.
 * @param {object} [options]
 * @param {number} [options.per=100] - Page size
 * @returns {Promise<object[]>}
 */
async function getAllTrafficSources({ per = 100 } = {}) {
  const sources = [];
  let page = 1;

  while (true) {
    const res = await client.get("/sources", { params: { page, per } });
    const batch = Array.isArray(res.data)
      ? res.data
      : res.data?.items || [];

    if (!batch.length) break;

    sources.push(...batch);
    if (batch.length < per) break;
    page += 1;
  }

  return sources;
}

/**
 * Group traffic sources by platform using GG / FB title prefixes.
 * @param {object[]} sources
 * @returns {{ google: object[], facebook: object[], other: object[], counts: object }}
 */
function groupTrafficSourcesByPlatform(sources) {
  const grouped = { google: [], facebook: [], other: [] };

  for (const source of sources) {
    const platform = getTrafficChannelPlatform(source.title);
    grouped[platform].push(source);
  }

  return {
    ...grouped,
    counts: {
      total: sources.length,
      google: grouped.google.length,
      facebook: grouped.facebook.length,
      other: grouped.other.length,
    },
  };
}

/**
 * Fetch all traffic channels and group by GG (Google) vs FB (Facebook).
 * @returns {Promise<{ google: object[], facebook: object[], other: object[], counts: object }>}
 */
async function getGroupedTrafficChannels() {
  const sources = await getAllTrafficSources();
  return groupTrafficSourcesByPlatform(sources);
}

/**
 * @param {object} sub
 * @param {object} templateSub
 * @returns {object}
 */
function normalizeSubAgainstTemplate(sub, templateSub) {
  const normalized = {};
  for (const key of ["value", "hint", "role", "alias"]) {
    if (key in templateSub) {
      normalized[key] = sub?.[key] ?? "";
    }
  }
  return normalized;
}

/**
 * Deep-clone the template subs for writing to RedTrack.
 * @param {object[]} template
 * @returns {object[]}
 */
function cloneSubsTemplate(template) {
  return template.map((entry) => ({ ...entry }));
}

/**
 * @param {object} sub
 * @param {object} templateSub
 * @returns {boolean}
 */
function subMatchesTemplate(sub, templateSub) {
  for (const key of ["value", "hint", "role", "alias"]) {
    if (key in templateSub) {
      if ((sub?.[key] ?? "") !== templateSub[key]) {
        return false;
      }
    } else if (sub?.[key] !== undefined && sub[key] !== "") {
      return false;
    }
  }
  return true;
}

/**
 * True when current subs match the template exactly (index, fields, values).
 * @param {object[]|undefined} current
 * @param {object[]} template
 * @returns {boolean}
 */
function subsMatchTemplate(current, template) {
  if (!Array.isArray(current) || current.length !== template.length) {
    return false;
  }
  for (let i = 0; i < template.length; i++) {
    if (!subMatchesTemplate(current[i], template[i])) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} sourceId
 * @returns {Promise<object>}
 */
async function getTrafficSourceById(sourceId) {
  const res = await client.get(`/sources/${sourceId}`);
  return res.data;
}

/**
 * @param {string} sourceId
 * @param {object} sourceData - Full source payload (GET + edits)
 * @returns {Promise<object>}
 */
async function updateTrafficSource(sourceId, sourceData) {
  const payload = { ...sourceData, id: sourceData.id || sourceId };
  delete payload.stat;

  const res = await client.put(`/sources/${sourceId}`, payload);
  return res.data;
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
  getTrafficChannelPlatform,
  getAllTrafficSources,
  groupTrafficSourcesByPlatform,
  getGroupedTrafficChannels,
  normalizeSubAgainstTemplate,
  subMatchesTemplate,
  cloneSubsTemplate,
  subsMatchTemplate,
  getTrafficSourceById,
  updateTrafficSource,
  testAPIKey,
};
