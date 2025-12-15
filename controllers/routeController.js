const Domain = require("../models/domainModel");
const { generateNginxConfig } = require("../services/dynamicRoutes");
const cloudflareService = require("../services/cloudflareService");
const redtrackService = require("../services/redtrackService");
const { enableProxyForDomain } = require("../services/cloudflareProxyEnable");
const CLOUDFLARE_CONFIG = require("../config/cloudflare");
const axios = require("axios");

// GET ALL DOMAINS with sorting and filtering
exports.getAllDomains = async (req, res) => {
  try {
    const {
      sortBy = "createdAt",
      sortOrder = "desc",
      limit,
      page = 1,
      search,
    } = req.query;

    // Build query object
    let query = {};

    // Search filter
    if (search) {
      query.$or = [
        { domain: { $regex: search, $options: "i" } },
        { "routes.route": { $regex: search, $options: "i" } },
        { "routes.organization": { $regex: search, $options: "i" } },
        { "routes.createdBy": { $regex: search, $options: "i" } },
      ];
    }

    // Build sort object
    const sortOptions = {};
    const validSortFields = [
      "createdAt",
      "updatedAt",
      "domain",
      "routes.organization",
      "routes.createdBy",
    ];
    const validSortOrders = ["asc", "desc"];

    if (
      validSortFields.includes(sortBy) &&
      validSortOrders.includes(sortOrder)
    ) {
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;
    } else {
      sortOptions.createdAt = -1; // Default sort
    }

    // Build find options
    const findOptions = { sort: sortOptions };

    // Pagination
    if (limit) {
      const limitNum = parseInt(limit);
      const pageNum = parseInt(page);
      const skip = (pageNum - 1) * limitNum;

      findOptions.limit = limitNum;
      findOptions.skip = skip;
    }

    // Execute query
    const domains = await Domain.find(query, null, findOptions);

    // Get total count for pagination
    const totalCount = await Domain.countDocuments(query);

    res.status(200).json({
      domains,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: limit ? parseInt(limit) : null,
        pages: limit ? Math.ceil(totalCount / parseInt(limit)) : 1,
      },
    });
  } catch (err) {
    console.error("Error fetching domains:", err);
    res.status(500).json({ error: "Server error while retrieving domains." });
  }
};

// GET DOMAIN NAMES ONLY (without route details)
exports.getDomainNames = async (req, res) => {
  try {
    const domains = await Domain.find({}, { domain: 1, _id: 0 });

    const domainNames = domains.map((doc) => doc.domain);

    res.status(200).json({
      message: "Domain names retrieved successfully.",
      count: domainNames.length,
      domains: domainNames,
    });
  } catch (err) {
    console.error("Error fetching domain names:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving domain names." });
  }
};

