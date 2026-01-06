const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");

// Import routes
const cloakingRouter = require("./routes/paragonCloaking");
const routeRouter = require("./routes/routeManager"); // ✅ your central route controller
const authRouter = require("./routes/authRoutes");
const sslRouter = require("./routes/sslRoutes");

const app = express();

// Security middleware - order matters!
// 1. Helmet - Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// 2. Rate limiting
// More lenient rate limiter for public API endpoints (landing pages)
const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100000, // Very high limit for public API endpoints (landing pages call this on every page load)
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use Cloudflare's real IP if available, otherwise let express-rate-limit handle IP detection
  // This avoids IPv6 key generation errors
  keyGenerator: (req) => {
    // Prefer Cloudflare's real IP header (always IPv4 or properly formatted)
    if (req.headers["cf-connecting-ip"]) {
      return req.headers["cf-connecting-ip"];
    }
    // Use x-forwarded-for (first IP in the chain)
    if (req.headers["x-forwarded-for"]) {
      return req.headers["x-forwarded-for"].split(",")[0].trim();
    }
    // For local requests or when no proxy headers, use a simple identifier
    // express-rate-limit will handle the IP detection automatically if we return undefined
    // But to avoid the IPv6 error, we'll use a simple string-based key
    return req.ip ? String(req.ip).replace(/:/g, "-") : "unknown";
  },
  // Skip validation for IPv6 to avoid the error (we're handling IPs manually above)
  skip: false,
});

// Standard rate limiter for other routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for domain-route-details (it has its own higher limit)
  skip: (req) => {
    return req.path === "/api/v1/domain-route-details";
  },
});

// Apply more lenient rate limiting to public API endpoints (landing pages)
app.use("/api/v1/domain-route-details", publicApiLimiter);

// Apply standard rate limiting to all other routes (skips domain-route-details)
app.use(limiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs for auth
  message: {
    error: "Too many authentication attempts, please try again later.",
  },
  skipSuccessfulRequests: true, // Don't count successful requests
});

// 3. CORS configuration - DISABLED FOR DEVELOPMENT
// const corsOptions = {
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like mobile apps or curl requests)
//     if (!origin) return callback(null, true);

//     const allowedOrigins = [
//       "http://localhost:3000",
//       "http://localhost:3001",
//       "http://localhost:5173", // Vite default
//       "http://localhost:5174", // Additional Vite port
//       "http://127.0.0.1:3000",
//       "http://127.0.0.1:3001",
//       "http://127.0.0.1:5173",
//       "http://127.0.0.1:5174",
//       // Add your production domains here
//       // 'https://yourdomain.com',
//       // 'https://www.yourdomain.com'
//     ];

//     if (allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
//   credentials: true, // Allow cookies/credentials
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
//   exposedHeaders: ["X-Total-Count", "X-Page-Count"],
//   maxAge: 86400, // 24 hours
// };

// Allow all origins for development
app.use(cors());

// 4. Body parsing middleware
app.use(express.json({ limit: "10mb" })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(bodyParser.json({ limit: "10mb" }));

// 5. Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// 6. Data sanitization against XSS
app.use(xss());

// 7. Prevent parameter pollution
app.use(hpp());

// 8. Additional security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()"
  );
  next();
});

// 9. Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

// 10. Error handling for unhandled routes
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  next();
});

// Apply stricter rate limiting to auth routes
app.use("/api/v1/auth", authLimiter, authRouter);

// Apply regular rate limiting to other routes
app.use("/api/v1/validate", cloakingRouter);
app.use("/api/v1/ssl", sslRouter);
app.use("/api/v1", routeRouter); // ✅ example endpoint: POST /routes

// 11. Global error handling middleware (must be last)
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Handle CORS errors
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: "CORS policy violation",
      message: "Origin not allowed",
    });
  }

  // Handle rate limit errors
  if (err.status === 429) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: err.message,
    });
  }

  // Handle validation errors
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation Error",
      message: err.message,
      details: err.details,
    });
  }

  // Handle MongoDB errors
  if (err.name === "MongoError" || err.name === "MongoServerError") {
    if (err.code === 11000) {
      return res.status(409).json({
        error: "Duplicate Error",
        message: "A record with this information already exists",
      });
    }
  }

  // Handle JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "Invalid Token",
      message: "Invalid or expired token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "Token Expired",
      message: "Token has expired",
    });
  }

  // Default error
  res.status(err.status || 500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong"
        : err.message,
  });
});

// 12. 404 handler for unmatched routes
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route Not Found",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

module.exports = app;
