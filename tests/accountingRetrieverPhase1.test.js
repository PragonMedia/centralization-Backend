const assert = require("assert");
const axios = require("axios");

const accountingController = require("../controllers/accountingController");
const accountingService = require("../services/accountingService");
const Company = require("../models/companyModel");

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
  const originalFind = Company.find;
  const originalRingba = accountingService.getRevenueRangeFromRingba;
  const originalRetriever = accountingService.getRevenueRangeFromRetriever;
  const originalRetrieverTestData = accountingService.getRetrieverTestData;
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;

  try {
    // Mixed-platform revenue route test (controller contract)
    Company.find = () => ({
      lean: async () => [
        { companyName: "RingbaCo", accountID: "ra-1", apiToken: "tok", platform: "ringba", net: "10%" },
        { companyName: "RetrieverCo", accountID: "re-1", platform: "retriever", net: "12%" },
      ],
    });

    accountingService.getRevenueRangeFromRingba = async () => ({
      success: true,
      revenueByDay: [{ day: "04/14/2026", revenue: 100, records: [] }],
    });
    accountingService.getRevenueRangeFromRetriever = async () => {
      return {
      success: true,
      revenueByDay: [{ day: "04/14/2026", revenue: 55.5, records: [{ buyer: "retriever-mock", conversionAmount: "55.5" }] }],
      };
    };

    const req = { body: { start: "2026-04-14", end: "2026-04-14" } };
    const res = createRes();
    await accountingController.getRevenue(req, res);

    assert.strictEqual(res.statusCode, 200, "expected 200 for mixed-platform revenue");
    assert.strictEqual(res.payload.success, true);
    assert.strictEqual(Array.isArray(res.payload.companies), true);
    assert.strictEqual(res.payload.companies.length, 2);
    assert.strictEqual(res.payload.companies[0].platform, "ringba");
    assert.strictEqual(res.payload.companies[1].platform, "retriever");

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
    Company.find = originalFind;
    accountingService.getRevenueRangeFromRingba = originalRingba;
    accountingService.getRevenueRangeFromRetriever = originalRetriever;
    accountingService.getRetrieverTestData = originalRetrieverTestData;
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
  }
}

run().catch((err) => {
  console.error("FAIL accountingRetrieverPhase1.test", err);
  process.exit(1);
});