// CREATE A NEW DOMAIN (without routes)
exports.createDomain = async (req, res) => {
  console.log("🚀 STEP 0 — Domain creation request received");
  console.log("📥 Request body:", JSON.stringify(req.body, null, 2));

  let sanitizedDomain = null;

  try {
    const {
      domain,
      assignedTo,
      organization,
      id,
      platform,
      rtkID,
      certificationTags,
    } = req.body;

    console.log("🔍 STEP 1 — Validating request body");

    // Validate required fields
    if (!domain || !assignedTo || !id || !platform) {
      const missing = [];
      if (!domain) missing.push("domain");
      if (!assignedTo) missing.push("assignedTo");
      if (!id) missing.push("id");
      if (!platform) missing.push("platform");

      console.error("❌ Validation failed: Missing required fields:", missing);
      return res.status(400).json({
        error: "Missing required fields",
        details: `Required fields missing: ${missing.join(", ")}`,
        missingFields: missing,
      });
    }

    // Validate domain format
    if (typeof domain !== "string" || domain.trim().length === 0) {
      console.error("❌ Validation failed: Invalid domain format");
      return res.status(400).json({
        error: "Invalid domain name format",
        details: "Domain must be a non-empty string",
      });
    }

    // Sanitize domain name (trim whitespace only, keep original case and hyphens)
    sanitizedDomain = domain.trim();
    console.log(`✅ Domain validated: ${sanitizedDomain}`);

    // Check if domain already exists
    console.log(`🔍 STEP 2 — Checking if domain exists in database`);
    const existingDomain = await Domain.findOne({ domain: sanitizedDomain });
    if (existingDomain) {
      console.error(`❌ Domain already exists: ${sanitizedDomain}`);
      return res.status(400).json({
        error: "Domain already exists",
        details: `Domain ${sanitizedDomain} is already registered`,
        domain: sanitizedDomain,
      });
    }
    console.log(`✅ Domain ${sanitizedDomain} is available`);

    // Validate organization if provided
    if (
      organization &&
      !["Elite", "Paragon", "Fluent"].includes(organization)
    ) {
      console.error(
        `❌ Validation failed: Invalid organization: ${organization}`
      );
      return res.status(400).json({
        error: "Invalid organization",
        details: "Must be one of: Elite, Paragon, Fluent",
        provided: organization,
      });
    }

    // Validate platform
    if (
      !["Facebook", "Google", "Liftoff", "Bigo", "Media Math"].includes(
        platform
      )
    ) {
      console.error(`❌ Validation failed: Invalid platform: ${platform}`);
      return res.status(400).json({
        error: "Invalid platform",
        details: "Must be one of: Facebook, Google, Liftoff, Bigo, Media Math",
        provided: platform,
      });
    }

    // Validate certificationTags is an array if provided
    if (certificationTags && !Array.isArray(certificationTags)) {
      console.error(`❌ Validation failed: certificationTags must be an array`);
      return res.status(400).json({
        error: "Invalid certificationTags",
        details: "certificationTags must be an array",
        provided: typeof certificationTags,
      });
    }

    // Validate environment variables
    console.log("🔍 STEP 3 — Validating environment configuration");
    if (!CLOUDFLARE_CONFIG.API_TOKEN) {
      console.error("❌ Missing CLOUDFLARE_API_TOKEN");
      return res.status(500).json({
        error: "Server configuration error",
        details: "CLOUDFLARE_API_TOKEN is not configured",
      });
    }
    if (!CLOUDFLARE_CONFIG.SERVER_IP) {
      console.error("❌ Missing SERVER_IP");
      return res.status(500).json({
        error: "Server configuration error",
        details: "SERVER_IP is not configured",
      });
    }
    if (!CLOUDFLARE_CONFIG.INTERNAL_SERVER_URL) {
      console.error("❌ Missing INTERNAL_SERVER_URL");
      return res.status(500).json({
        error: "Server configuration error",
        details: "INTERNAL_SERVER_URL is not configured",
      });
    }
    if (!CLOUDFLARE_CONFIG.INTERNAL_API_TOKEN) {
      console.error("❌ Missing INTERNAL_API_TOKEN");
      return res.status(500).json({
        error: "Server configuration error",
        details: "INTERNAL_API_TOKEN is not configured",
      });
    }
    console.log("✅ Environment configuration validated");

    // ============================================
    // CLOUDFLARE & REDTRACK INTEGRATION
    // ============================================

    console.log("🔍 STEP 4 — Starting Cloudflare & RedTrack integration");

    let cloudflareZoneId = null;
    let redtrackResult = null;
    let tempDomain = null;
    let createdARecordIds = [];
    const redtrackDedicatedDomain =
      redtrackService.getRedTrackDedicatedDomain();

    console.log(
      `ℹ️  RedTrack dedicated domain: ${
        redtrackDedicatedDomain || "Not configured"
      }`
    );

    try {
      // 1) Get or create Cloudflare zone (no polling; rely on status only)
      console.log(
        `🔄 STEP 4.1 — Getting/Creating Cloudflare zone for ${sanitizedDomain}`
      );
      const zoneDetails = await cloudflareService.getOrCreateZone(
        sanitizedDomain
      );
      cloudflareZoneId = zoneDetails.id;
      console.log(
        `✅ Cloudflare zone: ${zoneDetails.name} (${cloudflareZoneId}) status=${zoneDetails.status}`
      );

      if (zoneDetails.status !== "active") {
        throw new Error(
          `Cloudflare zone is ${zoneDetails.status}. Please point registrar nameservers to Cloudflare and retry.`
        );
      }

      // 2) Add A records (root + wildcard) -> origin IP, DNS-only
      console.log(
        `🔄 STEP 4.2 — Ensuring A records for ${sanitizedDomain} → ${CLOUDFLARE_CONFIG.SERVER_IP} (proxied: false)`
      );
      const aRecordResult = await cloudflareService.setARecord(
        cloudflareZoneId,
        sanitizedDomain,
        CLOUDFLARE_CONFIG.SERVER_IP
      );
      createdARecordIds = aRecordResult.createdRecordIds || [];
      console.log(
        `✅ A record step complete (created: ${
          createdARecordIds.length
        }, existing: ${aRecordResult.existingRecordIds?.length || 0})`
      );

      // 3) Create RedTrack CNAME (DNS only, no proxy - RedTrack needs to verify it first)
      if (redtrackDedicatedDomain) {
        console.log(
          `🔄 STEP 4.3 — Ensuring RedTrack CNAME for ${sanitizedDomain} → ${redtrackDedicatedDomain} (DNS-only for RedTrack verification)`
        );
        await cloudflareService.createRedTrackCNAME(
          cloudflareZoneId,
          sanitizedDomain,
          redtrackDedicatedDomain
        );
        console.log(`✅ RedTrack CNAME present (DNS-only)`);
      } else {
        console.log(`ℹ️  Skipping RedTrack CNAME (not configured)`);
      }

      // 4) Create DB record (proxy disabled until later)
      console.log(`🔄 STEP 4.4 — Creating temporary domain record in database`);
      const tempDomainData = {
        domain: sanitizedDomain,
        assignedTo,
        organization: organization || "Paragon",
        id,
        platform,
        rtkID: rtkID || null,
        certificationTags: certificationTags || [],
        routes: [],
        cloudflareZoneId: cloudflareZoneId || null,
        aRecordIP: CLOUDFLARE_CONFIG.SERVER_IP || null,
        sslStatus: "cf-universal",
        proxyStatus: "disabled",
      };

      tempDomain = await Domain.create(tempDomainData);
      console.log(
        `✅ Temporary domain record created: ${sanitizedDomain} (ID: ${tempDomain._id})`
      );

      // 5) Generate nginx fragment (no SSL configuration changes here)
      console.log(
        `🔄 STEP 4.5 — Writing nginx fragment for ${sanitizedDomain}`
      );
      await generateNginxConfig(tempDomain);
      console.log(`✅ nginx fragment ready`);

      // 6) Set Cloudflare SSL mode (Universal SSL handles edge)
      console.log(
        `🔄 STEP 4.6 — Setting Cloudflare SSL mode to ${CLOUDFLARE_CONFIG.SSL_MODE}`
      );
      const sslModeResult = await cloudflareService.setSSLMode(
        cloudflareZoneId,
        CLOUDFLARE_CONFIG.SSL_MODE
      );
      if (sslModeResult?.skipped) {
        console.warn(
          `⚠️  SSL mode setting skipped: ${
            sslModeResult.reason || "unknown reason"
          }`
        );
      } else {
        console.log(
          `✅ Cloudflare SSL mode set to ${CLOUDFLARE_CONFIG.SSL_MODE}`
        );
      }

      // 7) Enable Cloudflare proxy for A records only (NOT trk CNAME yet - RedTrack needs to verify first)
      console.log(
        `🔄 STEP 4.7 — Enabling Cloudflare proxy for new A records on ${sanitizedDomain}`
      );
      await enableProxyForDomain(sanitizedDomain, createdARecordIds);
      console.log(`✅ Cloudflare proxy enabled for created A records`);

      // 8) Add domain to RedTrack (BEFORE enabling proxy on trk CNAME - they need to verify DNS)
      if (redtrackDedicatedDomain) {
        console.log(
          `🔄 STEP 4.8 — Registering domain with RedTrack: ${sanitizedDomain} (trk CNAME is DNS-only for verification)`
        );
        redtrackResult = await redtrackService.addRedTrackDomain(
          sanitizedDomain
        );
        if (redtrackResult.status === "skipped") {
          console.warn(
            `⚠️  RedTrack registration skipped: ${
              redtrackResult.reason || "unknown reason"
            }`
          );
          console.warn(
            `⚠️  Domain will be created, but RedTrack registration needs to be done manually`
          );
        } else {
          console.log(`✅ RedTrack added: ${redtrackResult.trackingDomain}`);
          
          // 9) NOW enable proxy for trk CNAME after RedTrack registration succeeds
          console.log(
            `🔄 STEP 4.9 — Enabling Cloudflare proxy for trk CNAME (after RedTrack registration)`
          );
          await enableProxyForDomain(sanitizedDomain, []); // Empty array = enable for all eligible records including trk CNAME
          console.log(`✅ Cloudflare proxy enabled for trk CNAME`);
        }
      } else {
        console.log(`ℹ️  Skipping RedTrack registration (not configured)`);
      }
    } catch (integrationError) {
      console.error("=".repeat(80));
      console.error("❌ DOMAIN CREATION ERROR — Integration failed");
      console.error("Domain:", sanitizedDomain);
      console.error("Error name:", integrationError.name);
      console.error("Error message:", integrationError.message);
      console.error("Error stack:", integrationError.stack);
      if (integrationError.response) {
        console.error(
          "HTTP Response Status:",
          integrationError.response.status
        );
        console.error(
          "HTTP Response Data:",
          JSON.stringify(integrationError.response.data, null, 2)
        );
      }
      console.error("=".repeat(80));

      // cleanup DB record if created
      if (tempDomain && tempDomain._id) {
        try {
          await Domain.findByIdAndDelete(tempDomain._id);
          console.log(`✅ Temporary domain record deleted for cleanup`);
        } catch (e) {
          console.error(`⚠️ Failed to delete temp domain record:`, e.message);
        }
      }

      const errorDetails =
        integrationError.message || integrationError.toString();
      const errorResponse = {
        error: "Domain creation failed: Integration error",
        details: errorDetails,
        domain: sanitizedDomain,
      };

      // Add more details if available
      if (integrationError.response?.data) {
        errorResponse.apiError = integrationError.response.data;
      }

      return res.status(400).json(errorResponse);
    }

    // 9. Update domain record with final integration data
    console.log(`🔄 STEP 5 — Saving final domain record to database`);
    tempDomain.sslStatus = "cf-universal";
    tempDomain.proxyStatus = "enabled";
    tempDomain.redtrackDomainId = redtrackResult?.domainId || null;
    tempDomain.redtrackTrackingDomain = redtrackResult?.trackingDomain || null;

    const newDomain = await tempDomain.save();
    console.log(
      `✅ Domain saved successfully: ${sanitizedDomain} (${newDomain.organization}) - ID: ${id} - Assigned to: ${assignedTo}`
    );
    console.log(
      `✅ RedTrack Domain ID: ${newDomain.redtrackDomainId || "N/A"}`
    );
    console.log(
      `✅ RedTrack Tracking Domain: ${
        newDomain.redtrackTrackingDomain || "N/A"
      }`
    );

    // Return success immediately (no DNS/SSL polling)
    res.status(201).json({
      message:
        "Domain created successfully using Cloudflare Universal SSL. Proxy enabled.",
      domain: {
        domain: newDomain.domain,
        assignedTo: newDomain.assignedTo,
        organization: newDomain.organization,
        id: newDomain.id,
        platform: newDomain.platform,
        rtkID: newDomain.rtkID,
        certificationTags: newDomain.certificationTags,
        routes: newDomain.routes,
        cloudflareZoneId: newDomain.cloudflareZoneId,
        sslStatus: newDomain.sslStatus,
        proxyStatus: newDomain.proxyStatus,
        redtrackTrackingDomain: newDomain.redtrackTrackingDomain,
        createdAt: newDomain.createdAt,
      },
    });
  } catch (err) {
    console.error("=".repeat(80));
    console.error("❌ DOMAIN CREATION ERROR — Unexpected error");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    if (err.response) {
      console.error("HTTP Response Status:", err.response.status);
      console.error(
        "HTTP Response Data:",
        JSON.stringify(err.response.data, null, 2)
      );
    }
    console.error("=".repeat(80));

    if (err.name === "ValidationError") {
      const validationDetails = Object.values(err.errors).map((e) => e.message);
      console.error("Validation errors:", validationDetails);
      return res.status(400).json({
        error: "Invalid domain data",
        details: validationDetails.join(", "),
        validationErrors: validationDetails,
      });
    }

    // Handle MongoDB duplicate key error
    if (err.name === "MongoServerError" && err.code === 11000) {
      console.error("Duplicate domain error");
      return res.status(409).json({
        error: "Domain already exists",
        details: "A domain with this name already exists in the database",
      });
    }

    const errorDetails = err.message || err.toString();
    return res.status(500).json({
      error: "Server error while creating domain",
      details: errorDetails,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  }
};

// CREATE A NEW DOMAIN & ROUTE
exports.createRoute = async (req, res) => {
  const {
    domain,
    route,
    template,
    organization,
    ringbaID,
    phoneNumber,
    createdBy,
    platform,
  } = req.body;

  try {
    // Validate required fields
    if (
      !domain ||
      !route ||
      !template ||
      !organization ||
      !createdBy ||
      !platform
    ) {
      return res.status(400).json({
        error:
          "Missing required fields. Required: domain, route, template, organization, createdBy, platform",
      });
    }

    // Validate organization
    if (!["paragon media", "elite", "fluent"].includes(organization)) {
      return res.status(400).json({
        error:
          "Invalid organization. Must be one of: paragon media, elite, fluent",
      });
    }

    // Validate platform
    if (
      !["Facebook", "Google", "Liftoff", "Bigo", "Media Math"].includes(
        platform
      )
    ) {
      return res.status(400).json({
        error:
          "Invalid platform. Must be one of: Facebook, Google, Liftoff, Bigo, Media Math",
      });
    }

    let domainDoc = await Domain.findOne({ domain });

    const newRoute = {
      route,
      template,
      organization,
      ringbaID,
      phoneNumber,
      createdBy,
      platform,
    };

    if (!domainDoc) {
      // Domain doesn't exist - return error since this endpoint is only for adding routes to existing domains
      return res.status(404).json({
        error:
          "Domain not found. Please create the domain first using the /domain endpoint.",
      });
    }

    // Check if user has access to this domain
    if (domainDoc.assignedTo !== createdBy) {
      return res
        .status(403)
        .json({ error: "You don't have access to modify this domain." });
    }

    // Prevent duplicate route for domain
    const exists = domainDoc.routes.find((r) => r.route === route);
    if (exists) {
      return res
        .status(400)
        .json({ error: "This route already exists for this domain." });
    }

    // Add route to existing domain
    domainDoc.routes.push(newRoute);

    // Ensure all existing routes have platform field (migration fix)
    domainDoc.routes.forEach((route) => {
      if (!route.platform) {
        route.platform = "Facebook"; // Set default platform for existing routes
      }
    });

    await domainDoc.save();
    await generateNginxConfig();

    res.status(201).json({
      message: "Route added successfully.",
      domain: domainDoc.domain,
      route: newRoute.route,
      organization: newRoute.organization,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
};

// EDIT DOMAIN NAME AND OTHER FIELDS
exports.updateDomainName = async (req, res) => {
  try {
    const {
      oldDomain,
      newOrganization,
      newId,
      newPlatform,
      newRtkID,
      newCertificationTags,
      newAssignedTo,
    } = req.body;

    console.log(`🔍 Attempting to update domain: ${oldDomain}`);

    // Validate required fields
    if (!oldDomain) {
      return res.status(400).json({ error: "oldDomain is required." });
    }

    // Find the domain document
    const domainDoc = await Domain.findOne({ domain: oldDomain });
    if (!domainDoc) {
      return res.status(404).json({ error: "Domain not found." });
    }

    console.log(`📋 Found domain document:`, domainDoc.domain);

    // Store old values for response
    const oldValues = {
      organization: domainDoc.organization,
      id: domainDoc.id,
      platform: domainDoc.platform,
      rtkID: domainDoc.rtkID,
      certificationTags: domainDoc.certificationTags,
      assignedTo: domainDoc.assignedTo,
    };

    const newValues = {
      organization: domainDoc.organization,
      id: domainDoc.id,
      platform: domainDoc.platform,
      rtkID: domainDoc.rtkID,
      certificationTags: domainDoc.certificationTags,
      assignedTo: domainDoc.assignedTo,
    };

    // Update organization if provided
    if (newOrganization !== undefined) {
      if (!["Elite", "Paragon", "Fluent"].includes(newOrganization)) {
        return res.status(400).json({
          error: "Invalid organization. Must be one of: Elite, Paragon, Fluent",
        });
      }
      newValues.organization = newOrganization;
      domainDoc.organization = newOrganization;
    }

    // Update ID if provided
    if (newId !== undefined) {
      if (!/^\d{3}-\d{3}$/.test(newId)) {
        return res.status(400).json({
          error:
            "ID must be in format XXX-XXX (6 digits with dash). Example: 123-456",
        });
      }
      newValues.id = newId;
      domainDoc.id = newId;
    }

    // Update platform if provided
    if (newPlatform !== undefined) {
      if (
        !["Facebook", "Google", "Liftoff", "Bigo", "Media Math"].includes(
          newPlatform
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid platform. Must be one of: Facebook, Google, Liftoff, Bigo, Media Math",
        });
      }
      newValues.platform = newPlatform;
      domainDoc.platform = newPlatform;
    }

    // Update rtkID if provided
    if (newRtkID !== undefined) {
      if (typeof newRtkID !== "string" || newRtkID.trim().length === 0) {
        return res.status(400).json({
          error: "rtkID must be a non-empty string",
        });
      }
      newValues.rtkID = newRtkID;
      domainDoc.rtkID = newRtkID;
    }

    // Update certification tags if provided
    if (newCertificationTags !== undefined) {
      if (!Array.isArray(newCertificationTags)) {
        return res.status(400).json({
          error: "certificationTags must be an array",
        });
      }
      newValues.certificationTags = newCertificationTags;
      domainDoc.certificationTags = newCertificationTags;
    }

    // Update assignedTo if provided
    if (newAssignedTo !== undefined) {
      if (
        typeof newAssignedTo !== "string" ||
        newAssignedTo.trim().length === 0
      ) {
        return res.status(400).json({
          error: "assignedTo must be a non-empty string",
        });
      }
      newValues.assignedTo = newAssignedTo;
      domainDoc.assignedTo = newAssignedTo;
    }

    // Save the updated domain
    const updatedDomain = await domainDoc.save();

    console.log(
      `✅ Domain updated successfully: ${oldDomain} -> ${updatedDomain.domain}`
    );

    // Verify the update actually happened
    const verificationDoc = await Domain.findOne({
      domain: updatedDomain.domain,
    });
    if (!verificationDoc) {
      console.error(
        `❌ Domain update verification failed: ${updatedDomain.domain} not found after update`
      );
      return res.status(500).json({
        error: "Domain update failed verification. Please try again.",
      });
    }

    // Regenerate nginx config
    await generateNginxConfig();

    // Check if any values actually changed
    const hasChanges =
      oldValues.organization !== newValues.organization ||
      oldValues.id !== newValues.id ||
      oldValues.platform !== newValues.platform ||
      oldValues.rtkID !== newValues.rtkID ||
      JSON.stringify(oldValues.certificationTags) !==
        JSON.stringify(newValues.certificationTags) ||
      oldValues.assignedTo !== newValues.assignedTo;

    res.status(200).json({
      message: "Domain updated successfully.",
      updatedDomain: {
        domain: updatedDomain.domain,
        organization: updatedDomain.organization,
        id: updatedDomain.id,
        platform: updatedDomain.platform,
        rtkID: updatedDomain.rtkID,
        certificationTags: updatedDomain.certificationTags,
        assignedTo: updatedDomain.assignedTo,
        routes: updatedDomain.routes.length,
      },
      changes: hasChanges
        ? {
            oldValues,
            newValues,
          }
        : null,
    });
  } catch (err) {
    console.error("Error updating domain:", err);

    // Handle specific MongoDB errors
    if (err.code === 11000) {
      return res.status(400).json({
        error: "Domain name already exists. Please choose a different name.",
      });
    }

    if (err.name === "ValidationError") {
      return res.status(400).json({
        error: "Invalid domain data.",
        details: Object.values(err.errors).map((e) => e.message),
      });
    }

    res.status(500).json({ error: "Server error while updating domain." });
  }
};

// EDIT SUB ROUTE DATA
exports.updateRouteData = async (req, res) => {
  const { domain, route, newRoute, template, newTemplate, createdBy } =
    req.body;

  try {
    // Validate required fields
    if (!domain || !route || !createdBy) {
      return res.status(400).json({
        error: "Missing required fields. Required: domain, route, createdBy",
      });
    }

    const domainDoc = await Domain.findOne({ domain });

    if (!domainDoc) {
      return res.status(404).json({ error: "Domain not found." });
    }

    // Check if user has access to this domain
    if (domainDoc.assignedTo !== createdBy) {
      return res.status(403).json({
        error: "You don't have access to modify this domain. Media Buyer",
      });
    }

    const routeToUpdate = domainDoc.routes.find((r) => r.route === route);

    if (!routeToUpdate) {
      return res
        .status(404)
        .json({ error: "Route not found under this domain." });
    }

    // Store old values for response
    const oldValues = {
      oldRoute: route,
      oldTemplate: routeToUpdate.template,
    };

    const newValues = {
      newRoute: route,
      newTemplate: routeToUpdate.template,
    };

    // Handle route path update
    if (newRoute && newRoute !== route) {
      const routeExists = domainDoc.routes.find((r) => r.route === newRoute);
      if (routeExists) {
        return res
          .status(400)
          .json({ error: "Route path already exists under this domain." });
      }

      newValues.newRoute = newRoute;
      routeToUpdate.route = newRoute;
    }

    // Handle template update
    if (newTemplate && newTemplate !== template) {
      newValues.newTemplate = newTemplate;
      routeToUpdate.template = newTemplate;
    }

    await domainDoc.save();
    await generateNginxConfig();

    // Check if any values actually changed
    const hasChanges =
      oldValues.oldRoute !== newValues.newRoute ||
      oldValues.oldTemplate !== newValues.newTemplate;

    res.status(200).json({
      message: "Route data updated successfully.",
      updatedRoute: routeToUpdate,
      changes: hasChanges
        ? {
            oldValues,
            newValues,
          }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
};

//GETS DATA FOR A SPECIFIC ROUTE TO USE FOR REDTRACK AND RINGBA
exports.getRouteData = async (req, res) => {
  const { domain, route } = req.body;

  try {
    const domainDoc = await Domain.findOne({ domain });

    if (!domainDoc) {
      return res.status(404).json({ error: "Domain not found." });
    }

    const matchedRoute = domainDoc.routes.find((r) => r.route === route);

    if (!matchedRoute) {
      return res
        .status(404)
        .json({ error: "Route not found for this domain." });
    }

    res.status(200).json(matchedRoute);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
};

// GET DOMAIN ROUTE DETAILS (Optimized - uses query parameters)
// Endpoint: GET /api/v1/domain-route-details?domain=xxx&route=yyy
exports.getDomainRouteDetails = async (req, res) => {
  const { domain, route } = req.query;

  try {
    // Validate required parameters
    if (!domain || !route) {
      return res.status(400).json({
        error: "Missing required parameters. Required: domain, route",
      });
    }

    // Sanitize inputs
    const sanitizedDomain = domain.trim();
    const sanitizedRoute = route.trim();

    // Optimized query: Only fetch fields we need (still single query, very fast)
    const domainDoc = await Domain.findOne(
      { domain: sanitizedDomain },
      {
        domain: 1,
        organization: 1,
        platform: 1,
        redtrackTrackingDomain: 1,
        routes: 1, // Fetch all routes, then filter in JavaScript
      }
    );

    if (!domainDoc) {
      return res.status(404).json({
        error: "Domain not found.",
        domain: sanitizedDomain,
      });
    }

    // Find the matching route in the routes array
    const matchedRoute = domainDoc.routes.find(
      (r) => r.route === sanitizedRoute
    );

    if (!matchedRoute) {
      return res.status(404).json({
        error: "Route not found for this domain.",
        domain: sanitizedDomain,
        route: sanitizedRoute,
        availableRoutes: domainDoc.routes.map((r) => r.route), // Helpful for debugging
      });
    }

    // Build response with route data and domain context
    res.status(200).json({
      success: true,
      domain: sanitizedDomain,
      route: sanitizedRoute,
      routeData: {
        route: matchedRoute.route,
        template: matchedRoute.template,
        organization: matchedRoute.organization,
        rtkID: matchedRoute.rtkID || null,
        ringbaID: matchedRoute.ringbaID || null,
        phoneNumber: matchedRoute.phoneNumber || null,
        createdBy: matchedRoute.createdBy || null,
        platform: matchedRoute.platform,
        createdAt: matchedRoute.createdAt,
        updatedAt: matchedRoute.updatedAt,
      },
      domainContext: {
        domain: domainDoc.domain,
        organization: domainDoc.organization,
        platform: domainDoc.platform,
        redtrackTrackingDomain: domainDoc.redtrackTrackingDomain || null,
      },
    });
  } catch (err) {
    console.error("Error fetching domain route details:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving route details." });
  }
};

// DELETE A DOMAIN
exports.deleteDomain = async (req, res) => {
  try {
    const { domain } = req.params;
    const { createdBy } = req.body;

    const domainDoc = await Domain.findOne({ domain });

    if (!domainDoc) {
      return res.status(404).json({ error: "Domain not found." });
    }

    // Check if user has access to this domain
    // if (domainDoc.createdBy !== createdBy) {
    //   return res
    //     .status(403)
    //     .json({ error: "You don't have access to delete this domain." });
    // }

    // --- Cleanup Cloudflare & RedTrack resources ---
    try {
      // 1. Delete DNS records from Cloudflare
      if (domainDoc.cloudflareZoneId) {
        console.log(`🔄 Deleting DNS records for ${domain}...`);
        await cloudflareService.deleteDNSRecords(
          domainDoc.cloudflareZoneId,
          domain
        );
      }

      // 2. Delete domain from RedTrack
      if (domainDoc.redtrackDomainId) {
        console.log(`🔄 Deleting RedTrack domain for ${domain}...`);
        await redtrackService.deleteRedTrackDomain(domainDoc.redtrackDomainId);
      }
    } catch (cleanupError) {
      console.error(
        `⚠️  Error during cleanup for ${domain}:`,
        cleanupError.message
      );
      // Continue with domain deletion even if cleanup fails
      // This ensures the domain is removed from database
    }

    // 3. Delete domain from database
    const deleted = await Domain.findOneAndDelete({ domain });

    // 4. Regenerate nginx config
    await generateNginxConfig();

    res.status(200).json({
      message: "Domain and its routes deleted successfully.",
      cleanup: {
        cloudflare: domainDoc.cloudflareZoneId
          ? "DNS records deleted"
          : "No Cloudflare records",
        redtrack: domainDoc.redtrackDomainId
          ? "Domain deleted"
          : "No RedTrack domain",
      },
    });
  } catch (err) {
    console.error("Error deleting domain:", err);
    res.status(500).json({ error: "Server error." });
  }
};

// DELETE A SUB ROUTE
exports.deleteSubRoute = async (req, res) => {
  try {
    const { domain, route } = req.params;
    const { createdBy } = req.body;

    const domainDoc = await Domain.findOne({ domain });

    if (!domainDoc) {
      return res.status(404).json({ error: "Domain not found." });
    }

    // Check if user has access to this domain
    // if (domainDoc.createdBy !== createdBy) {
    //   return res
    //     .status(403)
    //     .json({ error: "You don't have access to modify this domain." });
    // }

    const updatedDomain = await Domain.findOneAndUpdate(
      { domain },
      { $pull: { routes: { route } } },
      { new: true }
    );

    if (!updatedDomain) {
      return res
        .status(404)
        .json({ error: "Route not found under this domain." });
    }

    await generateNginxConfig();

    res.status(200).json({
      message: `Route '${route}' deleted from domain '${domain}'.`,
      updatedRoutes: updatedDomain.routes,
    });
  } catch (err) {
    console.error("Error deleting sub-route:", err);
    res.status(500).json({ error: "Server error." });
  }
};

// Get recent domains (last 7 days)
exports.getRecentDomains = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const recentDomains = await Domain.find({
      createdAt: { $gte: daysAgo },
    }).sort({ createdAt: -1 });

    res.status(200).json({
      domains: recentDomains,
      period: `${days} days`,
      count: recentDomains.length,
    });
  } catch (err) {
    console.error("Error fetching recent domains:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving recent domains." });
  }
};

// Get domains by date range
exports.getDomainsByDateRange = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error:
          "Start date and end date are required. Use ISO format (YYYY-MM-DD).",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // End of the day

    // Build sort object
    const sortOptions = {};
    const validSortFields = [
      "createdAt",
      "updatedAt",
      "domain",
      "routes.organization",
      "routes.createdBy",
    ];
    const validSortOrders = ["asc", "desc"];

    if (
      validSortFields.includes(sortBy) &&
      validSortOrders.includes(sortOrder)
    ) {
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }

    const domains = await Domain.find({
      createdAt: { $gte: start, $lte: end },
    }).sort(sortOptions);

    res.status(200).json({
      domains,
      dateRange: { startDate, endDate },
      count: domains.length,
    });
  } catch (err) {
    console.error("Error fetching domains by date range:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving domains by date range." });
  }
};

// Get domain statistics
exports.getDomainStats = async (req, res) => {
  try {
    const totalDomains = await Domain.countDocuments();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const domainsToday = await Domain.countDocuments({
      createdAt: { $gte: today },
    });

    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() - 7);
    const domainsThisWeek = await Domain.countDocuments({
      createdAt: { $gte: thisWeek },
    });

    const thisMonth = new Date();
    thisMonth.setMonth(thisMonth.getMonth() - 1);
    const domainsThisMonth = await Domain.countDocuments({
      createdAt: { $gte: thisMonth },
    });

    res.status(200).json({
      totalDomains,
      domainsToday,
      domainsThisWeek,
      domainsThisMonth,
    });
  } catch (err) {
    console.error("Error fetching domain statistics:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving domain statistics." });
  }
};

