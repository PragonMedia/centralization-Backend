/**
 * Domain+route tracking for debugging high-volume traffic (BIGO only).
 * TRACK_DOMAIN_ROUTE=true: log only goldenplanstabloid.com/ss, goldenplanstabloid.com/groc -> domain-route-hits.jsonl
 * Turn off by unsetting TRACK_DOMAIN_ROUTE and restarting.
 */

const fs = require("fs");
const path = require("path");
const UAParser = require("ua-parser-js");

const TRACKED = [
  { domain: "goldenplanstabloid.com", route: "ss" },
  { domain: "goldenplanstabloid.com", route: "groc" },
];

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "domain-route-hits.jsonl");

function getClientIp(req) {
  if (req.headers["cf-connecting-ip"]) {
    return req.headers["cf-connecting-ip"].trim();
  }
  if (req.headers["x-forwarded-for"]) {
    return req.headers["x-forwarded-for"].split(",")[0].trim();
  }
  return req.ip || "";
}

function parseUserAgent(uaString) {
  if (!uaString) return { deviceType: "unknown", browser: "unknown" };
  const parser = new UAParser(uaString);
  const device = parser.getDevice();
  const browser = parser.getBrowser();
  const deviceType =
    device.type || (parser.getOS().name ? "desktop" : "unknown");
  return {
    deviceType: deviceType || "unknown",
    browser: [browser.name, browser.version].filter(Boolean).join(" ") || "unknown",
  };
}

function shouldTrack(domain, route) {
  const d = (domain || "").trim().toLowerCase();
  const r = (route || "").trim().toLowerCase();
  return TRACKED.some(
    (t) => t.domain.toLowerCase() === d && t.route.toLowerCase() === r
  );
}

function writeEntry(logPath, domain, route, req) {
  try {
    const uaString = req.headers["user-agent"] || "";
    const { deviceType, browser } = parseUserAgent(uaString);
    const entry = {
      timestamp: new Date().toISOString(),
      domain: (domain || "").trim(),
      route: (route || "").trim(),
      ip: getClientIp(req),
      userAgent: uaString,
      deviceType,
      browser,
    };
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("domainRouteTracking error:", err.message);
  }
}

function domainRouteTrackingMiddleware(req, res, next) {
  if (req.method !== "GET") return next();

  const domain = req.query.domain;
  const route = req.query.route;
  const isTracked = shouldTrack(domain, route);

  const enabledBigo =
    process.env.TRACK_DOMAIN_ROUTE === "true" ||
    process.env.TRACK_DOMAIN_ROUTE === "1";
  if (enabledBigo && isTracked) {
    writeEntry(LOG_FILE, domain, route, req);
  }

  next();
}

module.exports = { domainRouteTrackingMiddleware };
