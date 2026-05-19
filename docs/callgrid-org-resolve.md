# CallGrid organizationId lookup (backend proxy)

`Company.accountID` for `platform: "callgrid"` is CallGrid **`organizationId`** (e.g. `cmfmvrcv10agfl5067ly1l16z`).

## Architecture (recommended)

The browser **must not** call `https://api.callgrid.com` (CORS blocks most portal origins).

```
Frontend  →  POST /api/v1/accounting/callgrid/resolve-org  →  Paragon BE  →  CallGrid API
```

Per-buyer API keys stay in the request body for resolve + save; production keys are stored in MongoDB on `POST /api/v1/accounting/companies`.

## Backend endpoint

```http
POST /api/v1/accounting/callgrid/resolve-org
Content-Type: application/json

{ "apiToken": "<callgrid-api-key>" }
```

**Success (200):**

```json
{
  "success": true,
  "organizations": [
    { "organizationId": "cmfmvrcv10agfl5067ly1l16z", "label": "PM" }
  ],
  "method": "GET /api/call"
}
```

**Error (400):**

```json
{
  "success": false,
  "error": "Invalid CallGrid API key (401 on /api/call).",
  "organizations": []
}
```

Server logic: [`services/callgridOrgResolveService.js`](../services/callgridOrgResolveService.js) — infers `organizationId` from `GET /api/call` (list org endpoints return 401 for API keys).

## Frontend (copy into your portal repo)

```js
const API_BASE = import.meta.env.VITE_API_BASE_URL;

export async function resolveCallgridOrganization(apiToken) {
  const res = await fetch(`${API_BASE}/api/v1/accounting/callgrid/resolve-org`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiToken: apiToken.trim() }),
  });
  return res.json();
}

// Validate key button:
const result = await resolveCallgridOrganization(apiToken);
if (result.success && result.organizations?.length === 1) {
  setAccountID(result.organizations[0].organizationId);
}
```

Optional: import [`client/callgridResolveOrganization.js`](../client/callgridResolveOrganization.js) (defaults to backend proxy only).

## Save buyer

```http
POST /api/v1/accounting/companies
{ "companyName", "accountID", "apiToken", "platform": "callgrid" }
```

Response omits `apiToken` by design.

## Server deploy

```bash
cd /var/www/paragon-be && git pull origin main && pm2 restart paragon-be
```

No `CALLGRID_API_KEY` in server `.env` required for production — keys live in Mongo per company.

## Manual fallback

DevTools on CallGrid Reports → `organizationId` in `POST /api/reports/stats?organizationId=...`, or seed list in [`config/callgridBuyers.js`](../config/callgridBuyers.js).
