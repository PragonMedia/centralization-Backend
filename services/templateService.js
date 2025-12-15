// services/templateService.js
const axios = require("axios");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

/**
 * Validate template exists on Ubuntu server
 * Templates are served directly from /var/www/templates/{template}/ via nginx alias
 * No copying needed - single source of truth architecture
 * @param {string} template - Template name (e.g., "cb-groc", "ms-ss")
 * @returns {Promise<object>} Validation status
 */
async function validateTemplate(template) {
  try {
    // Skip if INTERNAL_SERVER_URL is not configured or points to localhost
    const internalUrl = (CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL || "").trim();
    const isLocalhost =
      !internalUrl ||
      internalUrl.includes("localhost") ||
      internalUrl.includes("127.0.0.1") ||
      internalUrl.includes("::1") ||
      internalUrl === "http://localhost:3000" ||
      internalUrl === "http://127.0.0.1:3000" ||
      internalUrl.startsWith("http://localhost") ||
      internalUrl.startsWith("http://127.0.0.1");

    if (isLocalhost) {
      console.log(
        `ℹ️  Skipping template validation (INTERNAL_SERVER_URL points to localhost: ${internalUrl || "not set"})`
      );
      return { success: true, skipped: true, reason: "localhost" };
    }

    console.log(`🔍 Validating template "${template}" exists...`);

    // Send request to Ubuntu server to validate template exists
    const response = await axios.get(
      `${CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL}/api/v1/template/validate`,
      {
        params: { template },
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.INTERNAL_API_TOKEN}`,
        },
        timeout: 10000,
      }
    );

    if (response.data.success) {
      console.log(`✅ Template "${template}" validated`);
      return { success: true };
    } else {
      console.warn(
        `⚠️  Template validation failed: ${response.data.error || "Unknown error"}`
      );
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    // Make template validation non-fatal - log warning but don't block route creation
    console.warn(
      `⚠️  Template validation failed for "${template}" (non-fatal): ${error.message}`
    );
    return { success: false, skipped: true, error: error.message };
  }
}

/**
 * Get list of available templates from Ubuntu server
 * @returns {Promise<array>} Array of template names
 */
async function getAvailableTemplates() {
  try {
    const internalUrl = (CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL || "").trim();
    const isLocalhost =
      !internalUrl ||
      internalUrl.includes("localhost") ||
      internalUrl.includes("127.0.0.1");

    if (isLocalhost) {
      return { success: false, templates: [], reason: "localhost" };
    }

    const response = await axios.get(
      `${CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL}/api/v1/template/list`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_CONFIG.INTERNAL_API_TOKEN}`,
        },
        timeout: 10000,
      }
    );

    if (response.data.success) {
      return { success: true, templates: response.data.templates || [] };
    }

    return { success: false, templates: [] };
  } catch (error) {
    console.warn(`⚠️  Failed to get template list: ${error.message}`);
    return { success: false, templates: [] };
  }
}

module.exports = { validateTemplate, getAvailableTemplates };

