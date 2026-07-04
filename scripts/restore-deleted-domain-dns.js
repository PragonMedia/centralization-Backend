#!/usr/bin/env node
/**
 * Restore origin A records for a deleted lander domain so nginx default_server
 * (410 + blank favicon) is reachable instead of Cloudflare Error 1016.
 *
 * Usage: node scripts/restore-deleted-domain-dns.js relief-assistance.com
 */
require("dotenv").config({ quiet: true });
const cloudflareService = require("../services/cloudflareService");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");

const domain = (process.argv[2] || "").trim().toLowerCase();
if (!domain) {
  console.error("Usage: node scripts/restore-deleted-domain-dns.js <domain>");
  process.exit(1);
}

(async () => {
  const serverIP = CLOUDFLARE_CONFIG.SERVER_IP;
  if (!serverIP) throw new Error("SERVER_IP is not set");

  console.log(`Restoring DNS for ${domain} → ${serverIP}`);
  const zone = await cloudflareService.getOrCreateZone(domain);
  console.log(`Zone: ${zone.id} status=${zone.status}`);

  await cloudflareService.setARecord(zone.id, domain, serverIP);
  await cloudflareService.enableProxy(zone.id, domain);
  await cloudflareService.purgeCache(zone.id);
  await cloudflareService.purgeCache(zone.id, [
    `https://${domain}/favicon.ico`,
    `http://${domain}/favicon.ico`,
    `https://www.${domain}/favicon.ico`,
    `https://${domain}/apple-touch-icon.png`,
  ]);

  console.log(`Done. Visit https://${domain}/ — expect 410 + no lander favicon.`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
