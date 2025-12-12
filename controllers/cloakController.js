exports.cloak = (req, res) => {
  const { referrer = "", sub6 = "", key = "" } = req.body;

  const targetReferrers = [
    "adspy.com",
    "bigspy.com",
    "minea.com",
    "adspyder.io",
    "adflex.io",
    "poweradspy.com",
    "dropispy.com",
    "socialpeta.com",
    "adstransparency.google.com",
    "facebook.com/ads/library",
    "adbeat.com",
    "anstrex.com",
    "semrush.com",
    "autods.com",
    "foreplay.co",
    "spyfu.com",
    "adplexity.com",
    "spypush.com",
    "nativeadbuzz.com",
    "spyover.com",
    "videoadvault.com",
    "admobispy.com",
    "ispionage.com",
    "similarweb.com",
    "pipiads.com",
    "adespresso.com",
  ];

  let cameFromBadReferrer = false;
  try {
    const hostname = new URL(referrer).hostname;
    cameFromBadReferrer = targetReferrers.some((domain) =>
      hostname.includes(domain)
    );
  } catch (e) {
    console.log("Invalid referrer format");
  }

  const sub6Exists = sub6.trim().length > 0;
  const hasKey = key.toUpperCase() === "X184GA";

  // Main decision logic
  const allow = sub6Exists && hasKey && !cameFromBadReferrer;

  return res.json({ allow });
};
