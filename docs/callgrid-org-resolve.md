# CallGrid organizationId lookup

`Company.accountID` for `platform: "callgrid"` must be CallGrid **`organizationId`** (e.g. `cmfmvrcv10agfl5067ly1l16z`).

## CallGrid API findings (verified)

| Endpoint | API key (Bearer) | Notes |
|----------|------------------|--------|
| `GET /api/organizations` | 401 Not authenticated | Likely session/dashboard auth only |
| `GET /api/organization` | 401 Not authenticated | Same |
| `GET /api/call` | 200 | Each row includes `organizationId` |
| `POST /api/reports/stats` (no `organizationId` query) | 200 | Scoped to the key’s org |

**Recommended discovery for per-org API keys:** `GET /api/call` with `maxItems=1` (or a small page), read `organizationId` from the first row.

Full reference: [CallGrid API](https://callgrid.com/api), [Swagger UI](https://api.callgrid.com/api/documentation).

## CORS (browser → CallGrid)

Preflight `OPTIONS` results (May 2026):

| Origin | `Access-Control-Allow-Origin` |
|--------|-------------------------------|
| `http://localhost:3000` | `http://localhost:3000` |
| `http://localhost:5173` | not set (browser direct call may fail) |
| `https://app.callgrid.com` | `https://app.callgrid.com` |

Use **direct** CallGrid `fetch` only when your portal origin is allowed. Otherwise use the backend proxy below.

## Backend proxy

```http
POST /api/v1/accounting/callgrid/resolve-org
Content-Type: application/json

{ "apiToken": "<callgrid-api-key>" }
```

Response:

```json
{
  "success": true,
  "organizations": [{ "organizationId": "cmfmvrcv10agfl5067ly1l16z", "label": "PM" }],
  "method": "GET /api/call"
}
```

## Frontend helper

Copy or import [`client/callgridResolveOrganization.js`](../client/callgridResolveOrganization.js):

```js
import { resolveCallgridOrganization } from "./callgridResolveOrganization";

const result = await resolveCallgridOrganization(apiToken, {
  accountingApiBaseUrl: "http://localhost:3000", // your Paragon BE
  callgridBaseUrl: "https://api.callgrid.com",
});

if (result.success && result.organizations.length === 1) {
  setAccountID(result.organizations[0].organizationId);
}
```

Then save with existing `POST /api/v1/accounting/companies` (`platform: "callgrid"`, `accountID`, `apiToken`, `companyName`).

## Manual fallback

Capture `organizationId` from dashboard DevTools on **Reports** → `POST /api/reports/stats?organizationId=...`, or use seed examples in [`config/callgridBuyers.js`](../config/callgridBuyers.js).
