#!/usr/bin/env node
/**
 * Backfill CallGrid route callgridCampaignSourceId from corrected media-buyers list.
 * Matches by callgridCampaignId + (sourceId OR media buyer name).
 */
require("dotenv").config({
  path: process.env.DOTENV_PATH || "/var/www/paragon-be/.env",
  quiet: true,
});

const mongoose = require("mongoose");
const Domain = require("../models/domainModel");
const callgridLanderService = require("../services/callgridLanderService");

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const domains = await Domain.find({
    "routes.trackingPlatform": "callgrid",
  }).exec();

  const byCampaign = new Map();
  const summary = [];
  let updated = 0;

  for (const domain of domains) {
    let dirty = false;
    for (const route of domain.routes) {
      if (route.trackingPlatform !== "callgrid") continue;
      const campaignId = route.callgridCampaignId;
      if (!campaignId) {
        summary.push({
          domain: domain.domain,
          route: route.route,
          action: "skip_no_campaign",
        });
        continue;
      }

      if (!byCampaign.has(campaignId)) {
        const result =
          await callgridLanderService.listMediaBuyersForCampaign(campaignId);
        byCampaign.set(campaignId, result.mediaBuyers || []);
      }
      const buyers = byCampaign.get(campaignId);

      const current = (route.callgridCampaignSourceId || "").trim();
      const buyerName = normName(route.callgridMediaBuyerName);

      let match =
        buyers.find((b) => b.sourceId && b.sourceId === current) ||
        buyers.find((b) => b.campaignSourceId === current) ||
        (buyerName
          ? buyers.find((b) => normName(b.name) === buyerName)
          : null) ||
        (buyerName
          ? buyers.find((b) => normName(b.name).includes(buyerName) || buyerName.includes(normName(b.name)))
          : null);

      if (!match) {
        summary.push({
          domain: domain.domain,
          route: route.route,
          action: "no_match",
          current,
          buyerName: route.callgridMediaBuyerName || null,
          campaignId,
        });
        continue;
      }

      if (current === match.campaignSourceId) {
        summary.push({
          domain: domain.domain,
          route: route.route,
          action: "already_ok",
          campaignSourceId: current,
          buyer: match.name,
        });
        continue;
      }

      const before = current;
      route.callgridCampaignSourceId = match.campaignSourceId;
      if (!route.callgridMediaBuyerName && match.name) {
        route.callgridMediaBuyerName = match.name;
      }
      route.updatedAt = new Date();
      dirty = true;
      updated += 1;
      summary.push({
        domain: domain.domain,
        route: route.route,
        action: "updated",
        before,
        after: match.campaignSourceId,
        sourceId: match.sourceId,
        buyer: match.name,
      });
    }
    if (dirty) await domain.save();
  }

  console.log(
    JSON.stringify(
      {
        domainsScanned: domains.length,
        updatedRoutes: updated,
        summary,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
