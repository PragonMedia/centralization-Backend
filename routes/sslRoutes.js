const express = require("express");
const router = express.Router();
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

// Helper function to execute command on remote server via SSH
async function executeSSHCommand(command) {
  const { exec } = require("child_process");
  const util = require("util");
  const execPromise = util.promisify(exec);

  // Build SSH command
  let sshCommand;
  if (CLOUDFLARE_CONFIG.SSH_KEY_PATH) {
    // Use SSH key
    sshCommand = `ssh -i "${CLOUDFLARE_CONFIG.SSH_KEY_PATH}" -o StrictHostKeyChecking=no -p ${CLOUDFLARE_CONFIG.SSH_PORT} ${CLOUDFLARE_CONFIG.SSH_USER}@${CLOUDFLARE_CONFIG.SSH_HOST} "${command}"`;
  } else if (CLOUDFLARE_CONFIG.SSH_PASSWORD) {
    // Use password (requires sshpass - install with: apt-get install sshpass or brew install sshpass)
    sshCommand = `sshpass -p "${CLOUDFLARE_CONFIG.SSH_PASSWORD}" ssh -o StrictHostKeyChecking=no -p ${CLOUDFLARE_CONFIG.SSH_PORT} ${CLOUDFLARE_CONFIG.SSH_USER}@${CLOUDFLARE_CONFIG.SSH_HOST} "${command}"`;
  } else {
    // Try without password/key (will prompt or use default key)
    sshCommand = `ssh -o StrictHostKeyChecking=no -p ${CLOUDFLARE_CONFIG.SSH_PORT} ${CLOUDFLARE_CONFIG.SSH_USER}@${CLOUDFLARE_CONFIG.SSH_HOST} "${command}"`;
  }

  return await execPromise(sshCommand, {
    timeout: 300000, // 5 minutes
    maxBuffer: 1024 * 1024 * 10, // 10MB
  });
}

// Helper function to check if file exists on remote server
async function checkRemoteFileExists(filePath) {
  try {
    const command = `test -f "${filePath}" && echo "exists" || echo "not_exists"`;
    const { stdout } = await executeSSHCommand(command);
    return stdout.trim() === "exists";
  } catch (error) {
    return false;
  }
}

// Helper function to request SSL certificate
// Issues only root domain (no wildcard) - wildcards require DNS-01 validation
async function requestSSLCertificate(domain) {
  const fs = require("fs");
  const path = require("path");

  console.log(`📝 SSL certificate request initiated for ${domain}`);

  // Check if SSH is configured
  if (!CLOUDFLARE_CONFIG.SSH_HOST) {
    return {
      success: false,
      domain,
      status: "error",
      message:
        "SSH_HOST not configured. Please set SSH_HOST or SERVER_IP in .env file",
    };
  }

  try {
    // 1) Check if certbot exists on remote server
    try {
      await executeSSHCommand("which certbot");
      console.log("✅ Certbot found on remote server");
    } catch (error) {
      console.log("ℹ️  Certbot not found on remote server.");
      return {
        success: false,
        domain,
        status: "error",
        message:
          "certbot not installed on remote server. Please install certbot on the server first.",
      };
    }

    const webrootPath = "/var/www/html"; // ⚠️ MUST match your nginx root

    // Check if webroot exists on remote server
    let useWebroot = false;
    try {
      const webrootExists = await checkRemoteFileExists(webrootPath);
      if (webrootExists) {
        useWebroot = true;
      }
    } catch (error) {
      console.log(`⚠️  Could not check webroot path, using standalone mode`);
    }

    let certbotCommand;
    if (useWebroot) {
      console.log(`📁 Using webroot mode: ${webrootPath}`);
      // Request certificate for both domain and www.domain (like certbot --nginx does)
      certbotCommand =
        `certbot certonly ` +
        `--webroot --non-interactive --agree-tos ` +
        `--email admin@${domain} ` +
        `-w ${webrootPath} ` +
        `-d ${domain} ` +
        `-d www.${domain}`;
    } else {
      console.log("🌐 Using standalone mode (port 80 must be free)");
      // Request certificate for both domain and www.domain (like certbot --nginx does)
      certbotCommand =
        `certbot certonly ` +
        `--standalone --non-interactive --agree-tos ` +
        `--email admin@${domain} ` +
        `-d ${domain} ` +
        `-d www.${domain}`;
    }

    console.log(`🔧 Executing certbot on remote server: ${certbotCommand}`);

    try {
      const { stdout, stderr } = await executeSSHCommand(certbotCommand);

      console.log("✅ Certbot output:", stdout);
      if (stderr && !stderr.includes("Saving debug log")) {
        console.warn("⚠️  Certbot warnings:", stderr);
      }

      const certDir = `/etc/letsencrypt/live/${domain}`;
      const fullchainPath = `${certDir}/fullchain.pem`;
      const privkeyPath = `${certDir}/privkey.pem`;

      // Check if certificate files exist on remote server
      const fullchainExists = await checkRemoteFileExists(fullchainPath);
      const privkeyExists = await checkRemoteFileExists(privkeyPath);

      if (fullchainExists && privkeyExists) {
        console.log(
          `✅ Certificate files found on remote server for ${domain}`
        );
        return {
          success: true,
          domain,
          status: "active",
          message: "Let's Encrypt certificate issued successfully",
          fullchainPath,
          privkeyPath,
        };
      } else {
        console.warn(
          `⚠️ Certbot finished but cert files not found on remote server for ${domain}`
        );
        return {
          success: false,
          domain,
          status: "error",
          message:
            "Certbot ran but certificate files not found on remote server",
        };
      }
    } catch (certbotError) {
      console.error("❌ Certbot command failed:", certbotError.message);

      if (
        certbotError.stderr?.includes("rate limit") ||
        certbotError.stdout?.includes("rate limit")
      ) {
        return {
          success: false,
          domain,
          status: "error",
          message: "Let's Encrypt rate limit exceeded. Try again later.",
        };
      }

      if (
        certbotError.stderr?.includes("Certificate not yet due for renewal") ||
        certbotError.stdout?.includes("Certificate not yet due for renewal")
      ) {
        console.log("ℹ️  Certificate already exists and is valid.");
        return {
          success: true,
          domain,
          status: "active",
          message: "Certificate already exists and is valid",
        };
      }

      return {
        success: false,
        domain,
        status: "error",
        message: certbotError.stderr || certbotError.message,
      };
    }
  } catch (error) {
    console.error("❌ Error requesting SSL certificate:", error);
    return {
      success: false,
      domain,
      status: "error",
      message: error.message,
    };
  }
}