exports.getRoutesFromDatabase = async () => {
  return await Domain.find({});
};

// Get routes by creator
exports.getRoutesByCreator = async (req, res) => {
  try {
    const { createdBy, sortBy = "createdAt", sortOrder = "desc" } = req.query;

    if (!createdBy) {
      return res
        .status(400)
        .json({ error: "createdBy parameter is required." });
    }

    // Build sort object
    const sortOptions = {};
    const validSortFields = [
      "createdAt",
      "updatedAt",
      "domain",
      "routes.organization",
      "routes.createdBy",
    ];
    const validSortOrders = ["asc", "desc"];

    if (
      validSortFields.includes(sortBy) &&
      validSortOrders.includes(sortOrder)
    ) {
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;
    } else {
      sortOptions.createdAt = -1; // Default sort
    }

    // Find domains that have routes created by the specified user
    const domains = await Domain.find({
      "routes.createdBy": createdBy,
    }).sort(sortOptions);

    // Extract and format the routes for easier frontend consumption
    const routesByCreator = domains.map((domain) => ({
      domain: domain.domain,
      routes: domain.routes.filter((route) => route.createdBy === createdBy),
    }));

    res.status(200).json({
      createdBy,
      routes: routesByCreator,
      totalRoutes: routesByCreator.reduce(
        (acc, domain) => acc + domain.routes.length,
        0
      ),
    });
  } catch (err) {
    console.error("Error fetching routes by creator:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving routes by creator." });
  }
};

