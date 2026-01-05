// Service for monitoring PHP-FPM worker usage
const { execSync } = require("child_process");

/**
 * Get PHP-FPM worker statistics
 * @returns {Promise<{active: number, idle: number, max: number, usagePercent: number, status: string}>}
 */
async function getPhpFpmStats() {
  try {
    // Get PHP-FPM status using systemctl
    const statusOutput = execSync("systemctl status php8.4-fpm", {
      encoding: "utf8",
      stdio: "pipe",
    });

    // Parse the status line (e.g., "Processes active: 8, idle: 11, Requests: 9656, slow: 0")
    const statusMatch = statusOutput.match(
      /Processes active: (\d+), idle: (\d+), Requests: (\d+), slow: (\d+)/
    );

    if (!statusMatch) {
      throw new Error("Could not parse PHP-FPM status");
    }

    const active = parseInt(statusMatch[1], 10);
    const idle = parseInt(statusMatch[2], 10);
    const total = active + idle;

    // Get max_children from config
    const configOutput = execSync(
      "grep 'pm.max_children' /etc/php/8.4/fpm/pool.d/www.conf | grep -v '^;' | tail -1",
      { encoding: "utf8", stdio: "pipe" }
    );

    const maxMatch = configOutput.match(/pm\.max_children\s*=\s*(\d+)/);
    const max = maxMatch ? parseInt(maxMatch[1], 10) : 300; // Default to 300 if not found

    const usagePercent = max > 0 ? Math.round((total / max) * 100) : 0;

    // Determine status
    let status = "healthy";
    if (usagePercent >= 90) {
      status = "critical";
    } else if (usagePercent >= 75) {
      status = "warning";
    } else if (usagePercent >= 50) {
      status = "moderate";
    }

    return {
      active,
      idle,
      total,
      max,
      usagePercent,
      status,
      requests: parseInt(statusMatch[3], 10),
      slowRequests: parseInt(statusMatch[4], 10),
    };
  } catch (error) {
    throw new Error(`Failed to get PHP-FPM stats: ${error.message}`);
  }
}

/**
 * Send Slack notification about PHP-FPM worker usage
 * @param {Object} stats - PHP-FPM statistics
 * @param {string} webhookUrl - Slack webhook URL
 */
async function sendSlackNotification(stats, webhookUrl) {
  if (!webhookUrl) {
    return; // No webhook configured, skip notification
  }

  try {
    const axios = require("axios");

    const emoji =
      stats.status === "critical"
        ? "🔴"
        : stats.status === "warning"
        ? "🟡"
        : stats.status === "moderate"
        ? "🟠"
        : "🟢";

    const message = {
      text: `${emoji} PHP-FPM Worker Usage Alert`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${emoji} PHP-FPM Worker Usage: ${stats.status.toUpperCase()}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Active Workers:*\n${stats.active}`,
            },
            {
              type: "mrkdwn",
              text: `*Idle Workers:*\n${stats.idle}`,
            },
            {
              type: "mrkdwn",
              text: `*Total Workers:*\n${stats.total} / ${stats.max}`,
            },
            {
              type: "mrkdwn",
              text: `*Usage:*\n${stats.usagePercent}%`,
            },
          ],
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Total Requests:*\n${stats.requests.toLocaleString()}`,
            },
            {
              type: "mrkdwn",
              text: `*Slow Requests:*\n${stats.slowRequests}`,
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `⚠️ Consider increasing \`pm.max_children\` if usage consistently exceeds 75%`,
            },
          ],
        },
      ],
    };

    await axios.post(webhookUrl, message);
  } catch (error) {
    console.error("Failed to send Slack notification:", error.message);
    // Don't throw - notification failure shouldn't break the monitoring
  }
}

module.exports = {
  getPhpFpmStats,
  sendSlackNotification,
};

