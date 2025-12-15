// services/dynamicRoutes.js
const axios = require("axios");
const fs = require("fs");
const { execSync } = require("child_process");
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
      // Running on Ubuntu server - write nginx config files directly
      console.log(
        `📝 Writing nginx config directly (running on server, INTERNAL_SERVER_URL: ${
          internalUrl || "not set"
        })`
      );
      
      // Ensure dynamic directory exists
      const dynamicDir = "/etc/nginx/dynamic";
      try {
        if (!fs.existsSync(dynamicDir)) {
          execSync(`sudo mkdir -p ${dynamicDir}`, { stdio: "inherit" });
          console.log(`✅ Created directory: ${dynamicDir}`);
        }
      } catch (err) {
        console.warn(`⚠️  Could not create ${dynamicDir}: ${err.message}`);
      }

      // Write each domain's config file
      for (const record of domainRecords) {
        const fragment = buildDomainFragment(record);
        const configPath = `${dynamicDir}/${record.domain}.conf`;
        
        try {
          // Write config file (requires sudo, so we'll use execSync)
          const tempFile = `/tmp/nginx_${record.domain}_${Date.now()}.conf`;
          fs.writeFileSync(tempFile, fragment, "utf8");
          
          // Move to final location with sudo
          execSync(`sudo mv ${tempFile} ${configPath}`, { stdio: "inherit" });
          execSync(`sudo chmod 644 ${configPath}`, { stdio: "inherit" });
          
          console.log(`✅ Written nginx config: ${configPath}`);
        } catch (err) {
          console.error(`❌ Failed to write nginx config for ${record.domain}: ${err.message}`);
          // Log the config for manual application
          console.log(`\n📝 Generated nginx config for ${record.domain} (manual application needed):`);
          console.log(`\n${fragment}\n`);
        }
      }

      // Test and reload nginx
      try {
        console.log(`🧪 Testing nginx configuration...`);
        execSync("sudo nginx -t", { stdio: "inherit" });
        console.log(`🔄 Reloading nginx...`);
        execSync("sudo systemctl reload nginx", { stdio: "inherit" });
        console.log(`✅ Nginx reloaded successfully`);
      } catch (err) {
        console.error(`❌ Nginx test/reload failed: ${err.message}`);
        console.log(`💡 Please manually test and reload: sudo nginx -t && sudo systemctl reload nginx`);
      }

      return { success: true };
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
          // Log config for manual application
          console.log(
            `\n📝 Generated nginx config for ${record.domain} (manual application needed):`
          );
          console.log(`\n${fragment}\n`);
        }
      } catch (axiosErr) {
        // Make nginx config non-fatal - log warning but don't block route creation
        console.warn(
          `⚠️  Nginx config update failed for ${record.domain} (non-fatal): ${axiosErr.message}`
        );

        if (axiosErr.code === "ECONNREFUSED" || axiosErr.code === "ETIMEDOUT") {
          console.warn(
            `⚠️  Could not connect to nginx endpoint at ${CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL}.`
          );
          console.warn(
            `⚠️  Domain creation will continue, but nginx config needs to be applied manually.`
          );
        }

        // Log the generated config for manual application
        console.log(
          `\n📝 Generated nginx config for ${record.domain} (manual application needed):`
        );
        console.log(`\n${fragment}\n`);
        console.log(`💡 To apply manually:`);
        console.log(
          `   1. Write config to: /etc/nginx/dynamic/${record.domain}.conf`
        );
        console.log(`   2. Test config: sudo nginx -t`);
        console.log(`   3. Reload nginx: sudo systemctl reload nginx\n`);

        // Continue to next record - don't throw
      }
    }

    return { success: true };
  } catch (err) {
    // Ultimate safety net - never throw from this function
    console.warn(
      `⚠️  Nginx config generation encountered an error (non-fatal): ${err.message}`
    );
    return { success: true, warning: err.message };
  }
}

module.exports = { generateNginxConfig, buildDomainFragment };
