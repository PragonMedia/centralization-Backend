const rokuAdSpendCacheService = require("./rokuAdSpendCacheService");

let schedulerTimer = null;
let refreshInProgress = false;
let lastRunDateKey = "";

function getEasternClock() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const out = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return {
    hour: out.hour,
    minute: out.minute,
    dateKey: `${out.year}-${out.month}-${out.day}`,
  };
}

async function runScheduledRefresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const result = await rokuAdSpendCacheService.refreshRokuAdSpendCache({
      trigger: "scheduler_1am_et",
    });
    console.log("RokuAdSpend scheduler: refresh complete", {
      success: result.success,
      daysCached: result.payload?.days?.length || 0,
      totalSpend: result.payload?.totals?.spend,
      failedChunks: result.summary?.failedChunks?.length || 0,
      elapsedMinutes: result.summary?.elapsedMinutes,
    });
  } catch (error) {
    console.error("RokuAdSpend scheduler refresh failed:", error.message);
  } finally {
    refreshInProgress = false;
  }
}

function startRokuAdSpendScheduler() {
  if (schedulerTimer) return;

  schedulerTimer = setInterval(async () => {
    const nowEt = getEasternClock();
    const shouldRun = nowEt.hour === "01" && nowEt.minute === "00";
    if (!shouldRun) return;
    if (lastRunDateKey === nowEt.dateKey) return;
    lastRunDateKey = nowEt.dateKey;
    await runScheduledRefresh();
  }, 60000);

  console.log("RokuAdSpend scheduler started (daily 1:00 AM America/New_York)");
}

function stopRokuAdSpendScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

module.exports = {
  startRokuAdSpendScheduler,
  stopRokuAdSpendScheduler,
};
