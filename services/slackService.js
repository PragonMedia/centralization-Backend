const axios = require("axios");

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send a message to Slack
 * @param {string} message - Message to send to Slack
 */
async function sendSlackMessage(message) {
  if (!SLACK_WEBHOOK_URL) {
    console.warn("⚠️ SLACK_WEBHOOK_URL not set, skipping Slack notification");
    return;
  }
  try {
    await axios.post(SLACK_WEBHOOK_URL, {
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

module.exports = {
  sendSlackMessage,
};

