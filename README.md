# centralization-Backend



cb-groc - sudo /usr/local/bin/deploy-cb-groc.sh
cb-ss - sudo /usr/local/bin/deploy-cb-ss.sh
el-cb-groc - sudo /usr/local/bin/deploy-el-cb-groc.sh
el-cb-ss - sudo /usr/local/bin/deploy-el-cb-ss.sh
es-cb-groc - sudo /usr/local/bin/deploy-es-cb-groc.sh
es-cb-ss - sudo /usr/local/bin/deploy-es-cb-ss.sh
backend code - cd /var/www/paragon-be && git pull && npm install && pm2 restart all
backend code - cd /var/www/paragon-be && git pull origin main && pm2 restart all
GENERAIC PAGES - cd /var/www/generic-pages
sudo git pull origin main
Sweeps - cd /var/www/templates/sweep && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/sweep && sudo chmod -R 755 /var/www/templates/sweep
frontend code - cd /var/www/paragon-fe && sudo -u www-data git fetch origin && sudo -u www-data git reset --hard origin/master && sudo npm install && sudo npm run build && sudo chown -R www-data:www-data /var/www/paragon-fe && sudo chmod -R 755 /var/www/paragon-fe

## Accounting Platform Notes

- Company records support `platform`: `ringba` or `retriever` (default `ringba`).
- Revenue endpoint is still `POST /api/v1/accounting/revenue` and keeps the same response shape.
- Revenue source selection is now per-company:
  - `ringba` -> existing Ringba Insights flow
  - `retriever` -> live Retreaver calls API (`/calls.json`) using company `accountID` as `company_id` and summing `payout` per day
    - `records[].buyer` is grouped by publisher label (`afid`) first, with fallback to `affiliate_id`, then existing ID fields if needed
    - PGNM (Ringba base) buyer comparison now uses matched buyer company `platform`: Ringba buyers compare via Ringba, Retriever buyers compare via Retreaver
- Test endpoint for Retriever live payload:
  - `GET /api/v1/accounting/retriever/test-data`
  - Optional query: `?accountID=210309` (if omitted, uses `RETREAVER_COMPANY_ID` env)
  - Returns live test payload (`source`, `period`, `records`, `revenue`) from Retreaver.

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
