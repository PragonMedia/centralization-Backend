const axios = require("axios");
const { getCallerDataFromAudienceAcuity } = require("./rokuConversionService");

const JADE_INBOUND_URL = (
  process.env.JADE_INBOUND_URL ||
  process.env.JAKE_INBOUND_URL ||
  "http://100.54.74.64:8000/leads/inbound"
).trim();
const JADE_REQUEST_TIMEOUT_MS = Number(
  process.env.JADE_REQUEST_TIMEOUT_MS || process.env.JAKE_REQUEST_TIMEOUT_MS || 8000
);
const JADE_NETWORK_RETRY_COUNT = Number(
  process.env.JADE_NETWORK_RETRY_COUNT || process.env.JAKE_NETWORK_RETRY_COUNT || 2
);
const JADE_RETRY_BASE_DELAY_MS = Number(
  process.env.JADE_RETRY_BASE_DELAY_MS || process.env.JAKE_RETRY_BASE_DELAY_MS || 500
);
const JADE_BEARER_TOKEN = (process.env.JADE_BEARER_TOKEN || process.env.JAKE_BEARER_TOKEN || "").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRawPhone(conversion) {
  const raw =
    conversion?.phone ??
    conversion?.caller_phone ??
    conversion?.callerPhone ??
    conversion?.callerPhoneNumber ??
    conversion?.phone_home ??
    "";
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizePhoneHome(raw) {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function normalizeState(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

function normalizeZip(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  return s;
}

function calculateAgeFromDob(rawDob) {
  if (typeof rawDob !== "string") return null;
  const dob = rawDob.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;

  const birthDate = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - birthDate.getUTCMonth();
  const dayDelta = today.getUTCDate() - birthDate.getUTCDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1;
  }
  if (!Number.isInteger(age) || age < 0 || age > 120) return null;
  return age;
}

function isRetryableNetworkError(error) {
  if (!error || error.response) return false;

  const code = String(error.code || "").toUpperCase();
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ESOCKETTIMEDOUT",
    "EPIPE",
    "ENOTFOUND",
    "EAI_AGAIN",
  ]);
  if (retryableCodes.has(code)) return true;

  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("client network socket disconnected before secure tls connection was established") ||
    msg.includes("socket hang up") ||
    msg.includes("tls") ||
    msg.includes("network error")
  );
}

function shouldLogOutbound() {
  const jade = process.env.JADE_LOG_OUTBOUND;
  const jake = process.env.JAKE_LOG_OUTBOUND;
  if (jade === "0" || jake === "0") return false;
  return true;
}

async function postJadeLeadWithRetry(payload) {
  let attempt = 0;
  let lastError = null;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (JADE_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${JADE_BEARER_TOKEN}`;
  }

  while (attempt <= JADE_NETWORK_RETRY_COUNT) {
    try {
      return await axios.post(JADE_INBOUND_URL, payload, {
        headers,
        timeout: JADE_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      lastError = error;
      const shouldRetry = isRetryableNetworkError(error) && attempt < JADE_NETWORK_RETRY_COUNT;
      if (!shouldRetry) break;
      const delayMs = JADE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(delayMs);
      attempt += 1;
    }
  }

  if (isRetryableNetworkError(lastError)) {
    const wrapped = new Error(
      `[network_tls_error] Jade inbound transport failed after ${JADE_NETWORK_RETRY_COUNT + 1} attempt(s): ${lastError.message}`
    );
    wrapped.code = lastError.code;
    wrapped.cause = lastError;
    throw wrapped;
  }

  throw lastError;
}

async function sendConversionsToJade(conversions) {
  const results = [];

  for (const conversion of conversions) {
    let payload = null;
    try {
      const rawPhone = getRawPhone(conversion);
      const phoneHome = normalizePhoneHome(rawPhone);
      const callerData = await getCallerDataFromAudienceAcuity(conversion);

      const firstName = typeof callerData?.firstName === "string" ? callerData.firstName.trim() : "";
      const lastName = typeof callerData?.lastName === "string" ? callerData.lastName.trim() : "";
      const state = normalizeState(callerData?.state);
      const zipCode = normalizeZip(callerData?.zip);
      const age = calculateAgeFromDob(callerData?.dateOfBirth);

      payload = {
        first_name: firstName,
        last_name: lastName,
        phone_home: phoneHome,
        state,
        zip_code: zipCode,
        subid: "paragon",
        age,
      };

      const missingRequired =
        !payload.first_name ||
        !payload.last_name ||
        !payload.phone_home ||
        !payload.state ||
        !payload.zip_code ||
        !Number.isInteger(payload.age);

      if (missingRequired) {
        results.push({
          success: false,
          data: payload,
          failureReason: "missing_required_fields",
        });
        continue;
      }

      if (shouldLogOutbound()) {
        console.log("📤 Jade outbound POST", { url: JADE_INBOUND_URL, body: payload });
      }

      const jadeResponse = await postJadeLeadWithRetry(payload);
      results.push({
        success: true,
        data: payload,
        failureReason: null,
        jadeResponse: {
          status: jadeResponse?.status ?? null,
          data: jadeResponse?.data ?? null,
        },
      });
    } catch (error) {
      const responseData = error?.response?.data;
      const responseText =
        responseData == null
          ? null
          : typeof responseData === "string"
            ? responseData
            : JSON.stringify(responseData);
      results.push({
        success: false,
        data: payload,
        failureReason: responseText
          ? `${error?.message || "jade_send_failed"} | response: ${responseText}`
          : error?.message || "jade_send_failed",
        jadeResponse: {
          status: error?.response?.status ?? null,
          data: error?.response?.data ?? null,
        },
      });
    }
  }

  if (!Array.isArray(conversions) || conversions.length === 0) {
    return {
      success: false,
      data: {
        success: false,
        data: null,
        failureReason: "no_conversions_received",
        jadeResponse: {
          status: null,
          data: null,
        },
      },
    };
  }

  const overallSuccess = results.every((r) => r.success === true);
  return {
    success: overallSuccess,
    data: results.length === 1 ? results[0] : results,
  };
}

module.exports = {
  sendConversionsToJade,
  calculateAgeFromDob,
};
