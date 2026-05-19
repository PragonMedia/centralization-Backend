/**
 * Example CallGrid buyers for seeding — NOT used at runtime.
 * Runtime loads companies from MongoDB with platform=callgrid.
 *
 * POST /api/v1/accounting/companies
 * {
 *   "companyName": "DigiPeak",
 *   "accountID": "cmkrcnm8y0000aacbqzs5j3ik",
 *   "apiToken": "<callgrid-api-key>",
 *   "platform": "callgrid"
 * }
 */
module.exports.CALLGRID_BUYER_SEED_EXAMPLES = [
  { companyName: "Persistent Policies", accountID: "cma1kp1db0000l807utlfv5e8" },
  { companyName: "AR Media", accountID: "cmmfevgbh03j607l6op8rx6dc" },
  { companyName: "Naked Media", accountID: "cmfmvrcv10agfl5067ly1l16z" },
  { companyName: "PPC Media Services", accountID: "cmlsvrwek04s208ldp8a4sboo" },
  { companyName: "DigiPeak", accountID: "cmkrcnm8y0000aacbqzs5j3ik" },
  { companyName: "Insurco", accountID: "cmohrpz7u00h507k03pog0evt" },
  { companyName: "Health Quotes", accountID: "cmo3ggv5200002dzanuypmoou" },
];
