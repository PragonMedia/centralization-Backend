// services/dynamicRoutes.js
const axios = require("axios");
const { getRoutesFromDatabase } = require("./routeService"); // keep your service
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

function buildDomainFragment(record) {
  const domain = record.domain;
  const routes = record.routes || [];

  // Helper: generate route blocks using alias to point to template directories
  const routeBlocks = routes
    .map(({ route, template }) => {
      if (!route || !template) return "";

      const templateRoot = `/var/www/templates/${template}`;

      return `
    # ===============================
    # ROUTE: /${route}
    # TEMPLATE: ${template}
    # ===============================

    location /${route}/ {
        alias ${templateRoot}/;
        index index.php index.html;
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ ^/${route}/(.+\\.php)$ {
        alias ${templateRoot}/;
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME ${templateRoot}/$1;
    }
`;
    })
    .join("\n");

  // Use Cloudflare Universal SSL - only HTTP needed (Cloudflare handles HTTPS)
  // Configs are written to /etc/nginx/dynamic/ and included automatically
  return `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};

    # Root not used for landing pages, only safety fallback
    root /var/www/${domain};
    index index.php index.html;

    # MAIN ROOT (optional)
    location / {
        try_files $uri $uri/ =404;
    }

    ${routeBlocks}

    # Block hidden files
    location ~ /\\.ht {
        deny all;
    }
}
`;
}

/**
 * Send nginx fragment to Ubuntu server for writing and reloading.
 * If domainRecord is omitted, sends fragments for all domains.
 *
 * This function runs on Windows backend and sends HTTP requests to the Ubuntu server
 * which actually writes the files and reloads nginx.
 */
async function generateNginxConfig(domainRecord = null) {
  // TEMPORARILY DISABLED: Skip nginx config entirely to prevent connection errors
  // This will be re-enabled once the nginx endpoint is properly configured
  console.log(`ℹ️  Nginx config generation is temporarily disabled`);
  return { success: true, skipped: true, reason: "Temporarily disabled" };

  /* DISABLED CODE - Re-enable when nginx endpoint is ready
  try {
    // If a specific domainRecord is passed, send only that fragment.
    // Otherwise fetch all records and send fragments for each.
    const domainRecords = domainRecord
      ? [domainRecord]
      : await getRoutesFromDatabase();

    // Skip nginx config if INTERNAL_SERVER_URL is not configured or points to localhost
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
      console.log(`ℹ️  Skipping nginx config (INTERNAL_SERVER_URL points to localhost: ${internalUrl || "not set"})`);
      return { success: true, skipped: true };
    }

    // Send each domain fragment to the Ubuntu server
    for (const record of domainRecords) {
      const fragment = buildDomainFragment(record);

      console.log(
        `🔄 Sending nginx fragment for ${record.domain} to Ubuntu server...`
      );

      try {
        // Send HTTP request to Ubuntu server's internal nginx endpoint
        const response = await axios.post(
          `${CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL}/api/v1/nginx/apply`,
          {
            domain: record.domain,
            fragment: fragment,
          },
          {
            headers: {
              Authorization: `Bearer ${CLOUDFLARE_CONFIG.INTERNAL_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 30000, // 30 second timeout
          }
        );

        if (response.data.success) {
          console.log(
            `✅ Nginx fragment applied for ${record.domain} on Ubuntu server`
          );
        } else {
          console.warn(
            `⚠️  Nginx config endpoint returned error: ${
              response.data.error || "Unknown error"
            }`
          );
        }
      } catch (axiosErr) {
        // Make nginx config non-fatal - log warning but don't block domain creation
        console.warn(`⚠️  Nginx config update failed for ${record.domain} (non-fatal): ${axiosErr.message}`);

        if (axiosErr.code === "ECONNREFUSED" || axiosErr.code === "ETIMEDOUT") {
          console.warn(
            `⚠️  Could not connect to nginx endpoint at ${CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL}. Domain creation will continue without nginx config update.`
          );
        }
        // Continue to next record - don't throw
      }
    }

    return { success: true };
  } catch (err) {
    // Ultimate safety net - never throw from this function
    console.warn(`⚠️  Nginx config generation encountered an error (non-fatal): ${err.message}`);
    return { success: true, warning: err.message };
  }
  */
}

module.exports = { generateNginxConfig, buildDomainFragment };
