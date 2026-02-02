/**
 * Domain+route tracking for debugging high-volume traffic.
 * Only runs when TRACK_DOMAIN_ROUTE=true (or "1"). Logs hits to a JSONL file.
 * Tracked: goldenplanstabloid.com/ss, goldenplanstabloid.com/groc
 * Delete the log file after testing. Turn off by unsetting TRACK_DOMAIN_ROUTE and restarting.
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

function domainRouteTrackingMiddleware(req, res, next) {
  if (req.method !== "GET") return next();

  const enabled =
    process.env.TRACK_DOMAIN_ROUTE === "true" ||
    process.env.TRACK_DOMAIN_ROUTE === "1";
  if (!enabled) return next();

  const domain = req.query.domain;
  const route = req.query.route;
  if (!shouldTrack(domain, route)) return next();

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
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("domainRouteTracking error:", err.message);
  }

  next();
}

module.exports = { domainRouteTrackingMiddleware };
