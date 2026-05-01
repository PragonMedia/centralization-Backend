const accountingRevenueCacheService = require("./accountingRevenueCacheService");

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
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    dateKey: `${out.year}-${out.month}-${out.day}`,
  };
}

async function runScheduledRefresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const result = await accountingRevenueCacheService.refreshRevenueCache({
      trigger: "scheduler_1am_et",
    });
    console.log("Accounting scheduler: revenue cache refreshed", {
      refreshedAt: result.cache?.refreshedAt,
      companiesCount: result.payload?.companies?.length || 0,
    });
  } catch (error) {
    console.error("Accounting scheduler refresh failed:", error.message);
  } finally {
    refreshInProgress = false;
  }
}

function startAccountingRevenueScheduler() {
  if (schedulerTimer) return;

  schedulerTimer = setInterval(async () => {
    const nowEt = getEasternClock();
    const shouldRun = nowEt.hour === "01" && nowEt.minute === "00";
    if (!shouldRun) return;
    if (lastRunDateKey === nowEt.dateKey) return;
    lastRunDateKey = nowEt.dateKey;
    await runScheduledRefresh();
  }, 60000);

  console.log("Accounting scheduler started (daily 1:00 AM America/New_York)");
}

function stopAccountingRevenueScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

module.exports = {
  startAccountingRevenueScheduler,
  stopAccountingRevenueScheduler,
};

