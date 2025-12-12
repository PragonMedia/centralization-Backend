require("dotenv").config();
const redtrackService = require("./services/redtrackService");

// Quick test to verify RedTrack API key
(async () => {
  console.log("🧪 Testing RedTrack API Key...\n");
  
  try {
    const result = await redtrackService.testAPIKey();
    
    if (result.success) {
      console.log("\n✅ SUCCESS! RedTrack API key is valid!");
      console.log(`Status: ${result.status}`);
      console.log(`Found ${result.data?.length || 0} domain(s) in RedTrack`);
    } else {
      console.log("\n❌ FAILED! RedTrack API key is invalid or has issues.");
      console.log(`Status: ${result.status}`);
      console.log(`Error:`, result.error);
    }
  } catch (error) {
    console.error("\n❌ Test failed with error:", error.message);
  }
})();