// Get statistics by creator
exports.getCreatorStats = async (req, res) => {
  try {
    const { createdBy } = req.query;

    if (!createdBy) {
      return res
        .status(400)
        .json({ error: "createdBy parameter is required." });
    }

    // Get total routes by creator
    const totalRoutes = await Domain.aggregate([
      { $unwind: "$routes" },
      { $match: { "routes.createdBy": createdBy } },
      { $count: "count" },
    ]);

    // Get routes created today by creator
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const routesToday = await Domain.aggregate([
      { $unwind: "$routes" },
      {
        $match: {
          "routes.createdBy": createdBy,
          "routes.createdAt": { $gte: today },
        },
      },
      { $count: "count" },
    ]);

    // Get routes created this week by creator
    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() - 7);
    const routesThisWeek = await Domain.aggregate([
      { $unwind: "$routes" },
      {
        $match: {
          "routes.createdBy": createdBy,
          "routes.createdAt": { $gte: thisWeek },
        },
      },
      { $count: "count" },
    ]);

    res.status(200).json({
      createdBy,
      totalRoutes: totalRoutes.length > 0 ? totalRoutes[0].count : 0,
      routesToday: routesToday.length > 0 ? routesToday[0].count : 0,
      routesThisWeek: routesThisWeek.length > 0 ? routesThisWeek[0].count : 0,
    });
  } catch (err) {
    console.error("Error fetching creator statistics:", err);
    res
      .status(500)
      .json({ error: "Server error while retrieving creator statistics." });
  }
};