// Helper function to check certificate status
// Simplified: checks local files first, then HTTPS probe
async function checkCertificateStatus(domain) {
  const https = require("https");
  const fs = require("fs");
  const path = require("path");

  // Method 1: just check if cert files exist
  const certDir = `/etc/letsencrypt/live/${domain}`;
  const fullchainPath = path.join(certDir, "fullchain.pem");
  const privkeyPath = path.join(certDir, "privkey.pem");

  if (fs.existsSync(fullchainPath) && fs.existsSync(privkeyPath)) {
    // We still don't know if nginx is using them, so continue to HTTPS check
    console.log(`📁 Local cert files exist for ${domain}`);
  }

  // Method 2: HTTPS probe
  return await new Promise((resolve) => {
    const options = {
      hostname: domain,
      port: 443,
      method: "GET",
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      const cert = res.socket.getPeerCertificate();

      if (cert && cert.valid_to) {
        const expiresAt = new Date(cert.valid_to);
        const now = new Date();
        const expired = now > expiresAt;

        resolve({
          exists: true,
          expired,
          expiresAt: expiresAt.toISOString(),
          issuer: cert.issuer?.CN || "Unknown",
          source: "https",
        });
      } else {
        resolve({
          exists: false,
          expired: false,
          expiresAt: null,
          issuer: null,
          source: "https",
        });
      }
    });

    req.on("error", (error) => {
      resolve({
        exists: false,
        expired: false,
        expiresAt: null,
        issuer: null,
        source: "https",
        error: error.message,
      });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({
        exists: false,
        expired: false,
        expiresAt: null,
        issuer: null,
        source: "timeout",
      });
    });

    req.end();
  });
}

// POST /api/v1/ssl/request
router.post("/request", async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    const result = await requestSSLCertificate(domain);

    res.json(result);
  } catch (error) {
    console.error("Error requesting SSL certificate:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/ssl/status?domain={domain}
router.get("/status", async (req, res) => {
  try {
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    console.log(`🔍 Checking SSL status for ${domain}...`);

    // Check if certificate exists and is valid
    const certStatus = await checkCertificateStatus(domain);

    const isActive = certStatus.exists && !certStatus.expired;
    const status = certStatus.exists
      ? certStatus.expired
        ? "expired"
        : "active"
      : "pending";

    console.log(`📊 SSL Status for ${domain}:`, {
      status,
      active: isActive,
      exists: certStatus.exists,
      expired: certStatus.expired,
      source: certStatus.source,
      issuer: certStatus.issuer,
    });

    res.json({
      active: isActive,
      status,
      expiresAt: certStatus.expiresAt,
      issuer: certStatus.issuer,
      source: certStatus.source, // For debugging
    });
  } catch (error) {
    console.error("Error checking SSL status:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
