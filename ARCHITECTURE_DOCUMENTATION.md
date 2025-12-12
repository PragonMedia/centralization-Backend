# Architecture Documentation

## Core Architecture & Deployment

### Entry Point

- **File**: `server.js`
- **Command**: `npm start` (runs `node server.js`)
- **Process Manager**: Currently not using PM2/systemd/Docker - runs directly via `node server.js`
- **Port**: 3000 (configurable via `PORT` env var)

### Backend Deployment

- **Current Status**: Running locally on Windows (`C:\Users\19mig\OneDrive\Documents\ParagonMedia\Centralized-Lander\ParagonMedia-BE`)
- **Deployment Method**: Manual (not automated)
- **Target Server**: Linux droplet at `138.68.231.226` (configured but backend runs locally)
- **Note**: Backend is currently on Windows, but needs to SSH to Linux server for certbot/nginx operations

### Environment Variables

- **Location**: `.env` file in project root
- **Sensitive Values** (keys only, values redacted):
  - `MONGO_URI` - MongoDB Atlas connection string
  - `CLOUDFLARE_API_TOKEN` - Cloudflare API token
  - `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID
  - `REDTRACK_API_KEY` - RedTrack API key
  - `REDTRACK_DEDICATED_DOMAIN` - RedTrack dedicated domain (e.g., `dx8jy.ttrk.io`)
  - `SERVER_IP` - Server IP address (`138.68.231.226`)
  - `INTERNAL_SERVER_URL` - Internal API URL (`http://localhost:3000`)
  - `INTERNAL_API_TOKEN` - Internal API token for SSL requests
  - `SSH_HOST` - SSH host (same as SERVER_IP)
  - `SSH_USER` - SSH username (default: `root`)
  - `SSH_KEY_PATH` - Path to SSH private key (optional)
  - `SSH_PASSWORD` - SSH password (if not using key)
  - `SSH_PORT` - SSH port (default: 22)

---

## Domain Provisioning Flow

### Step-by-Step Process

**Endpoint**: `POST /api/v1/domain`
**Controller**: `controllers/routeController.js` → `exports.createDomain`

#### Sequential Flow:

1. **Validation** (lines 120-169)

   - Validate required fields: `domain`, `assignedTo`, `id`, `platform`
   - Check domain doesn't already exist
   - Validate organization and platform enums

2. **Cloudflare Setup** (lines 186-216)

   - **Function**: `cloudflareService.getZoneId(domain)`
   - **Action**: GET `/zones?name={domain}` → if not found, POST `/zones` to create zone
   - **Function**: `cloudflareService.disableProxy(zoneId, domain)`
   - **Action**: Sets `proxied: false` (DNS only) for root and wildcard A records
   - **Function**: `cloudflareService.setARecord(zoneId, domain, SERVER_IP)`
   - **Action**: Creates A records: `domain.com` → `138.68.231.226` and `*.domain.com` → `138.68.231.226`
   - **Function**: `cloudflareService.createRedTrackCNAME(zoneId, domain, dedicatedDomain)`
   - **Action**: Creates CNAME: `trk.domain.com` → `dx8jy.ttrk.io` (DNS only, no proxy)

3. **Temporary Domain Record** (lines 220-236)

   - Creates MongoDB document with `sslStatus: "pending"` and `proxyStatus: "disabled"`
   - This allows nginx HTTP config to be generated

4. **Nginx HTTP Config** (lines 238-241)

   - **Function**: `generateNginxConfig()` in `services/dynamicRoutes.js`
   - **Action**: Generates HTTP vhost (port 80) with `.well-known/acme-challenge/` location
   - **Path**: `C:\Users\19mig\OneDrive\Documents\ParagonMedia\Centralized-Lander\nginx-config\nginx-1.27.5\conf\nginx_dynamic.conf`
   - **Reload**: Executes `nginx.exe -s reload` (Windows command)

