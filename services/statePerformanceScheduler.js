const statePerformanceCacheService = require("./statePerformanceCacheService");

let schedulerTimer = null;
let refreshInProgress = false;
let lastRunWeekKey = "";

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
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    weekday: out.weekday,
    weekKey: `${out.year}-${out.month}-${out.day}`,
  };
}

async function runScheduledRefresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const result = await statePerformanceCacheService.refreshStatePerformanceCache({
      trigger: "scheduler_friday_7pm_et",
    });
    console.log("StatePerformance scheduler: refresh complete", {
      success: result.success,
      weeksFetched: result.payload?.weeks?.length || 0,
    });
  } catch (error) {
    console.error("StatePerformance scheduler refresh failed:", error.message);
  } finally {
    refreshInProgress = false;
  }
}

function startStatePerformanceScheduler() {
  if (schedulerTimer) return;

  schedulerTimer = setInterval(async () => {
    const nowEt = getEasternClock();
    const isFriday = nowEt.weekday === "Fri";
    const shouldRun = isFriday && nowEt.hour === "19" && nowEt.minute === "00";
    if (!shouldRun) return;
    if (lastRunWeekKey === nowEt.weekKey) return;
    lastRunWeekKey = nowEt.weekKey;
    await runScheduledRefresh();
  }, 60000);

  console.log("StatePerformance scheduler started (Friday 7:00 PM America/New_York)");
}

function stopStatePerformanceScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

module.exports = {
  startStatePerformanceScheduler,
  stopStatePerformanceScheduler,
};
