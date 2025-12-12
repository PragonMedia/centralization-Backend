// services/dynamicRoutes.js
const axios = require("axios");
const { getRoutesFromDatabase } = require("./routeService"); // keep your service
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

function buildDomainFragment(record) {
  const domain = record.domain;
  const domainRoot = `/var/www/${domain}`;
  const hasSSL = record.sslStatus === "active";
  const routes = record.routes || [];

  // Helper: generate route blocks
  const routeBlocks = routes
    .map(({ route }) => {
      return `
    # /${route} SUBDIRECTORY
    location /${route}/ {
        root ${domainRoot};
        index index.php index.html;
        try_files $uri $uri/ /${route}/index.html =404;
    }

    # PHP for /${route}
    location ~ ^/${route}/(.+\\.php)$ {
        root ${domainRoot};
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME ${domainRoot}$uri;
    }
`;
    })
    .join("\n");

  if (hasSSL) {
    return `
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain} www.${domain};
    root ${domainRoot};
    index index.php index.html;

    ${routeBlocks}

    # GENERAL PHP fallback
    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME ${domainRoot}$uri;
    }

    # Let's Encrypt / ACME
    location ^~ /.well-known/acme-challenge/ {
        alias /var/www/acme/.well-known/acme-challenge/;
        try_files $uri =404;
    }

    # deny dotfiles
    location ~ /\\. { deny all; }

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    # avoid external include dependency - but prefer certbot's options if present
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# HTTP -> HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};
    return 301 https://$host$request_uri;
}
`;
  } else {
    return `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};
    root ${domainRoot};
    index index.php index.html;

    # ACME challenge (webroot)
    location ^~ /.well-known/acme-challenge/ {
        alias /var/www/acme/.well-known/acme-challenge/;
        try_files $uri =404;
    }

    ${routeBlocks}

    # GENERAL PHP fallback
    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME ${domainRoot}$uri;
    }

    # deny dotfiles
    location ~ /\\. { deny all; }
}
`;
  }
}

/**
 * Send nginx fragment to Ubuntu server for writing and reloading.
 * If domainRecord is omitted, sends fragments for all domains.
 *
 * This function runs on Windows backend and sends HTTP requests to the Ubuntu server
 * which actually writes the files and reloads nginx.
 */
async function generateNginxConfig(domainRecord = null) {
  // If a specific domainRecord is passed, send only that fragment.
  // Otherwise fetch all records and send fragments for each.
  const domainRecords = domainRecord
    ? [domainRecord]
    : await getRoutesFromDatabase();

  try {
    // Send each domain fragment to the Ubuntu server
    for (const record of domainRecords) {
      const fragment = buildDomainFragment(record);

      console.log(
        `🔄 Sending nginx fragment for ${record.domain} to Ubuntu server...`
      );

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
        throw new Error(
          `Failed to apply nginx config: ${
            response.data.error || "Unknown error"
          }`
        );
      }
    }

    return { success: true };
  } catch (err) {
    console.error("❌ generateNginxConfig failed:", err.message);

    // Provide more detailed error information
    if (err.response) {
      console.error("Ubuntu server response:", err.response.data);
      throw new Error(
        `Failed to apply nginx config on Ubuntu server: ${
          err.response.data?.error || err.message
        }`
      );
    }

    throw err;
  }
}

module.exports = { generateNginxConfig, buildDomainFragment };
