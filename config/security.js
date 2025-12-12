// Security Configuration
// This file centralizes all security settings for the application

const securityConfig = {
  // Rate Limiting Configuration
  rateLimit: {
    // General rate limiting
    general: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: {
        error: "Too many requests from this IP, please try again later.",
      },
      standardHeaders: true,
      legacyHeaders: false,
    },

    // Authentication rate limiting (stricter)
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // Limit each IP to 5 requests per windowMs for auth
      message: {
        error: "Too many authentication attempts, please try again later.",
      },
      skipSuccessfulRequests: true,
    },

    // API rate limiting
    api: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Higher limit for API endpoints
      message: {
        error: "API rate limit exceeded, please try again later.",
      },
    },
  },

  // CORS Configuration
  cors: {
    allowedOrigins: [
      // Development
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173", // Vite default
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",

      // Add your production domains here
      // 'https://yourdomain.com',
      // 'https://www.yourdomain.com',
      // 'https://api.yourdomain.com'
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["X-Total-Count", "X-Page-Count"],
    maxAge: 86400, // 24 hours
  },

  // Helmet Configuration
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  },

  // Body Parser Limits
  bodyParser: {
    json: {
      limit: "10mb",
    },
    urlencoded: {
      extended: true,
      limit: "10mb",
    },
  },

  // Security Headers
  securityHeaders: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  },

  // Environment-specific settings
  environment: {
    development: {
      cors: {
        allowedOrigins: [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:5173",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001",
          "http://127.0.0.1:5173",
        ],
      },
      helmet: {
        contentSecurityPolicy: false, // Disable CSP in development for easier debugging
      },
    },
    production: {
      cors: {
        allowedOrigins: [
          // Add your production domains here
          // 'https://yourdomain.com',
          // 'https://www.yourdomain.com'
        ],
      },
      helmet: {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        },
      },
    },
  },
};

module.exports = securityConfig;
