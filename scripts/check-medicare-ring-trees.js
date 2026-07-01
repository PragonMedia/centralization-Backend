#!/usr/bin/env node
/** One-off diagnostic: Medire tier trees + target lookup */
require("dotenv").config({ quiet: true });
const svc = require("../services/dynamicRingTreeTargetService");

const sampleTargetId = process.argv[2] || "PI2a3abe4d31ca41b2a2134e7ca8215c1e";

(async () => {
  const result = await svc.listFeRingTreesWithTargets({ profileKey: "medicare" });
  console.log(JSON.stringify({
    ok: result.ok,
    error: result.error,
    summary: result.summary,
    ringTrees: (result.ringTrees || []).map((t) => ({
      name: t.name,
      pingTreeId: t.pingTreeId,
      foundInRingba: t.foundInRingba,
      targetCount: t.targetCount,
      sampleTargetIds: (t.targets || []).slice(0, 3).map((x) => x.id),
      hasSample: (t.targets || []).some((x) => x.id === sampleTargetId),
    })),
  }, null, 2));

  const pingTrees = await svc.fetchPingTrees();
  const medicareNames = (pingTrees || [])
    .map((t) => ({
      name: t?.name || t?.attributes?.name,
      id: t?.id || t?.uid || t?.pingTreeId,
      targetCount: (t?.targets || t?.attributes?.targets || []).length,
    }))
    .filter((n) => n.name && /medicare/i.test(n.name));
  console.log("\nMedicare ping trees in Ringba:", JSON.stringify(medicareNames, null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
