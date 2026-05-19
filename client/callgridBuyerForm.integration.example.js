/**
 * Example: wire CallGrid buyer create form in your accounting portal.
 * Import resolveCallgridOrganization from ./callgridResolveOrganization.js
 */

// async function onValidateCallgridKey(apiToken, setState) {
//   setState({ resolving: true, resolveError: null });
//   try {
//     const result = await resolveCallgridOrganization(apiToken, {
//       accountingApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
//     });
//     if (!result.success) {
//       setState({ resolving: false, resolveError: result.error });
//       return;
//     }
//     if (result.organizations.length === 1) {
//       const org = result.organizations[0];
//       setState({
//         resolving: false,
//         accountID: org.organizationId,
//         orgLabel: org.label,
//         resolveError: null,
//       });
//       return;
//     }
//     setState({
//       resolving: false,
//       orgChoices: result.organizations,
//       resolveError: null,
//     });
//   } catch (e) {
//     setState({ resolving: false, resolveError: e.message || "Lookup failed" });
//   }
// }

// async function onSaveCallgridBuyer({ companyName, accountID, apiToken }) {
//   const res = await fetch(`${API_BASE}/api/v1/accounting/companies`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       companyName,
//       accountID,
//       apiToken,
//       platform: "callgrid",
//     }),
//   });
//   return res.json();
// }