5. **SSL Certificate Request** (lines 247-261)

   - **Function**: `requestOriginSSLCertificate(domain)` (helper function, line 410)
   - **Action**: POST to `http://localhost:3000/api/v1/ssl/request` with `{ domain }`
   - **Route Handler**: `routes/sslRoutes.js` → `router.post("/request")`
   - **Function**: `requestSSLCertificate(domain)` in `routes/sslRoutes.js` (line 43)
   - **Certbot Command**: Executed via SSH to Linux server:
     ```bash
     certbot certonly --webroot --non-interactive --agree-tos \
       --email admin@{domain} \
       -w /var/www/html \
       -d {domain} -d www.{domain}
     ```
   - **Certificate Location**: `/etc/letsencrypt/live/{domain}/fullchain.pem` and `privkey.pem`

6. **SSL Activation Wait** (lines 263-284)

   - **Function**: `cloudflareService.waitForSSLActivation(domain, 5_MINUTE_TIMEOUT)`
   - **Action**: Polls HTTPS endpoint to verify certificate is active
   - **Timeout**: 5 minutes (fails if not active within 5 minutes)

7. **Enable Cloudflare Proxy** (lines 290-302)

   - **Function**: `cloudflareService.enableProxy(zoneId, domain)`
   - **Action**: Sets `proxied: true` (orange cloud) for root and wildcard A records
   - **Function**: `cloudflareService.setSSLMode(zoneId, "full")`
   - **Action**: Sets Cloudflare SSL mode to "full" (Full strict)

8. **Nginx HTTPS Config** (lines 304-309)

   - **Function**: `generateNginxConfig()` (regenerates with HTTPS vhost)
   - **Action**: Generates HTTPS vhost (port 443) with SSL certificate paths and HTTP→HTTPS redirect

9. **RedTrack Integration** (lines 315-362)

   - **Function**: `redtrackService.addRedTrackDomain(domain)`
   - **Endpoint**: POST `https://api.redtrack.io/domains?api_key={API_KEY}`
   - **Payload**:
     ```json
     {
       "url": "trk.{domain}",
       "rootDomain": "{domain}",
       "type": "track",
       "use_auto_generated_ssl": true
     }
     ```
   - **Retry Logic**: 3 attempts with 10-second delays (for DNS propagation)
   - **Storage**: Saves `redtrackDomainId` and `redtrackTrackingDomain` to MongoDB

10. **Final Domain Record Update** (lines 464-470)

    - Updates MongoDB: `sslStatus: "active"`, `proxyStatus: "enabled"`, RedTrack IDs

11. **Background Monitoring** (lines 476-488)
    - **Function**: `monitorSSLAndEnableProxy(zoneId, domain)` (non-blocking)
    - **Purpose**: Ongoing health checks (SSL already active at this point)

---

## Nginx / SSH Integration Details

### SSH Usage

- **Yes**, backend SSHs to Linux server for certbot execution
- **Function**: `executeSSHCommand(command)` in `routes/sslRoutes.js` (line 6)
- **Method**: Uses `child_process.exec` with SSH command
- **SSH Command Format**:
  ```bash
  ssh -i "{SSH_KEY_PATH}" -o StrictHostKeyChecking=no \
    -p {SSH_PORT} {SSH_USER}@{SSH_HOST} "{command}"
  ```
  OR (if using password):
  ```bash
  sshpass -p "{SSH_PASSWORD}" ssh -o StrictHostKeyChecking=no \
    -p {SSH_PORT} {SSH_USER}@{SSH_HOST} "{command}"
  ```

### Nginx Config Generation

- **Function**: `generateNginxConfig()` in `services/dynamicRoutes.js`
- **Location**: Writes to **local Windows path**:
  ```
  C:\Users\19mig\OneDrive\Documents\ParagonMedia\Centralized-Lander\nginx-config\nginx-1.27.5\conf\nginx_dynamic.conf
  ```
- **Reload Command**: `nginx.exe -s reload` (Windows nginx)
- **Note**: Currently writes to **local Windows nginx**, not the Linux server's nginx
- **Issue**: The Linux server's nginx is not being updated - only local Windows nginx is reloaded

### SCP / Remote File Transfer

- **Not currently implemented** - nginx config is written locally only
- **Missing**: No SCP to transfer config to Linux server at `138.68.231.226`

### Sudoers Configuration

- **Not documented** - unknown if sudoers is configured on Linux server

---

## Cloudflare / DNS / Proxy Lifecycle

### Cloudflare API Calls

