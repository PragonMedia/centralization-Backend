const mongoose = require("mongoose");
const Domain = require("./models/domainModel");
require("dotenv").config();

// Sample data with new schema
const sampleData = [
  // Domains assigned to jake@paragonmedia.io
  {
    domain: "paragonmedia.com",
    assignedTo: "jake@paragonmedia.io",
    organization: "Paragon",
    id: "001-001",
    platform: "Google",
    certificationTags: ["G2"],
    routes: [
      {
        route: "landing-page",
        template: "pgnm-chatbot-groceries",
        organization: "paragon media",
        rtkID: "rtk_paragon_001",
        ringbaID: "ringba_paragon_001",
        phoneNumber: "+1 (555) 123-4567",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-15T10:00:00.000Z",
        updatedAt: "2024-01-15T10:00:00.000Z",
      },
      {
        route: "offer-page",
        template: "pgnm-ss",
        organization: "paragon media",
        rtkID: "rtk_paragon_002",
        ringbaID: "ringba_paragon_002",
        phoneNumber: "+1 (555) 123-4568",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-16T11:00:00.000Z",
        updatedAt: "2024-01-16T11:00:00.000Z",
      },
    ],
  },
  {
    domain: "eliteoffer.com",
    assignedTo: "jake@paragonmedia.io",
    organization: "Elite",
    id: "001-002",
    platform: "Facebook",
    certificationTags: ["Political", "G2"],
    routes: [
      {
        route: "vip-access",
        template: "pgnm-general-quiz",
        organization: "elite",
        rtkID: "rtk_elite_001",
        ringbaID: "ringba_elite_001",
        phoneNumber: "+1 (555) 999-8888",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-10T09:00:00.000Z",
        updatedAt: "2024-01-10T09:00:00.000Z",
      },
      {
        route: "premium-deal",
        template: "pgnm-grocery-quiz",
        organization: "elite",
        rtkID: "rtk_elite_002",
        ringbaID: "ringba_elite_002",
        phoneNumber: "+1 (555) 999-8889",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-12T14:00:00.000Z",
        updatedAt: "2024-01-12T14:00:00.000Z",
      },
    ],
  },
  {
    domain: "googleads-campaign.com",
    assignedTo: "jake@paragonmedia.io",
    organization: "Paragon",
    id: "001-003",
    platform: "Google",
    certificationTags: ["G2"],
    routes: [
      {
        route: "search-campaign",
        template: "pgnm-search-ss",
        organization: "paragon media",
        rtkID: "rtk_google_001",
        ringbaID: "ringba_google_001",
        phoneNumber: "+1 (555) 200-1000",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-20T08:00:00.000Z",
        updatedAt: "2024-01-20T08:00:00.000Z",
      },
      {
        route: "display-campaign",
        template: "pgnm-display-ss",
        organization: "paragon media",
        rtkID: "rtk_google_002",
        ringbaID: "ringba_google_002",
        phoneNumber: "+1 (555) 200-1001",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-21T09:00:00.000Z",
        updatedAt: "2024-01-21T09:00:00.000Z",
      },
      {
        route: "youtube-campaign",
        template: "pgnm-video-ss",
        organization: "paragon media",
        rtkID: "rtk_google_003",
        ringbaID: "ringba_google_003",
        phoneNumber: "+1 (555) 200-1002",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-22T10:00:00.000Z",
        updatedAt: "2024-01-22T10:00:00.000Z",
      },
    ],
  },
  {
    domain: "liftoff-mobile.com",
    assignedTo: "jake@paragonmedia.io",
    organization: "Fluent",
    id: "001-004",
    platform: "Liftoff",
    certificationTags: ["Mobile"],
    routes: [
      {
        route: "app-install",
        template: "flnt-mobile-ss",
        organization: "fluent",
        rtkID: "rtk_liftoff_001",
        ringbaID: "ringba_liftoff_001",
        phoneNumber: "+1 (555) 300-2000",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-23T11:00:00.000Z",
        updatedAt: "2024-01-23T11:00:00.000Z",
      },
    ],
  },
  {
    domain: "bigo-live.com",
    assignedTo: "jake@paragonmedia.io",
    organization: "Elite",
    id: "001-005",
    platform: "Bigo",
    certificationTags: ["Social Media"],
    routes: [
      {
        route: "live-stream",
        template: "elite-live-ss",
        organization: "elite",
        rtkID: "rtk_bigo_001",
        ringbaID: "ringba_bigo_001",
        phoneNumber: "+1 (555) 400-3000",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-24T12:00:00.000Z",
        updatedAt: "2024-01-24T12:00:00.000Z",
      },
      {
        route: "gaming-stream",
        template: "elite-gaming-ss",
        organization: "elite",
        rtkID: "rtk_bigo_002",
        ringbaID: "ringba_bigo_002",
        phoneNumber: "+1 (555) 400-3001",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-25T13:00:00.000Z",
        updatedAt: "2024-01-25T13:00:00.000Z",
      },
    ],
  },
  {
    domain: "mediamath-dsp.com",
    assignedTo: "jake@paragonmedia.io",
    organization: "Paragon",
    id: "001-006",
    platform: "Media Math",
    certificationTags: ["Programmatic"],
    routes: [
      {
        route: "dsp-campaign",
        template: "pgnm-dsp-ss",
        organization: "paragon media",
        rtkID: "rtk_mediamath_001",
        ringbaID: "ringba_mediamath_001",
        phoneNumber: "+1 (555) 500-4000",
        createdBy: "jake@paragonmedia.io",
        createdAt: "2024-01-26T14:00:00.000Z",
        updatedAt: "2024-01-26T14:00:00.000Z",
      },
    ],
  },

  // Domains assigned to addy@paragonmedia.io
  {
    domain: "fluentconversion.com",
    assignedTo: "addy@paragonmedia.io",
    organization: "Fluent",
    id: "002-001",
    platform: "Google",
    certificationTags: ["G2"],
    routes: [
      {
        route: "conversion-funnel",
        template: "flnt-chatbot-groceries",
        organization: "fluent",
        rtkID: "rtk_fluent_001",
        ringbaID: "ringba_fluent_001",
        phoneNumber: "+1 (555) 777-6666",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-08T08:00:00.000Z",
        updatedAt: "2024-01-08T08:00:00.000Z",
      },
      {
        route: "lead-capture",
        template: "flnt-chatbot-utility",
        organization: "fluent",
        rtkID: "rtk_fluent_002",
        ringbaID: "ringba_fluent_002",
        phoneNumber: "+1 (555) 777-6667",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-09T12:00:00.000Z",
        updatedAt: "2024-01-09T12:00:00.000Z",
      },
    ],
  },
  {
    domain: "facebook-ads-pro.com",
    assignedTo: "addy@paragonmedia.io",
    organization: "Elite",
    id: "002-002",
    platform: "Facebook",
    certificationTags: ["Political", "Social Media"],
    routes: [
      {
        route: "fb-campaign",
        template: "elite-fb-ss",
        organization: "elite",
        rtkID: "rtk_fb_001",
        ringbaID: "ringba_fb_001",
        phoneNumber: "+1 (555) 600-5000",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-27T15:00:00.000Z",
        updatedAt: "2024-01-27T15:00:00.000Z",
      },
      {
        route: "instagram-campaign",
        template: "elite-ig-ss",
        organization: "elite",
        rtkID: "rtk_fb_002",
        ringbaID: "ringba_fb_002",
        phoneNumber: "+1 (555) 600-5001",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-28T16:00:00.000Z",
        updatedAt: "2024-01-28T16:00:00.000Z",
      },
      {
        route: "messenger-campaign",
        template: "elite-msg-ss",
        organization: "elite",
        rtkID: "rtk_fb_003",
        ringbaID: "ringba_fb_003",
        phoneNumber: "+1 (555) 600-5002",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-29T17:00:00.000Z",
        updatedAt: "2024-01-29T17:00:00.000Z",
      },
    ],
  },
  {
    domain: "liftoff-gaming.com",
    assignedTo: "addy@paragonmedia.io",
    organization: "Fluent",
    id: "002-003",
    platform: "Liftoff",
    certificationTags: ["Gaming", "Mobile"],
    routes: [
      {
        route: "game-install",
        template: "flnt-gaming-ss",
        organization: "fluent",
        rtkID: "rtk_liftoff_002",
        ringbaID: "ringba_liftoff_002",
        phoneNumber: "+1 (555) 700-6000",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-30T18:00:00.000Z",
        updatedAt: "2024-01-30T18:00:00.000Z",
      },
    ],
  },
  {
    domain: "bigo-entertainment.com",
    assignedTo: "addy@paragonmedia.io",
    organization: "Paragon",
    id: "002-004",
    platform: "Bigo",
    certificationTags: ["Entertainment"],
    routes: [
      {
        route: "entertainment-stream",
        template: "pgnm-entertainment-ss",
        organization: "paragon media",
        rtkID: "rtk_bigo_003",
        ringbaID: "ringba_bigo_003",
        phoneNumber: "+1 (555) 800-7000",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-01-31T19:00:00.000Z",
        updatedAt: "2024-01-31T19:00:00.000Z",
      },
      {
        route: "music-stream",
        template: "pgnm-music-ss",
        organization: "paragon media",
        rtkID: "rtk_bigo_004",
        ringbaID: "ringba_bigo_004",
        phoneNumber: "+1 (555) 800-7001",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-02-01T20:00:00.000Z",
        updatedAt: "2024-02-01T20:00:00.000Z",
      },
    ],
  },
  {
    domain: "mediamath-rtb.com",
    assignedTo: "addy@paragonmedia.io",
    organization: "Elite",
    id: "002-005",
    platform: "Media Math",
    certificationTags: ["RTB", "Programmatic"],
    routes: [
      {
        route: "rtb-campaign",
        template: "elite-rtb-ss",
        organization: "elite",
        rtkID: "rtk_mediamath_002",
        ringbaID: "ringba_mediamath_002",
        phoneNumber: "+1 (555) 900-8000",
        createdBy: "addy@paragonmedia.io",
        createdAt: "2024-02-02T21:00:00.000Z",
        updatedAt: "2024-02-02T21:00:00.000Z",
      },
    ],
  },

  // Domains assigned to neil@paragonmedia.io
  {
    domain: "premiumbenefits.com",
    assignedTo: "neil@paragonmedia.io",
    organization: "Fluent",
    id: "003-001",
    platform: "Google",
    certificationTags: ["G2"],
    routes: [
      {
        route: "benefits-landing",
        template: "flnt-benefits-ss",
        organization: "fluent",
        rtkID: "rtk_neil_001",
        ringbaID: "ringba_neil_001",
        phoneNumber: "+1 (555) 100-9000",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-03T22:00:00.000Z",
        updatedAt: "2024-02-03T22:00:00.000Z",
      },
      {
        route: "premium-offer",
        template: "flnt-premium-ss",
        organization: "fluent",
        rtkID: "rtk_neil_002",
        ringbaID: "ringba_neil_002",
        phoneNumber: "+1 (555) 100-9001",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-04T23:00:00.000Z",
        updatedAt: "2024-02-04T23:00:00.000Z",
      },
    ],
  },
  {
    domain: "political-campaign.com",
    assignedTo: "neil@paragonmedia.io",
    organization: "Paragon",
    id: "003-002",
    platform: "Facebook",
    certificationTags: ["Political"],
    routes: [
      {
        route: "campaign-landing",
        template: "pgnm-political-ss",
        organization: "paragon media",
        rtkID: "rtk_neil_003",
        ringbaID: "ringba_neil_003",
        phoneNumber: "+1 (555) 200-0000",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-05T00:00:00.000Z",
        updatedAt: "2024-02-05T00:00:00.000Z",
      },
      {
        route: "voter-registration",
        template: "pgnm-voter-ss",
        organization: "paragon media",
        rtkID: "rtk_neil_004",
        ringbaID: "ringba_neil_004",
        phoneNumber: "+1 (555) 200-0001",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-06T01:00:00.000Z",
        updatedAt: "2024-02-06T01:00:00.000Z",
      },
      {
        route: "donation-page",
        template: "pgnm-donation-ss",
        organization: "paragon media",
        rtkID: "rtk_neil_005",
        ringbaID: "ringba_neil_005",
        phoneNumber: "+1 (555) 200-0002",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-07T02:00:00.000Z",
        updatedAt: "2024-02-07T02:00:00.000Z",
      },
    ],
  },
  {
    domain: "liftoff-ecommerce.com",
    assignedTo: "neil@paragonmedia.io",
    organization: "Elite",
    id: "003-003",
    platform: "Liftoff",
    certificationTags: ["E-commerce"],
    routes: [
      {
        route: "shop-now",
        template: "elite-shop-ss",
        organization: "elite",
        rtkID: "rtk_neil_006",
        ringbaID: "ringba_neil_006",
        phoneNumber: "+1 (555) 300-1000",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-08T03:00:00.000Z",
        updatedAt: "2024-02-08T03:00:00.000Z",
      },
    ],
  },
  {
    domain: "bigo-education.com",
    assignedTo: "neil@paragonmedia.io",
    organization: "Fluent",
    id: "003-004",
    platform: "Bigo",
    certificationTags: ["Education"],
    routes: [
      {
        route: "online-course",
        template: "flnt-education-ss",
        organization: "fluent",
        rtkID: "rtk_neil_007",
        ringbaID: "ringba_neil_007",
        phoneNumber: "+1 (555) 400-2000",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-09T04:00:00.000Z",
        updatedAt: "2024-02-09T04:00:00.000Z",
      },
      {
        route: "tutorial-stream",
        template: "flnt-tutorial-ss",
        organization: "fluent",
        rtkID: "rtk_neil_008",
        ringbaID: "ringba_neil_008",
        phoneNumber: "+1 (555) 400-2001",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-10T05:00:00.000Z",
        updatedAt: "2024-02-10T05:00:00.000Z",
      },
    ],
  },
  {
    domain: "mediamath-brand.com",
    assignedTo: "neil@paragonmedia.io",
    organization: "Paragon",
    id: "003-005",
    platform: "Media Math",
    certificationTags: ["Brand Awareness"],
    routes: [
      {
        route: "brand-campaign",
        template: "pgnm-brand-ss",
        organization: "paragon media",
        rtkID: "rtk_neil_009",
        ringbaID: "ringba_neil_009",
        phoneNumber: "+1 (555) 500-3000",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-11T06:00:00.000Z",
        updatedAt: "2024-02-11T06:00:00.000Z",
      },
    ],
  },
  {
    domain: "google-shopping.com",
    assignedTo: "neil@paragonmedia.io",
    organization: "Elite",
    id: "003-006",
    platform: "Google",
    certificationTags: ["Shopping", "G2"],
    routes: [
      {
        route: "product-listing",
        template: "elite-shopping-ss",
        organization: "elite",
        rtkID: "rtk_neil_010",
        ringbaID: "ringba_neil_010",
        phoneNumber: "+1 (555) 600-4000",
        createdBy: "neil@paragonmedia.io",
        createdAt: "2024-02-12T07:00:00.000Z",
        updatedAt: "2024-02-12T07:00:00.000Z",
      },
    ],
  },
];

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");

    // Clear existing data (optional - comment out if you want to keep existing data)
    await Domain.deleteMany({});
    console.log("🗑️  Cleared existing domains");

    // Insert sample data
    const result = await Domain.insertMany(sampleData);
    console.log(`✅ Successfully seeded ${result.length} domains with routes`);

    // Display summary
    const totalRoutes = result.reduce(
      (acc, domain) => acc + domain.routes.length,
      0
    );
    console.log(`📊 Total routes created: ${totalRoutes}`);

    // Show assignedTo breakdown
    const assignedToBreakdown = {};
    result.forEach((domain) => {
      assignedToBreakdown[domain.assignedTo] =
        (assignedToBreakdown[domain.assignedTo] || 0) + 1;
    });

    console.log("👥 Domains by assignedTo:");
    Object.entries(assignedToBreakdown).forEach(([person, count]) => {
      console.log(`   ${person}: ${count} domains`);
    });

    // Show platform breakdown
    const platformBreakdown = {};
    result.forEach((domain) => {
      platformBreakdown[domain.platform] =
        (platformBreakdown[domain.platform] || 0) + 1;
    });

    console.log("🎯 Domains by platform:");
    Object.entries(platformBreakdown).forEach(([platform, count]) => {
      console.log(`   ${platform}: ${count} domains`);
    });

    // Show organizations breakdown
    const orgBreakdown = {};
    result.forEach((domain) => {
      orgBreakdown[domain.organization] =
        (orgBreakdown[domain.organization] || 0) + 1;
    });

    console.log("🏢 Domains by organization:");
    Object.entries(orgBreakdown).forEach(([org, count]) => {
      console.log(`   ${org}: ${count} domains`);
    });

    console.log("\n🎉 Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed");
    process.exit(0);
  }
}

// Run the seed function
seedDatabase();
