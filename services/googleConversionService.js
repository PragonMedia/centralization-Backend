const axios = require("axios");

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VERSION = (process.env.GOOGLE_ADS_API_VERSION || "v22").trim();
const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

const GOOGLE_CUSTOMER_ID = "4316986825";
const GOOGLE_LOGIN_CUSTOMER_ID = "4316986825";
const GOOGLE_CONVERSION_VALUE = 1;
const GOOGLE_CURRENCY_CODE = "USD";

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
  } = input;

  return {
    conversions: [
      {
        conversionAction: `customers/${GOOGLE_CUSTOMER_ID}/conversionActions/${conversionActionId}`,
        conversionDateTime,
        conversionValue: GOOGLE_CONVERSION_VALUE,
        currencyCode: GOOGLE_CURRENCY_CODE,
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

async function uploadGoogleClickConversion(payload = {}) {
  const clickId = pickClickId(payload);
  if (!clickId) {
    return {
      ok: false,
      statusCode: 400,
      error: "missing_click_id",
      message: "One of gclid, gbraid, or wbraid is required.",
    };
  }

  const conversionActionId = validateConversionActionId(payload.conversionActionId);
  if (!conversionActionId) {
    return {
      ok: false,
      statusCode: 400,
      error: "invalid_conversion_action_id",
      message: "conversionActionId is required and must be numeric.",
    };
  }

  const conversionDateTime = resolveConversionDateTime(payload.conversionDateTime);

  if (getDryRun()) {
    return {
      ok: true,
      uploaded: true,
      dryRun: true,
      clickIdType: clickId.clickIdType,
      conversionActionId,
      conversionDateTime,
      googleCustomerId: GOOGLE_CUSTOMER_ID,
      loginCustomerId: GOOGLE_LOGIN_CUSTOMER_ID,
      conversionValue: GOOGLE_CONVERSION_VALUE,
      currencyCode: GOOGLE_CURRENCY_CODE,
    };
  }

  const accessToken = await getGoogleAccessToken();
  const { developerToken } = getGoogleAdsEnv();
  const requestBody = buildUploadPayload({
    conversionActionId,
    conversionDateTime,
    clickIdType: clickId.clickIdType,
    clickIdValue: clickId.clickIdValue,
  });

  const url = `${GOOGLE_ADS_API_BASE}/customers/${GOOGLE_CUSTOMER_ID}:uploadClickConversions`;
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
    return {
      ok: false,
      statusCode: 500,
      error: "google_upload_partial_failure",
      message: "google upload partial failure",
      details: partialFailure,
      clickIdType: clickId.clickIdType,
      conversionActionId,
      conversionDateTime,
    };
  }

  return {
    ok: true,
    uploaded: true,
    clickIdType: clickId.clickIdType,
    conversionActionId,
    conversionDateTime,
    validateOnly: getValidateOnly(),
    results: response.data?.results || [],
  };
}

module.exports = {
  uploadGoogleClickConversion,
};

