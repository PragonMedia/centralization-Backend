/**
 * Roku Conversions API (CAPI) - server-to-server conversion events
 * POST https://events.ads.rokuapi.net/v1/events
 * Docs: https://help.ads.roku.com/en/articles/8880744-conversions-api
 */

const crypto = require("crypto");
const axios = require("axios");
const ROKU_CONFIG = require("../config/roku");

/**
 * Normalize raw phone for Roku before hashing (per Roku docs)
 * Remove all special characters including '+' or '-', leading zeros, trim whitespace
 */
function normalizePhone(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim();
  s = s.replace(/[\s+\-().]/g, "");
  s = s.replace(/^0+/, "");
  return s;
}

/**
 * SHA-256 hash of normalized phone (hex string)
 */
function sha256Hash(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

/**
 * Get event_time in UNIX epoch seconds from Ringba timestampMicros
 */
function timestampMicrosToEpochSeconds(timestampMicros) {
  if (timestampMicros == null || timestampMicros === "") return Math.floor(Date.now() / 1000);
  const str = String(timestampMicros).trim();
  const num = parseInt(str, 10);
  if (!Number.isFinite(num)) return Math.floor(Date.now() / 1000);
  // If small (seconds), use as-is; else assume microseconds -> seconds
  return num < 1e12 ? num : Math.floor(num / 1e6);
}

/**
 * Build one Roku event from Ringba conversion (no dclid path)
 * event_group_id from Ringba (conversion or defaultEventGroupId fallback).
 * event_time = server time (Date.now() → epoch seconds). No timestampMicros required from Ringba.
 * No event_id sent to Roku. Raw phone hashed as user_data.ph.
 */
function buildRokuEvent(conversion, options = {}) {
  const eventGroupId =
    conversion.event_group_id ??
    conversion.eventGroupId ??
    options.defaultEventGroupId ??
    "";
  const rawPhone =
    conversion.phone ??
    conversion.caller_phone ??
    conversion.callerPhone ??
    conversion.callerPhoneNumber ??
    "";
  const normalizedPhone = normalizePhone(rawPhone);
  const hashedPhone = normalizedPhone ? sha256Hash(normalizedPhone) : "";

  const eventTime = Math.floor(Date.now() / 1000);

  return {
    event_group_id: eventGroupId,
    events: [
      {
        event_name: "LEAD",
        event_source: "phone_call",
        event_time: eventTime,
        event_type: "conversion",
        user_data: {
          ph: hashedPhone,
        },
      },
    ],
  };
}

/**
 * Send one or more conversions to Roku CAPI (no-dclid conversions only)
 * API key comes from Ringba per conversion (roku_api_key / rokuApiKey) - each ad account has its own key.
 * event_group_id from Ringba (per conversion or body default).
 * @param {Array<Object>} conversions - Ringba conversion objects (without dclid)
 * @param {{ defaultEventGroupId?: string }} options - optional body-level event_group_id from Ringba
 * @returns {Promise<Array<{ conversion, response?, error? }>>}
 */
async function sendConversionsToRoku(conversions, options = {}) {
  const url = ROKU_CONFIG.CAPI_EVENTS_URL;
  const results = [];

  for (const conversion of conversions) {
    const apiKey =
      conversion.roku_api_key ?? conversion.rokuApiKey ?? "";
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      console.error("❌ Roku CAPI: missing roku_api_key on conversion (from Ringba)");
      results.push({ conversion, error: "roku_api_key is required from Ringba" });
      continue;
    }

    try {
      const payload = buildRokuEvent(conversion, {
        defaultEventGroupId: options.defaultEventGroupId,
      });
      const response = await axios.post(url, payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
      });
      results.push({ conversion, response: response.data });
      console.log("✅ Roku CAPI success:", {
        event_group_id: payload.event_group_id,
        code: response.data?.code,
      });
    } catch (error) {
      const errMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      console.error("❌ Roku CAPI error:", errMsg);
      results.push({ conversion, error: errMsg });
    }
  }

  return results;
}

module.exports = {
  sendConversionsToRoku,
  buildRokuEvent,
  normalizePhone,
  timestampMicrosToEpochSeconds,
};
