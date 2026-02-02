/**
 * Block requests from localhost (127.0.0.1) to reduce bot/internal traffic
 * that consumes number pool. Use on domain-route-details only.
 */

function getClientIp(req) {
  if (req.headers["cf-connecting-ip"]) {
    return (req.headers["cf-connecting-ip"] || "").trim();
  }
  if (req.headers["x-forwarded-for"]) {
    return req.headers["x-forwarded-for"].split(",")[0].trim();
  }
  return req.ip || "";
}

function blockLocalhostMiddleware(req, res, next) {
  const ip = getClientIp(req);
  if (ip === "127.0.0.1") {
    return res.status(403).json({
      error: "Forbidden",
      message: "Requests from this origin are not allowed.",
    });
  }
  next();
}

module.exports = { blockLocalhostMiddleware };
