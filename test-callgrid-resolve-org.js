/**
 * CLI smoke test for CallGrid org resolution (same logic as POST /api/v1/accounting/callgrid/resolve-org).
 *
 *   node test-callgrid-resolve-org.js
 *   node test-callgrid-resolve-org.js --api-token <key>
 */
require("dotenv").config({ quiet: true });
const {
  resolveCallgridOrganization,
} = require("./services/callgridOrgResolveService");

function parseToken(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--api-token" && argv[i + 1]) return argv[i + 1].trim();
  }
  return (
    process.env.CALLGRID_API_KEY || process.env.CALLGRID_API_TOKEN || ""
  ).trim();
}

(async () => {
  const apiToken = parseToken(process.argv.slice(2));
  if (!apiToken) {
    console.error("Set CALLGRID_API_KEY in .env or pass --api-token <key>");
    process.exit(1);
  }

  const result = await resolveCallgridOrganization({ apiToken });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
