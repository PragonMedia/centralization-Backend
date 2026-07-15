const axios = require("axios");
const fs = require("fs");
const path = require("path");

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VERSION = (process.env.GOOGLE_ADS_API_VERSION || "v22").trim();
const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

const GOOGLE_CUSTOMER_ID = "4316986825";
const GOOGLE_LOGIN_CUSTOMER_ID = "4316986825";
const GOOGLE_CONVERSION_VALUE = 1;
const GOOGLE_CURRENCY_CODE = "USD";
const GOOGLE_CONVERSION_LOG_FILE = path.join(
  __dirname,
  "..",
  "logs",
  "google-conversions.jsonl"
);

/** Total attempts for OAuth + upload (1 = no retry). Transient errors only. */
function getUploadMaxAttempts() {
  const parsed = parseInt(
    String(process.env.GOOGLE_ADS_UPLOAD_MAX_ATTEMPTS || "3").trim(),
    10
  );
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 5) : 3;
}

function getUploadRetryBaseMs() {
  const parsed = parseInt(
    String(process.env.GOOGLE_ADS_UPLOAD_RETRY_BASE_MS || "1000").trim(),
    10
  );
  return Number.isFinite(parsed) && parsed >= 100 ? parsed : 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Timeouts, network drops, and Google 429/5xx — safe to retry. */
function isTransientGoogleError(error) {
  if (!error) return false;
  const code = error.code;
  if (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "EPIPE"
  ) {
    return true;
  }
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("timeout")) return true;
  const status = error.response?.status;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isTruthyEnv(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function getValidateOnly() {
  return isTruthyEnv(process.env.GOOGLE_ADS_VALIDATE_ONLY);
}

function getDryRun() {
  return isTruthyEnv(process.env.GOOGLE_ADS_DRY_RUN);
}

function formatGoogleDateTime(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}+00:00`;
}

function pickClickId(payload = {}) {
  const gclid = typeof payload.gclid === "string" ? payload.gclid.trim() : "";
  if (gclid) return { clickIdType: "gclid", clickIdValue: gclid };

  const gbraid = typeof payload.gbraid === "string" ? payload.gbraid.trim() : "";
  if (gbraid) return { clickIdType: "gbraid", clickIdValue: gbraid };

  const wbraid = typeof payload.wbraid === "string" ? payload.wbraid.trim() : "";
  if (wbraid) return { clickIdType: "wbraid", clickIdValue: wbraid };

  return null;
}

function validateConversionActionId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return null;
  return normalized;
}

function resolveConversionDateTime(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return formatGoogleDateTime(new Date());
  return normalized;
}

function resolveConversionValue(payload = {}) {
  const candidates = [
    payload.conversion_value,
    payload.conversionValue,
    payload.payout,
    payload.value,
  ];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed =
      typeof candidate === "number" ? candidate : Number(String(candidate).trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return GOOGLE_CONVERSION_VALUE;
}

function resolveCurrencyCode(payload = {}) {
  const raw = payload.currency_code ?? payload.currencyCode ?? GOOGLE_CURRENCY_CODE;
  const normalized = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return normalized || GOOGLE_CURRENCY_CODE;
}

/** Ringba tracking id — echoed on errors only; never sent to Google. */
function resolveCallId(payload = {}) {
  const raw = payload.callID ?? payload.callId ?? payload.call_id ?? "";
  const normalized = typeof raw === "string" ? raw.trim() : String(raw || "").trim();
  return normalized || null;
}

function attachCallIdToErrorResult(result, callId) {
  if (!result || result.ok || !callId) return result;
  return { ...result, callID: callId };
}

function maskClickId(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

async function writeGoogleConversionLog(entry = {}) {
  const payload = {
    ts: new Date().toISOString(),
    ...entry,
  };
  try {
    await fs.promises.mkdir(path.dirname(GOOGLE_CONVERSION_LOG_FILE), {
      recursive: true,
    });
    await fs.promises.appendFile(
      GOOGLE_CONVERSION_LOG_FILE,
      `${JSON.stringify(payload)}\n`,
      "utf8"
    );
  } catch (error) {
    console.error("Failed to write google conversion log:", error.message);
  }
}

function getGoogleAdsEnv() {
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || "").trim();
  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();

  if (!clientId || !clientSecret || !developerToken || !refreshToken) {
    throw new Error(
      "Missing Google Ads env vars. Required: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN."
    );
  }

  return {
    clientId,
    clientSecret,
    developerToken,
    refreshToken,
  };
}

async function getGoogleAccessToken() {
  const { clientId, clientSecret, refreshToken } = getGoogleAdsEnv();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await axios.post(GOOGLE_OAUTH_TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20000,
  });

  const token = response.data?.access_token;
  if (!token) throw new Error("Failed to obtain Google OAuth access token.");
  return token;
}

function buildUploadPayload(input) {
  const {
    conversionActionId,
    conversionDateTime,
    clickIdType,
    clickIdValue,
    conversionValue,
    currencyCode,
  } = input;

  return {
    conversions: [
      {
        conversionAction: `customers/${GOOGLE_CUSTOMER_ID}/conversionActions/${conversionActionId}`,
        conversionDateTime,
        conversionValue,
        currencyCode,
        [clickIdType]: clickIdValue,
      },
    ],
    partialFailure: true,
    validateOnly: getValidateOnly(),
  };
}

function parseGooglePartialFailure(responseData) {
  const partialFailureError = responseData?.partialFailureError;
  if (!partialFailureError) return null;
  const hasMessage = typeof partialFailureError.message === "string" && partialFailureError.message.trim() !== "";
  const hasDetails = Array.isArray(partialFailureError.details) && partialFailureError.details.length > 0;
  if (!hasMessage && !hasDetails) return null;
  return partialFailureError;
}

/**
 * Plain-text summary from Google partial-failure or API error payloads.
 */
function extractGoogleFailureSummary(details) {
  if (!details) return "";
  if (typeof details === "string") return details.trim().slice(0, 500);
  if (typeof details.message === "string" && details.message.trim()) {
    return details.message.trim().slice(0, 500);
  }
  const blocks = details.details;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const errors = block?.errors;
      if (!Array.isArray(errors)) continue;
      for (const err of errors) {
        const codeKey =
          err?.errorCode && typeof err.errorCode === "object"
            ? Object.values(err.errorCode).find((v) => typeof v === "string" && v) || ""
            : "";
        const msg = typeof err?.message === "string" ? err.message.trim() : "";
        if (codeKey || msg) {
          return `${codeKey}${codeKey && msg ? ": " : ""}${msg}`.slice(0, 500);
        }
      }
    }
  }
  try {
    return JSON.stringify(details).slice(0, 500);
  } catch {
    return "";
  }
}

/** Skip Slack for high-volume expected validation misses (no click id). */
function shouldNotifyGoogleConversionSlack(result) {
  if (!result || result.ok) return false;
  if (result.error === "missing_click_id") return false;
  return true;
}

/**
 * Human-readable Slack alert (same channel as Roku/CM360 via SLACK_WEBHOOK_URL).
 */
function formatGoogleConversionSlackAlert({ result, source, exception, callID } = {}) {
  const statusCode = exception
    ? exception.response?.status || 500
    : result?.statusCode || 500;
  const lines = [
    `GOOGLE CONVERSION FAILED [HTTP ${statusCode}]`,
    `Source: ${source || "unknown"}`,
  ];

  const trackingCallId = callID || result?.callID;
  if (trackingCallId) lines.push(`Call ID: ${trackingCallId}`);

  if (result && !result.ok) {
    lines.push(`Error type: ${result.error || "unknown"}`);
    if (result.message) lines.push(`Message: ${result.message}`);
    if (result.conversionActionId) {
      lines.push(`Conversion action ID: ${result.conversionActionId}`);
    }
    if (result.clickIdType) lines.push(`Click ID type: ${result.clickIdType}`);
    if (result.conversionDateTime) {
      lines.push(`Conversion time: ${result.conversionDateTime}`);
    }
    const summary = extractGoogleFailureSummary(result.details);
    if (summary) lines.push(`Google details: ${summary}`);
  }

  if (exception) {
    lines.push("Error type: google_conversion_upload_failed");
    if (exception.response?.status) {
      lines.push(`Google Ads API status: ${exception.response.status}`);
    }
    lines.push(`Message: ${exception.message}`);
    if (exception.attempts) {
      lines.push(`Attempts: ${exception.attempts}`);
    }
    const apiSummary = extractGoogleFailureSummary(exception.response?.data);
    if (apiSummary) lines.push(`Google details: ${apiSummary}`);
  }

  return lines.join("\n");
}

async function uploadGoogleClickConversion(payload = {}) {
  const callId = resolveCallId(payload);
  const clickId = pickClickId(payload);
  const conversionActionId = validateConversionActionId(payload.conversionActionId);
  const conversionDateTime = resolveConversionDateTime(payload.conversionDateTime);
  const conversionValue = resolveConversionValue(payload);
  const currencyCode = resolveCurrencyCode(payload);
  const logContext = {
    googleCustomerId: GOOGLE_CUSTOMER_ID,
    loginCustomerId: GOOGLE_LOGIN_CUSTOMER_ID,
    conversionActionId: conversionActionId || null,
    conversionDateTime,
    conversionValue,
    currencyCode,
    callID: callId,
    clickIdType: clickId?.clickIdType || null,
    clickIdMasked: maskClickId(clickId?.clickIdValue || ""),
    validateOnly: getValidateOnly(),
    dryRun: getDryRun(),
  };

  try {
    if (!clickId) {
      const result = attachCallIdToErrorResult(
        {
          ok: false,
          statusCode: 400,
          error: "missing_click_id",
          message: "One of gclid, gbraid, or wbraid is required.",
        },
        callId
      );
      await writeGoogleConversionLog({ ...logContext, outcome: "validation_error", result });
      return result;
    }

    if (!conversionActionId) {
      const result = attachCallIdToErrorResult(
        {
          ok: false,
          statusCode: 400,
          error: "invalid_conversion_action_id",
          message: "conversionActionId is required and must be numeric.",
        },
        callId
      );
      await writeGoogleConversionLog({ ...logContext, outcome: "validation_error", result });
      return result;
    }

    if (getDryRun()) {
      const result = {
        ok: true,
        uploaded: true,
        dryRun: true,
        clickIdType: clickId.clickIdType,
        conversionActionId,
        conversionDateTime,
        googleCustomerId: GOOGLE_CUSTOMER_ID,
        loginCustomerId: GOOGLE_LOGIN_CUSTOMER_ID,
        conversionValue,
        currencyCode,
      };
      await writeGoogleConversionLog({ ...logContext, outcome: "dry_run", result });
      return result;
    }

    const { developerToken } = getGoogleAdsEnv();
    const requestBody = buildUploadPayload({
      conversionActionId,
      conversionDateTime,
      clickIdType: clickId.clickIdType,
      clickIdValue: clickId.clickIdValue,
      conversionValue,
      currencyCode,
    });
    const url = `${GOOGLE_ADS_API_BASE}/customers/${GOOGLE_CUSTOMER_ID}:uploadClickConversions`;
    const maxAttempts = getUploadMaxAttempts();
    const retryBaseMs = getUploadRetryBaseMs();
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const accessToken = await getGoogleAccessToken();
        const response = await axios.post(url, requestBody, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": developerToken,
            "login-customer-id": GOOGLE_LOGIN_CUSTOMER_ID,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });

        const partialFailure = parseGooglePartialFailure(response.data);
        if (partialFailure) {
          const result = attachCallIdToErrorResult(
            {
              ok: false,
              statusCode: 500,
              error: "google_upload_partial_failure",
              message: "google upload partial failure",
              details: partialFailure,
              clickIdType: clickId.clickIdType,
              conversionActionId,
              conversionDateTime,
              attempts: attempt,
            },
            callId
          );
          await writeGoogleConversionLog({
            ...logContext,
            attempt,
            outcome: "partial_failure",
            result,
          });
          return result;
        }

        const result = {
          ok: true,
          uploaded: true,
          clickIdType: clickId.clickIdType,
          conversionActionId,
          conversionDateTime,
          validateOnly: getValidateOnly(),
          attempts: attempt,
          results: response.data?.results || [],
        };
        await writeGoogleConversionLog({
          ...logContext,
          attempt,
          outcome: "success",
          result,
        });
        return result;
      } catch (error) {
        lastError = error;
        const retryable =
          isTransientGoogleError(error) && attempt < maxAttempts;

        await writeGoogleConversionLog({
          ...logContext,
          attempt,
          outcome: retryable ? "retry" : "exception",
          error: {
            message: error.message,
            code: error.code || null,
            status: error.response?.status || null,
            data: error.response?.data || null,
            retryable,
          },
        });

        if (!retryable) {
          error.attempts = attempt;
          throw error;
        }

        const delayMs = retryBaseMs * Math.pow(2, attempt - 1);
        console.warn(
          `[google-conversion] transient error on attempt ${attempt}/${maxAttempts}: ${error.message}; retrying in ${delayMs}ms`
        );
        await sleep(delayMs);
      }
    }

    if (lastError) {
      lastError.attempts = maxAttempts;
      throw lastError;
    }
    throw new Error("Google conversion upload failed with no attempts.");
  } catch (error) {
    if (error?.attempts == null) {
      await writeGoogleConversionLog({
        ...logContext,
        outcome: "exception",
        error: {
          message: error.message,
          status: error.response?.status || null,
          data: error.response?.data || null,
        },
      });
    }
    throw error;
  }
}

module.exports = {
  uploadGoogleClickConversion,
  shouldNotifyGoogleConversionSlack,
  formatGoogleConversionSlackAlert,
  extractGoogleFailureSummary,
  resolveCallId,
  isTransientGoogleError,
};

