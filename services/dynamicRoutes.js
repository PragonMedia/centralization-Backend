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

    # Redirect /${route} to /${route}/ (with trailing slash)
    location = /${route} {
        return 301 /${route}/;
    }

    location /${route}/ {
        alias ${templateRoot}/;
        index index.php index.html;
        try_files $uri $uri/ /${route}/index.html /${route}/index.php =404;
        
        # Debug header to verify route location is matched
        add_header X-Debug-Location "${route}-route" always;
        
        # Disable directory listings
        autoindex off;
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

  // Use Cloudflare Universal SSL - HTTP for Cloudflare proxy, HTTPS block to prevent other HTTPS blocks from matching
  // Configs are written to /etc/nginx/dynamic/ and included automatically
  return `
# HTTP server block (Cloudflare proxies HTTPS -> HTTP)
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};

    # Debug header to verify which server block is matched
    add_header X-Debug-Server "${domain}" always;

    # Root not used for landing pages, only safety fallback
    root /var/www/${domain};
    index index.php index.html;

    # Route blocks MUST come before root location to ensure proper matching
    ${routeBlocks}

    # GENERAL PHP fallback (catches PHP files not matched by route-specific blocks)
    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME /var/www/${domain}$uri;
    }

    # MAIN ROOT (only matches if no route matched above)
    # Return 404 - we don't allow viewing root or template directory listings
    location / {
        return 404;
    }

    # Block hidden files
    location ~ /\\.ht {
        deny all;
    }
}

# HTTPS server block - Redirect to HTTP (Cloudflare handles SSL and proxies HTTP)
# This prevents other HTTPS server blocks from matching this domain
# Note: If Cloudflare is in "Full" SSL mode, you may need to add SSL certificates here
server {
    listen 443;
    listen [::]:443;
    server_name ${domain} www.${domain};

    # Redirect HTTPS to HTTP (Cloudflare will handle SSL termination)
    # This prevents other HTTPS server blocks from matching
    return 301 http://$host$request_uri;
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
          console.log(`📝 Created temp file: ${tempFile}`);

          // Move to final location with sudo
          try {
            execSync(`sudo mv ${tempFile} ${configPath}`, {
              stdio: "inherit",
              encoding: "utf8",
            });
            execSync(`sudo chmod 644 ${configPath}`, {
              stdio: "inherit",
              encoding: "utf8",
            });
            console.log(`✅ Written nginx config: ${configPath}`);

            // Verify file was written
            if (fs.existsSync(configPath)) {
              const writtenContent = fs.readFileSync(configPath, "utf8");
              console.log(
                `✅ Verified: Config file exists (${writtenContent.length} bytes)`
              );
            } else {
              console.error(
                `❌ Config file does not exist after write: ${configPath}`
              );
            }
          } catch (execErr) {
            console.error(`❌ Failed to move config file: ${execErr.message}`);
            console.error(
              `❌ Command output: ${execErr.stdout || execErr.stderr || "none"}`
            );
            throw execErr;
          }
        } catch (err) {
          console.error(
            `❌ Failed to write nginx config for ${record.domain}: ${err.message}`
          );
          console.error(`❌ Error stack: ${err.stack}`);
          // Log the config for manual application
          console.log(
            `\n📝 Generated nginx config for ${record.domain} (manual application needed):`
          );
          console.log(`\n${fragment}\n`);
        }
      }

      // Test and reload nginx (only if at least one config was written)
      let configsWritten = 0;
      for (const record of domainRecords) {
        const configPath = `/etc/nginx/dynamic/${record.domain}.conf`;
        if (fs.existsSync(configPath)) {
          configsWritten++;
        }
      }

      if (configsWritten > 0) {
        try {
          console.log(`🧪 Testing nginx configuration...`);
          const testOutput = execSync("sudo nginx -t", {
            encoding: "utf8",
            stdio: "pipe",
          });
          console.log(`✅ Nginx config test passed`);
          console.log(`🔄 Reloading nginx...`);
          const reloadOutput = execSync("sudo systemctl reload nginx", {
            encoding: "utf8",
            stdio: "pipe",
          });
          console.log(`✅ Nginx reloaded successfully`);
        } catch (err) {
          console.error(`❌ Nginx test/reload failed: ${err.message}`);
          if (err.stdout) console.error(`stdout: ${err.stdout}`);
          if (err.stderr) console.error(`stderr: ${err.stderr}`);
          console.log(
            `💡 Please manually test and reload: sudo nginx -t && sudo systemctl reload nginx`
          );
        }
      } else {
        console.warn(`⚠️  No config files were written, skipping nginx reload`);
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
