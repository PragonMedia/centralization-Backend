/**
 * HTTP client + OAuth token for Roku Ads API (beta).
 */
const axios = require("axios");
const ROKU_ADS = require("../config/rokuAdsApi");

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function formatApiError(error) {
  if (error.response?.data) {
    const d = error.response.data;
    if (typeof d === "string") return d.slice(0, 500);
    if (Array.isArray(d.errors) && d.errors.length) {
      return d.errors
        .map((e) => e.detail || e.title || e.status || JSON.stringify(e))
        .join("; ")
        .slice(0, 500);
    }
    return JSON.stringify(d).slice(0, 500);
  }
  return error.message || String(error);
}

async function refreshAccessToken() {
  const clientId = ROKU_ADS.CLIENT_ID;
  const clientSecret = ROKU_ADS.CLIENT_SECRET;
  const refreshToken = ROKU_ADS.REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Roku Ads API credentials. Set ROKU_ADS_CLIENT_ID, ROKU_ADS_CLIENT_SECRET, and ROKU_ADS_REFRESH_TOKEN (or ROKU_ADS_ACCESS_TOKEN)."
    );
  }

  const response = await axios.post(
    `${ROKU_ADS.BASE_URL}/developer/token`,
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: ROKU_ADS.REQUEST_TIMEOUT_MS,
    }
  );

  const token = response.data?.access_token;
  const expiresIn = Number(response.data?.expires_in) || 3600;
  if (!token) {
    throw new Error("Roku token response missing access_token");
  }

  cachedToken = token;
  cachedTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 120) * 1000;
  return token;
}

async function getAccessToken() {
  const staticToken = ROKU_ADS.ACCESS_TOKEN;
  if (staticToken) return staticToken;

  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  return refreshAccessToken();
}

async function adsApiRequest(method, path, options = {}) {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${ROKU_ADS.BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  try {
    return await axios({
      method,
      url,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      params: options.params,
      data: options.data,
      timeout: options.timeout ?? ROKU_ADS.REQUEST_TIMEOUT_MS,
      validateStatus: options.validateStatus,
    });
  } catch (error) {
    const wrapped = new Error(`Roku Ads API ${method} ${path}: ${formatApiError(error)}`);
    wrapped.status = error.response?.status;
    wrapped.cause = error;
    throw wrapped;
  }
}

module.exports = {
  getAccessToken,
  refreshAccessToken,
  adsApiRequest,
  formatApiError,
};
