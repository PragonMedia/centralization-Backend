const { purgeExpiredArchivedDomains } = require("./trashBinService");

let schedulerTimer = null;
let purgeInProgress = false;
let lastRunDateKey = "";

function getUtcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function runScheduledPurge(trigger = "scheduler") {
  if (purgeInProgress) {
    console.log("Archived domain purge already in progress, skipping");
    return null;
  }

  purgeInProgress = true;
  try {
    console.log(`🔄 Starting archived domain purge (${trigger})...`);
    const result = await purgeExpiredArchivedDomains();
    console.log("Archived domain purge complete:", {
      trigger,
      checked: result.checked,
      purged: result.purged.length,
      failed: result.failed.length,
    });
    return result;
  } catch (error) {
    console.error("Archived domain purge failed:", error.message);
    throw error;
  } finally {
    purgeInProgress = false;
  }
}

function startArchivedDomainPurgeScheduler() {
  if (schedulerTimer) return;

  // Run once on startup (catches backlog), then daily at ~03:15 UTC
  runScheduledPurge("startup").catch(() => {});

  schedulerTimer = setInterval(async () => {
    const now = new Date();
    const shouldRun = now.getUTCHours() === 3 && now.getUTCMinutes() === 15;
    if (!shouldRun) return;

    const dateKey = getUtcDateKey();
    if (lastRunDateKey === dateKey) return;
    lastRunDateKey = dateKey;

    await runScheduledPurge("daily").catch(() => {});
  }, 60000);

  console.log(
    "✅ Archived domain purge scheduler started (daily 03:15 UTC + startup run)"
  );
}

module.exports = {
  startArchivedDomainPurgeScheduler,
  runScheduledPurge,
};
