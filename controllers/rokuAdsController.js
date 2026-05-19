/**
 * Roku Ads API (beta) — ad accounts and spend reporting.
 * Not related to Ringba CAPI webhooks (see ringbaController + rokuConversionService).
 */
const rokuAdsReportService = require("../services/rokuAdsReportService");

exports.getAdAccounts = async (req, res) => {
  try {
    const organizationUid =
      typeof req.query?.organizationUid === "string" ? req.query.organizationUid.trim() : undefined;
    const limit = req.query?.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
    const offset = req.query?.offset != null ? parseInt(String(req.query.offset), 10) : undefined;

    const payload = await rokuAdsReportService.listAdAccounts({
      organizationUid,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    return res.status(200).json(payload);
  } catch (err) {
    console.error("Roku Ads getAdAccounts error:", err);
    return res.status(err.status === 401 ? 401 : 502).json({
      success: false,
      error: err.message || "Failed to list Roku ad accounts",
    });
  }
};

exports.getDeveloperPermissions = async (req, res) => {
  try {
    const payload = await rokuAdsReportService.getDeveloperPermissions();
    return res.status(200).json(payload);
  } catch (err) {
    console.error("Roku Ads getDeveloperPermissions error:", err);
    return res.status(err.status === 401 ? 401 : 502).json({
      success: false,
      error: err.message || "Failed to load developer permissions",
    });
  }
};

exports.getOrganizations = async (req, res) => {
  try {
    const includeAccounts = !["0", "false", "no"].includes(
      String(req.query?.includeAccounts ?? "true").trim().toLowerCase()
    );
    const payload = await rokuAdsReportService.listOrganizations({ includeAccounts });
    return res.status(200).json(payload);
  } catch (err) {
    console.error("Roku Ads getOrganizations error:", err);
    return res.status(err.status === 401 ? 401 : 502).json({
      success: false,
      error: err.message || "Failed to list Roku organizations",
    });
  }
};

exports.getSpend = async (req, res) => {
  try {
    const startDate = typeof req.query?.start === "string" ? req.query.start.trim() : "";
    const endDate = typeof req.query?.end === "string" ? req.query.end.trim() : "";
    const accountUid = typeof req.query?.accountUid === "string" ? req.query.accountUid.trim() : undefined;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Query params start and end are required (YYYY-MM-DD).",
      });
    }

    const payload = await rokuAdsReportService.fetchSpendForRange({
      startDate,
      endDate,
      accountUid: accountUid || undefined,
    });

    if (!payload.success) {
      return res.status(502).json(payload);
    }

    return res.status(200).json({
      success: true,
      source: "roku_ads_api",
      range: payload.range,
      reportUid: payload.reportUid,
      totals: payload.totals,
      byAccount: payload.byAccount,
      rowCount: payload.rows?.length ?? 0,
      uiValidationNote:
        "Compare totals to Ads Manager → Reports for the same date range and accounts.",
    });
  } catch (err) {
    console.error("Roku Ads getSpend error:", err);
    return res.status(err.status === 401 ? 401 : 502).json({
      success: false,
      error: err.message || "Failed to fetch Roku spend report",
    });
  }
};
