const callgridLanderService = require("../services/callgridLanderService");

/**
 * GET /api/v1/callgrid/campaigns
 */
exports.listCampaigns = async (req, res) => {
  try {
    const result = await callgridLanderService.listCampaigns();
    return res.status(200).json({
      success: true,
      organizationId: result.organizationId,
      campaigns: result.campaigns,
    });
  } catch (error) {
    console.error("CallGrid listCampaigns error:", error.message);
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "Failed to list CallGrid campaigns",
      details: error.details || undefined,
    });
  }
};

/**
 * GET /api/v1/callgrid/campaigns/:campaignId/media-buyers
 */
exports.listMediaBuyers = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const result =
      await callgridLanderService.listMediaBuyersForCampaign(campaignId);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("CallGrid listMediaBuyers error:", error.message);
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "Failed to list CallGrid media buyers",
      details: error.details || undefined,
    });
  }
};