1. **Get/Create Zone**

   - **Endpoint**: `GET /zones?name={domain}` → if not found, `POST /zones`
   - **Function**: `cloudflareService.getZoneId(domain)`
   - **Token**: `Authorization: Bearer {CLOUDFLARE_API_TOKEN}`
   - **Permissions**: Zone:Read, Zone:Edit

2. **Disable Proxy** (initial)

   - **Endpoint**: `PATCH /zones/{zoneId}/dns_records/{recordId}`
   - **Function**: `cloudflareService.disableProxy(zoneId, domain)`
   - **Action**: Sets `proxied: false` for root and wildcard A records
   - **When**: Before SSL certificate request (required for Let's Encrypt validation)

3. **Create A Records**

   - **Endpoint**: `POST /zones/{zoneId}/dns_records`
   - **Function**: `cloudflareService.setARecord(zoneId, domain, SERVER_IP)`
   - **Records Created**:
     - `domain.com` → `138.68.231.226` (A record, proxied: false)
     - `*.domain.com` → `138.68.231.226` (A record, proxied: false)

4. **Create CNAME for RedTrack**

   - **Endpoint**: `POST /zones/{zoneId}/dns_records`
   - **Function**: `cloudflareService.createRedTrackCNAME(zoneId, domain, dedicatedDomain)`
   - **Record**: `trk.domain.com` → `dx8jy.ttrk.io` (CNAME, proxied: false)

5. **Enable Proxy** (after SSL)

   - **Endpoint**: `PATCH /zones/{zoneId}/dns_records/{recordId}`
   - **Function**: `cloudflareService.enableProxy(zoneId, domain)`
   - **Action**: Sets `proxied: true` for root and wildcard A records
   - **When**: After SSL certificate is active (step 7)

6. **Set SSL Mode**
   - **Endpoint**: `PATCH /zones/{zoneId}/settings/ssl`
   - **Function**: `cloudflareService.setSSLMode(zoneId, "full")`
   - **Mode**: "full" (Full strict - Cloudflare validates origin SSL)

### Proxy Toggle Timeline

- **Initial**: `proxied: false` (DNS only) - required for Let's Encrypt HTTP-01 validation
- **After SSL Active**: `proxied: true` (orange cloud) - enables Cloudflare proxy
- **Function**: `cloudflareService.enableProxy()` in `services/cloudflareService.js`

---

## RedTrack Integration & Ringba

### RedTrack Domain Addition

- **Function**: `redtrackService.addRedTrackDomain(rootDomain)` in `services/redtrackService.js` (line 50)
- **Endpoint**: `POST https://api.redtrack.io/domains?api_key={API_KEY}`
- **Payload**:
  ```json
  {
    "url": "trk.{domain}",
    "rootDomain": "{domain}",
    "type": "track",
    "use_auto_generated_ssl": true
  }
  ```
- **Response**: Returns `domainId` and `trackingDomain`
- **Storage**: Saved to MongoDB as `redtrackDomainId` and `redtrackTrackingDomain`
- **Timing**: After SSL is active and Cloudflare proxy is enabled (step 9)
- **Retry Logic**: 3 attempts with 10-second delays (for DNS propagation)

### Ringba Integration

- **Not implemented** - No Ringba API calls in codebase
- **Ringba ID**: Stored in route schema (`ringbaID` field) but not used for API calls
- **Note**: Ringba integration appears to be manual or handled elsewhere

---

## Data Model, Idempotency & Rollback

### Database Schema

- **Database**: MongoDB Atlas (connection via `MONGO_URI`)
- **Collection**: `domains` (Mongoose model: `Domain`)
- **Schema File**: `models/domainModel.js`

**Fields**:

- `domain` (String, required, unique) - Domain name
- `assignedTo` (String, required) - Email of assigned user
- `organization` (String, enum: ["Elite", "Paragon", "Fluent"]) - Organization
- `id` (String, required) - Internal ID (format: XXX-XXX)
- `platform` (String, enum: ["Facebook", "Google", "Liftoff", "Bigo", "Media Math"])
- `rtkID` (String, optional) - RedTrack ID (legacy)
- `certificationTags` (Array of Strings)
- `routes` (Array of route objects) - Sub-routes for this domain
- `cloudflareZoneId` (String, optional) - Cloudflare zone ID
- `aRecordIP` (String, optional) - A record IP address
- `sslStatus` (String, enum: ["pending", "active", "failed"], default: "pending")
- `proxyStatus` (String, enum: ["enabled", "disabled"], default: "disabled")
- `sslActivatedAt` (Date, optional) - When SSL became active
- `sslError` (String, optional) - SSL error message if failed
- `cloudflareMetadata` (Object, default: {}) - Additional Cloudflare data
- `redtrackDomainId` (String, optional) - RedTrack domain ID
- `redtrackTrackingDomain` (String, optional) - RedTrack tracking domain (e.g., `trk.domain.com`)
- `createdAt` (Date, auto) - Creation timestamp
- `updatedAt` (Date, auto) - Last update timestamp

### Rollback Policy

- **On Cloudflare/SSL/RedTrack Failure** (lines 363-407):

  - Deletes temporary domain record from MongoDB
  - Deletes Cloudflare DNS records (A records, CNAME, zone if created)
  - **Does NOT** delete RedTrack domain (if it was created before failure)
  - Returns 400 error to user (domain not created)

- **On Domain Deletion** (lines 942-1007):
  - Deletes Cloudflare DNS records
  - Deletes RedTrack domain
  - Deletes MongoDB document
  - Regenerates nginx config

### Idempotency

- **Partially idempotent**:
  - Checks if domain exists before creation (line 137) - prevents duplicate domains
  - If domain exists, returns 400 error
  - **Not fully idempotent**: If Cloudflare zone exists but domain record doesn't, will create duplicate zone (zone creation is idempotent via Cloudflare API, but domain record would be duplicate)

---

## SSL & Certificates

### SSL Strategy

- **Current**: Let's Encrypt with HTTP-01 validation
- **Not Using**: DNS-01 (would require Cloudflare DNS plugin), Cloudflare Origin CA
- **Implementation**: `certbot certonly` via SSH to Linux server

### Certbot Command

- **Exact Command** (from `routes/sslRoutes.js`, lines 93-108):
  ```bash
  certbot certonly \
    --webroot \
    --non-interactive \
    --agree-tos \
    --email admin@{domain} \
    -w /var/www/html \
    -d {domain} \
    -d www.{domain}
  ```
  OR (if webroot doesn't exist):
  ```bash
  certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email admin@{domain} \
    -d {domain} \
    -d www.{domain}
  ```

### Certificate Location

- **Fullchain**: `/etc/letsencrypt/live/{domain}/fullchain.pem`
- **Private Key**: `/etc/letsencrypt/live/{domain}/privkey.pem`
- **Nginx Config**: References these paths in HTTPS vhost (line 71-74 of `services/dynamicRoutes.js`)

---

## Performance & Concurrency

### Expected Load

- **Not documented** - unknown expected domain creations per minute/hour
- **Concurrent Requests**: Unknown - no rate limiting on domain creation endpoint (only global rate limit: 100 req/15min)

### Production Traffic Flow

- **Landing Page**: PHP files served by nginx (FastCGI to PHP-FPM)
- **API Calls**: Routes may make calls to backend API (not documented in codebase)
- **External APIs**: RedTrack tracking, Ringba (manual, not automated)
- **Initial Page Load**: PHP execution, potential DB lookups (not in backend, likely in PHP templates)

---

## Error Handling, Logging, Monitoring

### Logs

- **Location**: stdout (console.log)
- **No external logging**: No ELK, Datadog, syslog integration
- **Log Format**: Console.log statements throughout codebase

### SSL Status Detection

- **Endpoint**: `GET /api/v1/ssl/status?domain={domain}`
- **Handler**: `routes/sslRoutes.js` → `router.get("/status")` (line 195)
- **Function**: `checkCertificateStatus(domain)` (line 195)
- **Method**:
  1. Checks if certificate files exist on remote server: `/etc/letsencrypt/live/{domain}/fullchain.pem`
  2. HTTPS probe: Connects to `https://{domain}:443` and checks certificate validity
- **Returns**: `{ exists: true/false, expired: true/false, expiresAt: ISO date, issuer: "Let's Encrypt" }`

---

## Security & Secrets

### SSH Private Keys

- **Storage**: Path specified in `SSH_KEY_PATH` env var (not in codebase)
- **File Permissions**: Not documented
- **Passphrase**: Not documented (assumed no passphrase if using key)

### Role Separation

- **Not implemented** - no role-based access control for:
  - Certbot execution
  - Cloudflare proxy toggling
  - RedTrack domain creation
- **Access**: Anyone with API access can create domains (authentication not shown in domain creation endpoint)

---

## Automation & CI/CD

### Template Deployment

- **Not automated** - no git pull or template deployment automation
- **Templates**: Stored in route schema (`template` field) but not deployed automatically
- **Frontend Deployment**: Not documented

### Process Management

- **Not using PM2/systemd/Docker** - runs directly via `node server.js`
- **No ecosystem file** - no PM2 configuration
- **No systemd service** - no systemd unit file
- **No Docker** - no Dockerfile or docker-compose.yml

---

## Tests & Reproducibility

### Unit/Integration Tests

- **Not implemented** - no test files found
- **Test Scripts**: Some manual test scripts exist (`test-redtrack-api.js`, `test-database.js`) but not automated

### Sample Domain Creation Request

**Request**:

```json
POST /api/v1/domain
{
  "domain": "example.com",
  "assignedTo": "user@example.com",
  "organization": "Paragon",
  "id": "123-456",
  "platform": "Facebook",
  "certificationTags": ["tag1", "tag2"]
}
```

**Success Response** (201):

```json
{
  "message": "Domain created successfully. SSL certificate provisioning in progress.",
  "domain": {
    "domain": "example.com",
    "assignedTo": "user@example.com",
    "organization": "Paragon",
    "id": "123-456",
    "platform": "Facebook",
    "rtkID": null,
    "certificationTags": ["tag1", "tag2"],
    "routes": [],
    "cloudflareZoneId": "abc123...",
    "sslStatus": "active",
    "proxyStatus": "enabled",
    "redtrackTrackingDomain": "trk.example.com",
    "createdAt": "2025-12-08T..."
  }
}
```

**Final DB Record** (MongoDB):

```json
{
  "_id": "...",
  "domain": "example.com",
  "assignedTo": "user@example.com",
  "organization": "Paragon",
  "id": "123-456",
  "platform": "Facebook",
  "rtkID": null,
  "certificationTags": ["tag1", "tag2"],
  "routes": [],
  "cloudflareZoneId": "abc123...",
  "aRecordIP": "138.68.231.226",
  "sslStatus": "active",
  "proxyStatus": "enabled",
  "sslActivatedAt": "2025-12-08T...",
  "sslError": null,
  "cloudflareMetadata": {},
  "redtrackDomainId": "12345",
  "redtrackTrackingDomain": "trk.example.com",
  "createdAt": "2025-12-08T...",
  "updatedAt": "2025-12-08T..."
}
```

---

## Pain Points & Priorities

### Top 3 Production Failures

1. **RedTrack 401/Invalid Token** - API key authentication issues
2. **Certbot Pending** - SSL certificate not activating within 5 minutes
3. **Nginx Reload Failing** - Nginx not running or config path incorrect

### Non-Functional Requirements Priority

**Ranking** (based on current implementation):

1. **Safety/Rollback** - Cleanup on failure is implemented
2. **Speed of Provisioning** - 5-minute SSL timeout, synchronous flow
3. **Auditability** - Console logging, but no structured logs
4. **Minimal Changes** - Codebase is relatively clean, but nginx config path is hardcoded

---

## Critical Issues Identified

1. **Nginx Config Location Mismatch**:

   - Backend writes to **Windows local path**: `C:\Users\19mig\...\nginx_dynamic.conf`
   - Linux server nginx is **not being updated**
   - Need to SCP config to Linux server or generate on server directly

2. **Backend Running on Windows, Server on Linux**:

   - SSH commands work, but nginx reload is for Windows nginx only
   - Need to SSH to Linux server to reload nginx there

3. **No Process Manager**:

   - Backend runs directly via `node server.js`
   - No automatic restart on crash
   - No PM2/systemd/Docker

4. **No Ringba Automation**:
   - Ringba ID stored but not used for API calls
   - Manual integration only
