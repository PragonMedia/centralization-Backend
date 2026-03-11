/**
 * Accounting service – fetches revenue (and related data) from Ringba for display on the frontend.
 * Requires RINGBA_API_BASE_URL and RINGBA_API_KEY in env. Ringba API docs: https://developers.ringba.com/
 */
const axios = require("axios");
const RINGBA_API_CONFIG = require("../config/ringbaApi");

/**
 * Fetch revenue data from Ringba reporting API.
 * @param {Object} options - Optional: dateFrom, dateTo (ISO date strings), accountId
 * @returns {Promise<{ success: boolean, revenue?: number, currency?: string, period?: object, data?: object, error?: string, message?: string }>}
 */
async function getRevenueFromRingba(options = {}) {
  const { dateFrom, dateTo, accountId } = options;
  const baseUrl = RINGBA_API_CONFIG.BASE_URL;
  const apiKey = RINGBA_API_CONFIG.API_KEY;

  if (!baseUrl || !apiKey) {
    return {
      success: false,
      message: "Ringba API not configured. Set RINGBA_API_BASE_URL and RINGBA_API_KEY in env.",
    };
  }

  try {
    // Ringba reporting API – adjust path when you have exact docs from https://developers.ringba.com/
    const path = "/v2/reports/revenue";
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;
    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (accountId) params.accountId = accountId;

    const response = await axios.get(url, {
      params,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 15000,
    });

    const data = response.data;
    // Normalize: accept various response shapes (e.g. { revenue }, { totalRevenue }, or { data: { revenue } })
    const revenue =
      data?.revenue ?? data?.totalRevenue ?? data?.data?.revenue ?? data?.data?.totalRevenue ?? null;
    const currency = data?.currency ?? data?.data?.currency ?? "USD";

    return {
      success: true,
      revenue: typeof revenue === "number" ? revenue : parseFloat(revenue) || null,
      currency,
      period: dateFrom && dateTo ? { dateFrom, dateTo } : undefined,
      data: data?.data ?? data,
    };
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    const message = body?.message ?? body?.error ?? error.message;
    console.warn("Accounting: Ringba API error", { status, message });
    return {
      success: false,
      error: message,
      message: status === 401 ? "Invalid Ringba API key." : `Ringba API error: ${message}`,
    };
  }
}

module.exports = {
  getRevenueFromRingba,
};
