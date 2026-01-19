const { GoogleAuth } = require("google-auth-library");
const { readFileSync } = require("fs");
const { join } = require("path");
const axios = require("axios");

// CM360 API Configuration
const CM360_USER_PROFILE_ID = "10697326";
const CM360_BASE_URL = "https://dfareporting.googleapis.com/dfareporting/v5";
const CM360_BATCH_INSERT_URL = `${CM360_BASE_URL}/userprofiles/${CM360_USER_PROFILE_ID}/conversions/batchinsert`;

// Initialize Google Auth (singleton pattern - reuse the same auth client)
let authClient = null;

/**
 * Initialize and get Google Auth client
 * Reuses the same client for all requests (singleton pattern)
 */
async function getAuthClient() {
  if (authClient) {
    return authClient;
  }

  try {
    const credentialsPath = join(__dirname, "..", "credentials.json");
    const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));

    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: [
        "https://www.googleapis.com/auth/dfatrafficking",
        "https://www.googleapis.com/auth/ddmconversions", // Required for batchinsert conversions
      ],
    });

    authClient = await auth.getClient();
    console.log("✅ Google Auth client initialized successfully");
    return authClient;
  } catch (error) {
    console.error("❌ Failed to initialize Google Auth:", error.message);
    throw new Error(`Google authentication failed: ${error.message}`);
  }
}

/**
 * Send conversions to CM360 using batchinsert API
 * @param {Array} conversions - Array of conversion objects from Ringba
 * @returns {Promise<Object>} CM360 API response
 */
/**
 * Clean conversion object - remove empty user identifier fields and convert timestamp
 * CM360 requires only ONE user identifier (mutually exclusive)
 * @param {Object} conversion - Conversion object
 * @returns {Object} Cleaned conversion object
 */
function cleanConversion(conversion) {
  const cleaned = { ...conversion };

  // Convert timestampMicros from seconds to microseconds
  // Ringba sends timestamps in epoch seconds (e.g., 1768848703)
  // CM360 requires microseconds (e.g., 1768848703000000)
  if (cleaned.timestampMicros && typeof cleaned.timestampMicros === "string") {
    const timestampSeconds = parseInt(cleaned.timestampMicros.trim(), 10);
    if (!isNaN(timestampSeconds)) {
      // Convert seconds to microseconds by multiplying by 1,000,000 (or adding 6 zeros)
      cleaned.timestampMicros = String(timestampSeconds * 1000000);
    }
  }

  // List of mutually exclusive user identifier fields
  const userIdentifierFields = [
    "encryptedUserId",
    "encryptedUserIdCandidates",
    "matchId",
    "mobileDeviceId",
    "gclid",
    "dclid",
    "impressionId",
  ];

  // Remove empty string user identifiers (CM360 treats empty string as a value)
  // Only keep the one that has a non-empty value
  let hasUserIdentifier = false;
  for (const field of userIdentifierFields) {
    if (cleaned[field] && typeof cleaned[field] === "string" && cleaned[field].trim() !== "") {
      // Found a valid user identifier
      if (hasUserIdentifier) {
        // Already found one - remove this duplicate
        delete cleaned[field];
      } else {
        // First valid identifier - keep it
        hasUserIdentifier = true;
      }
    } else {
      // Empty or invalid - remove it
      delete cleaned[field];
    }
  }

  return cleaned;
}

async function sendConversionsToCM360(conversions) {
  try {
    // Get authenticated client
    const client = await getAuthClient();

    // Clean conversions - remove empty user identifier fields
    const cleanedConversions = conversions.map(cleanConversion);

    // Prepare request body
    const requestBody = {
      conversions: cleanedConversions,
    };

    // Get access token
    const accessToken = await client.getAccessToken();

    // Validate access token
    if (!accessToken || !accessToken.token) {
      throw new Error("Failed to obtain access token from Google Auth");
    }

    // Make request to CM360 API
    const response = await axios.post(CM360_BATCH_INSERT_URL, requestBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken.token}`,
      },
    });

    console.log("✅ CM360 API success:", {
      status: response.status,
      conversionsSent: conversions.length,
    });

    return response.data;
  } catch (error) {
    // Handle axios errors
    if (error.response) {
      // CM360 API returned an error response
      console.error("❌ CM360 API error:", {
        status: error.response.status,
        statusText: error.response.statusText,
        error: error.response.data,
      });
      throw new Error(
        `CM360 API error: ${error.response.status} ${
          error.response.statusText
        } - ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      // Request was made but no response received
      console.error("❌ CM360 API network error:", error.message);
      throw new Error(`CM360 API network error: ${error.message}`);
    } else {
      // Error setting up the request
      console.error("❌ Failed to send conversions to CM360:", error.message);
      throw error;
    }
  }
}

module.exports = {
  sendConversionsToCM360,
  getAuthClient,
};
