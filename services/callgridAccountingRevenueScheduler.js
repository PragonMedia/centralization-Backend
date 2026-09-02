const callgridAccountingRevenueCacheService = require("./callgridAccountingRevenueCacheService");

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
    const result = await callgridAccountingRevenueCacheService.refreshRevenueCache({
      trigger: "scheduler_1am_et",
    });
    const company = result.payload?.companies?.[0];
    const daysWithRecords =
      company?.revenue?.filter((r) => Array.isArray(r.records) && r.records.length > 0).length || 0;
    console.log("CallGrid accounting scheduler: revenue cache refreshed", {
      refreshedAt: result.cache?.refreshedAt,
      daysWithBuyerRecords: daysWithRecords,
      preservedDays: result.preservedDays || 0,
    });
  } catch (error) {
    console.error("CallGrid accounting scheduler refresh failed:", error.message);
  } finally {
    refreshInProgress = false;
  }
}

function startCallgridAccountingRevenueScheduler() {
  if (schedulerTimer) return;

  schedulerTimer = setInterval(async () => {
    const nowEt = getEasternClock();
    const shouldRun = nowEt.hour === "01" && nowEt.minute === "30";
    if (!shouldRun) return;
    if (lastRunDateKey === nowEt.dateKey) return;
    lastRunDateKey = nowEt.dateKey;
    await runScheduledRefresh();
  }, 60000);

  console.log(
    "CallGrid accounting scheduler started (daily 1:30 AM America/New_York — offset from Ringba cache)"
  );
}

function stopCallgridAccountingRevenueScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

module.exports = {
  startCallgridAccountingRevenueScheduler,
  stopCallgridAccountingRevenueScheduler,
};
