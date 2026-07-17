const axios = require("axios");

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const DYNAMIC_RING_TREE_SLACK_WEBHOOK_URL =
  process.env.DYNAMIC_RING_TREE_SLACK_WEBHOOK_URL;

/**
 * Send a message to Slack
 * @param {string} message - Message to send to Slack
 * @param {{ webhookUrl?: string }} [options] - Optional override webhook URL
 */
async function sendSlackMessage(message, options = {}) {
  const webhookUrl = options.webhookUrl || SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("⚠️ Slack webhook URL not set, skipping Slack notification");
    return;
  }
  try {
    await axios.post(webhookUrl, {
      text: message,
    });
    console.log("✅ Message sent to Slack:", message);
  } catch (error) {
    console.error(
      "❌ Error sending message to Slack:",
      error.response?.data || error.message
    );
  }
}

/**
 * Ring-tree alerts go to DYNAMIC_RING_TREE_SLACK_WEBHOOK_URL when set,
 * otherwise fall back to the default SLACK_WEBHOOK_URL.
 */
async function sendRingTreeSlackMessage(message) {
  return sendSlackMessage(message, {
    webhookUrl: DYNAMIC_RING_TREE_SLACK_WEBHOOK_URL || SLACK_WEBHOOK_URL,
  });
}

module.exports = {
  sendSlackMessage,
  sendRingTreeSlackMessage,
};
