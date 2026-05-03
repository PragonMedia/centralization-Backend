const assert = require("assert");
const axios = require("axios");

const accountingController = require("../controllers/accountingController");
const accountingService = require("../services/accountingService");
const accountingRevenueCacheService = require("../services/accountingRevenueCacheService");

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
}

async function run() {
  const originalRingba = accountingService.getRevenueRangeFromRingba;
  const originalRetriever = accountingService.getRevenueRangeFromRetriever;
  const originalRetrieverTestData = accountingService.getRetrieverTestData;
  const originalRefreshRevenueCache = accountingRevenueCacheService.refreshRevenueCache;
  const originalGetLatestRevenueCache = accountingRevenueCacheService.getLatestRevenueCache;
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;

  try {
    // Refresh endpoint contract (manual cache write)
    accountingRevenueCacheService.refreshRevenueCache = async () => ({
      cache: { refreshedAt: "2026-04-15T00:00:00.000Z" },
      windowData: {
        startDate: "2026-02-15",
        endDateTimeIso: "2026-04-15T00:00:00Z",
      },
      payload: {
        companies: [{ companyName: "PGNM" }, { companyName: "Spring Venture Group" }],
      },
    });
    const req = { body: {} };
    const res = createRes();
    await accountingController.getRevenue(req, res);

    assert.strictEqual(res.statusCode, 200, "expected 200 for cache refresh");
    assert.strictEqual(res.payload.success, true);
    assert.strictEqual(res.payload.companiesCount, 2);

    // Cached endpoint contract (frontend read path)
    accountingRevenueCacheService.getLatestRevenueCache = async () => ({
      refreshedAt: "2026-04-15T00:00:00.000Z",
      windowStart: "2026-02-15T00:00:00.000Z",
      windowEnd: "2026-04-15T00:00:00.000Z",
      trigger: "scheduler_1am_et",
      payload: {
        success: true,
        companies: [{ companyName: "PGNM", revenue: [] }],
      },
    });
    const cachedRes = createRes();
    await accountingController.getCachedRevenue({}, cachedRes);
    assert.strictEqual(cachedRes.statusCode, 200);
    assert.strictEqual(cachedRes.payload.success, true);
    assert.strictEqual(Array.isArray(cachedRes.payload.companies), true);
    assert.strictEqual(cachedRes.payload.cacheMeta.trigger, "scheduler_1am_et");

    // Retriever test endpoint response shape
    accountingService.getRetrieverTestData = async () => ({
      success: true,
      source: "retreaver_live",
      period: { day: "04/14/2026", generatedAt: "2026-04-15T00:00:00.000Z" },
      records: [{ buyer: "123", conversionAmount: "55.5" }],
      revenue: 55.5,
    });
    const retrieverRes = createRes();
    await accountingController.getRetrieverTestData({}, retrieverRes);
    assert.strictEqual(retrieverRes.statusCode, 200);
    assert.strictEqual(retrieverRes.payload.success, true);
    assert.strictEqual(retrieverRes.payload.source, "retreaver_live");
    assert.strictEqual(Array.isArray(retrieverRes.payload.records), true);

    // Retriever service grouping: afid-first with summed payouts.
    axios.get = async (_url, requestOptions = {}) => {
      const page = requestOptions.params?.page;
      if (page === 1) {
        return {
          data: [
            { call: { afid: "Wright Source", payout: "12.5" } },
            { call: { afid: "Wright Source", payout: 2.5 } },
            { call: { afid: "DigiPeak", payout: "5" } },
            { call: { affiliate_id: "FallbackAffiliate", payout: "7" } },
            { call: { target_id: 48793, payout: "3" } },
          ],
        };
      }
      return { data: [] };
    };
    const retrieverDay = await accountingService.getRevenueFromRetreaverDay({
      accountID: "51625",
      apiKey: "dummy",
      reportStart: "2026-04-20T04:00:00Z",
      reportEnd: "2026-04-21T03:59:59Z",
      baseUrl: "https://api.retreaver.com",
    });
    assert.strictEqual(retrieverDay.success, true);
    assert.strictEqual(retrieverDay.revenue, 30);
    assert.deepStrictEqual(retrieverDay.records, [
      { buyer: "Wright Source", conversionAmount: "15" },
      { buyer: "DigiPeak", conversionAmount: "5" },
      { buyer: "FallbackAffiliate", conversionAmount: "7" },
      { buyer: "48793", conversionAmount: "3" },
    ]);

    // PGNM comparison parity: base PGNM rows enriched from matched buyer platform.
    accountingService.getRevenueRangeFromRetriever = originalRetriever;
    accountingService.getRevenueRangeFromRingba = originalRingba;
    axios.get = async (_url, requestOptions = {}) => {
      const page = requestOptions.params?.page;
      if (page === 1) {
        return {
          data: [
            { call: { afid: "Spring Venture Group", payout: "10" } },
            { call: { afid: "Spring Venture Group", payout: "15" } },
          ],
        };
      }
      return { data: [] };
    };
    axios.post = async () => {
      return {
        data: {
          isSuccessful: true,
          report: {
            records: [
              { buyer: "Spring Venture Group", conversionAmount: "30" },
            ],
          },
        },
      };
    };
    const pgnmWithComparison = await accountingService.getRevenueRangeFromRingba({
      accountID: "RA-PGNM",
      apiToken: "pgnm-token",
      start: "2026-04-20",
      end: "2026-04-20",
      buyersIndex: [
        {
          companyName: "Spring Venture Group",
          accountID: "51625",
          apiToken: "retriever-token",
          platform: "retriever",
          normalizedName: accountingService.normalizeBuyerName("Spring Venture Group"),
        },
      ],
    });
    assert.strictEqual(pgnmWithComparison.success, true);
    assert.strictEqual(pgnmWithComparison.revenueByDay.length, 1);
    assert.deepStrictEqual(pgnmWithComparison.revenueByDay[0].records, [
      {
        buyer: "Spring Venture Group",
        conversionAmount: "30",
        buyerConversionAmount: "25",
      },
    ]);

    axios.post = async () => ({
      data: {
        isSuccessful: true,
        report: {
          records: [
            { buyer: "Zebra Buyer", conversionAmount: 1 },
            { buyer: "Alpha Buyer", conversionAmount: 2 },
            { buyer: "Alpha Buyer", conversionAmount: 3 },
            { buyer: "-no value-", conversionAmount: 0 },
          ],
        },
      },
    });
    const buyerList = await accountingService.listRingbaBuyersForDateRange({
      accountID: "acc",
      apiToken: "tok",
      start: "2026-04-01",
      end: "2026-04-03",
    });
    assert.strictEqual(buyerList.success, true);
    assert.deepStrictEqual(buyerList.buyers, ["Alpha Buyer", "Zebra Buyer"]);
    assert.strictEqual(buyerList.window.start, "2026-04-01");
    assert.strictEqual(buyerList.window.end, "2026-04-03");

    const tooWide = await accountingService.listRingbaBuyersForDateRange({
      accountID: "acc",
      apiToken: "tok",
      start: "2026-01-01",
      end: "2026-06-01",
    });
    assert.strictEqual(tooWide.success, false);

    // Ringba regression: service still returns contract
    const ringbaContract = await accountingService.getRevenueRangeFromRingba({
      accountID: "any",
      apiToken: "any",
      start: "2026-04-01",
      end: "2026-04-01",
      buyersIndex: [],
    });
    assert.ok(Object.prototype.hasOwnProperty.call(ringbaContract, "success"));

    console.log("PASS accountingRetrieverPhase1.test");
  } finally {
    accountingService.getRevenueRangeFromRingba = originalRingba;
    accountingService.getRevenueRangeFromRetriever = originalRetriever;
    accountingService.getRetrieverTestData = originalRetrieverTestData;
    accountingRevenueCacheService.refreshRevenueCache = originalRefreshRevenueCache;
    accountingRevenueCacheService.getLatestRevenueCache = originalGetLatestRevenueCache;
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
  }
}

run().catch((err) => {
  console.error("FAIL accountingRetrieverPhase1.test", err);
  process.exit(1);
});
