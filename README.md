# centralization-Backend



cb-groc - sudo /usr/local/bin/deploy-cb-groc.sh
cb-ss - sudo /usr/local/bin/deploy-cb-ss.sh
cb-debt (repo [PragonMedia/cb-debt](https://github.com/PragonMedia/cb-debt.git)) - cd /var/www/templates/cb-debt && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cb-debt && sudo chmod -R 755 /var/www/templates/cb-debt
quiz-debt (repo [PragonMedia/quiz-debt](https://github.com/PragonMedia/quiz-debt.git)) - cd /var/www/templates/quiz-debt && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/quiz-debt && sudo chmod -R 755 /var/www/templates/quiz-debt
el-cb-groc - sudo /usr/local/bin/deploy-el-cb-groc.sh
el-cb-ss - sudo /usr/local/bin/deploy-el-cb-ss.sh
es-cb-groc - sudo /usr/local/bin/deploy-es-cb-groc.sh
es-cb-ss - sudo /usr/local/bin/deploy-es-cb-ss.sh
homepage-debt (repo PragonMedia/debt-homepage) - cd /var/www/templates/homepage-debt && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/homepage-debt && sudo chmod -R 755 /var/www/templates/homepage-debt
cas-ie (repo PragonMedia/Cas-ie) - cd /var/www/templates/cas-ie && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cas-ie && sudo chmod -R 755 /var/www/templates/cas-ie
cas-uk (repo PragonMedia/Cas-uk) - cd /var/www/templates/cas-uk && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cas-uk && sudo chmod -R 755 /var/www/templates/cas-uk
casino-bb (repo [PragonMedia/casino-bingbong](https://github.com/PragonMedia/casino-bingbong.git)) - cd /var/www/templates/casino-bb && sudo -u www-data git fetch origin && sudo -u www-data git reset --hard origin/main && sudo chown -R www-data:www-data /var/www/templates/casino-bb && sudo chmod -R 755 /var/www/templates/casino-bb
aca-58 (repo PragonMedia/ACA-58) - cd /var/www/templates/aca-58 && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/aca-58 && sudo chmod -R 755 /var/www/templates/aca-58
cb-fe-25 (repo PragonMedia/cb-fe-25) - cd /var/www/templates/cb-fe-25 && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cb-fe-25 && sudo chmod -R 755 /var/www/templates/cb-fe-25
cb-fe (repo PragonMedia/cb-fe) - cd /var/www/templates/cb-fe && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cb-fe && sudo chmod -R 755 /var/www/templates/cb-fe
fe-40 (repo PragonMedia/cb-fe-40) - cd /var/www/templates/fe-40 && sudo -u www-data git fetch origin && sudo -u www-data git reset --hard "$(sudo -u www-data git -C /var/www/templates/fe-40 rev-parse --abbrev-ref origin/HEAD)" && sudo chown -R www-data:www-data /var/www/templates/fe-40 && sudo chmod -R 755 /var/www/templates/fe-40
cb-groc-short (repo GG-Chatbot-GTG-GROC-SHORT) - cd /var/www/templates/cb-groc-short && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cb-groc-short && sudo chmod -R 755 /var/www/templates/cb-groc-short
cb-ss-short (repo GG-Chatbot-GTG-SS-SHORT) - cd /var/www/templates/cb-ss-short && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/cb-ss-short && sudo chmod -R 755 /var/www/templates/cb-ss-short
backend code - cd /var/www/paragon-be && git pull && npm install && pm2 restart all
backend code - cd /var/www/paragon-be && git pull origin main && pm2 restart all
GENERAIC PAGES - cd /var/www/generic-pages
sudo git pull origin main
Sweeps - cd /var/www/templates/sweep && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/sweep && sudo chmod -R 755 /var/www/templates/sweep
frontend code - cd /var/www/paragon-fe && sudo -u www-data git fetch origin && sudo -u www-data git reset --hard origin/master && sudo npm install && sudo npm run build && sudo chown -R www-data:www-data /var/www/paragon-fe && sudo chmod -R 755 /var/www/paragon-fe

## Roku Ads API (ad accounts + spend)

Separate from Ringba **Conversions API** (`POST /ringba/roku/conversion`). Uses Roku Ads API beta at `https://api.ads.roku.com/v1`.

- `GET /api/v1/roku/ad-accounts` — list ad accounts
- `GET /api/v1/roku/organizations` — list orgs (optional `?includeAccounts=false`)
- `GET /api/v1/roku/spend?start=YYYY-MM-DD&end=YYYY-MM-DD` — async report → spend totals (`&accountUid=` optional)

Env: `ROKU_ADS_CLIENT_ID`, `ROKU_ADS_CLIENT_SECRET`, `ROKU_ADS_REFRESH_TOKEN` (see `.env.example`). API reference: `docs/roku-ads-api-reference.md`.

UI validation script: `node scripts/compare-roku-spend-ui.js --start 2026-05-04 --end 2026-05-08`

### Roku ad spend cache (dashboard)

Mongo collection: `rokuAdSpend`. Rolling **2 calendar months**, per-day per-account spend. Nightly refresh at **1:00 AM America/New_York** (weekly chunks, up to ~1 hour).

- `POST /api/v1/roku-ad-spend/refresh` — pull from Roku + overwrite cache (long-running; seed manually after deploy)
- `GET /api/v1/roku-ad-spend/cached` — **frontend read** (`days[]` with `dateIso`, `totalSpend`, `accounts[]`)

## Dynamic Ring Tree Target (FE tier RPC)

Merged into main API (port 3000). **Final Expense** uses fixed ping tree IDs for FE Tier 1/2/3. Medicare, Debt, ACA profiles are stubbed — enable when tier IDs are provided.

**Ringba pixel (Completed, GET):**

```
/webhooks/ringba/tier-rpc?vertical=fe&callId=[Call:InboundCallId]&targetId=[tag:Target:Id]&callerPhone=[tag:InboundNumber:Number]&revenue=[Call:ConversionAmount]
```

(`targetName` optional for logging only; batches and moves key off `targetId`.)

**API:**

- `GET /api/v1/ring-tree-target/health`
- `GET /api/v1/ring-tree-target/status?profile=fe`
- `GET /api/v1/ring-tree-target/profiles`
- `GET /api/v1/ring-tree-target/fe-ring-trees` — live FE Tier 1/2/3 ring trees + targets (`?enabledOnly=true` optional)
- `POST /api/v1/ring-tree-target/test/simulate-batch` — test 15-call batch
- `POST /api/v1/ring-tree-target/test/reset?profile=fe` — clear test state

**Test script:** `node scripts/simulate-ring-tree-tier-batch.js --targetId PI...`

Dry-run ON by default (`DYNAMIC_RING_TREE_DRY_RUN=false` for live moves). Slack tier-move alerts use `SLACK_WEBHOOK_URL` (same channel as Google conversion failures). Full spec: `DynamicRingTreeTarget.md`.

## Accounting Platform Notes

- Company records support `platform`: `ringba`, `retriever`, or `callgrid` (default `ringba`). CallGrid companies need `apiToken` (org API key) and `accountID` (CallGrid `organizationId`).
- Revenue refresh endpoint is `POST /api/v1/accounting/revenue`.
  - Default behavior starts a background refresh and returns immediately (`202`) to avoid long request hangs.
  - To wait for completion in one request, pass `?wait=true`.
  - Refresh job status endpoint: `GET /api/v1/accounting/revenue/refresh-status`.
- Fast frontend read endpoint is `GET /api/v1/accounting/revenue/cached`.
- PGNM Ringba buyer dropdown (live Insights, not Mongo): `GET /api/v1/accounting/ringba/pgnm/buyers`
  - Optional `?days=30` (default 30, max 120 rolling UTC calendar days ending today), or `?start=YYYY-MM-DD&end=YYYY-MM-DD` (max 120-day span).
- Revenue source selection is now per-company:
  - `ringba` -> existing Ringba Insights flow
  - `retriever` -> live Retreaver calls API (`/calls.json`) using company `accountID` as `company_id` and summing `payout` per day
    - `records[].buyer` is grouped by publisher label (`afid`) first, with fallback to `affiliate_id`, then existing ID fields if needed
  - `callgrid` -> CallGrid `POST /api/reports/stats` per day using company `apiToken` and `accountID` as `organizationId` (`footerTotals.total_payout`)
    - PGNM (Ringba base) buyer comparison uses matched buyer company `platform`: Ringba, Retriever, or CallGrid buyers compare via their own platform for `buyerConversionAmount`
- Cache architecture:
  - Refresh window is rolling 2 months (`start = now - 2 months`, `end = now`).
  - Scheduler runs daily at `1:00 AM America/New_York`.
  - Cached payload is stored in Mongo collection `accountingRevenue`.
  - Old cache is deleted on each refresh (single latest snapshot only).
- Test endpoint for Retriever live payload:
  - `GET /api/v1/accounting/retriever/test-data`
  - Optional query: `?accountID=210309` (if omitted, uses `RETREAVER_COMPANY_ID` env)
  - Returns live test payload (`source`, `period`, `records`, `revenue`) from Retreaver.
- CallGrid buyers (like Ringba/Retriever — API key on company record):
  - Add company: `POST /api/v1/accounting/companies` with `platform: "callgrid"`, `accountID` = CallGrid `organizationId`, `apiToken` = CallGrid API key for that org.
  - Resolve `organizationId` from API key (frontend → backend proxy, no CORS): `POST /api/v1/accounting/callgrid/resolve-org` with `{ "apiToken": "..." }` — see [`docs/callgrid-org-resolve.md`](docs/callgrid-org-resolve.md).
  - `GET /api/v1/accounting/callgrid/test-data` — loads all `platform=callgrid` companies; optional `?accountID=<orgId>`, `?rangeStart=`, `?rangeEnd=`, `?format=full`.
  - CLI: `node test-callgrid-buyers.js` (requires `MONGO_URI` and CallGrid companies in DB); `node test-callgrid-resolve-org.js` to test org lookup.

### Example Retriever Test Response

```json
{
  "success": true,
  "source": "retreaver_live",
  "period": {
    "day": "04/15/2026",
    "generatedAt": "2026-04-15T09:00:00.000Z",
    "reportStart": "2026-04-15T04:00:00Z",
    "reportEnd": "2026-04-16T03:59:59Z"
  },
  "records": [
    {
      "buyer": "Wright Source",
      "conversionAmount": "123.45"
    }
  ],
  "revenue": 123.45
}
```

## Google Conversion Webhook

- Endpoint: `POST /webhooks/ringba/google-conversion`
- Accepts payload fields:
  - `conversionActionId` (required, numeric string)
  - `conversionDateTime` (optional, defaults to current UTC in Google format)
  - `conversion_value` (optional, numeric; falls back to `1` if missing/invalid)
  - `currency_code` (optional; defaults to `USD`)
  - click id priority: `gclid` -> `gbraid` -> `wbraid` (at least one required)
  - `callID` (optional, Ringba tracking only): echoed on error responses and Slack alerts; not sent to Google
- Hardcoded upload context for phase 1:
  - `googleCustomerId = 4316986825`
  - `loginCustomerId = 4316986825`
  - conversion value fallback = `1`
  - currency fallback = `USD`
- Google Ads API version is configurable via `GOOGLE_ADS_API_VERSION` (default: `v22`)
- Temporary JSON log file for Google conversion attempts:
  - `logs/google-conversions.jsonl` (one JSON object per line; success + failure + exceptions)
- Slack alerts (`SLACK_WEBHOOK_URL`, same channel as Roku/CM360): sent on upload failures (HTTP 4xx/5xx except missing click id). Message includes HTTP status, error type, conversion action ID, and Google error summary.
