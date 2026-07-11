const DOMAIN_VERTICALS = [
  "Medicare",
  "Final Expense",
  "Debt",
  "ACA",
  "Medicaid",
];

function isValidDomainVertical(value) {
  return typeof value === "string" && DOMAIN_VERTICALS.includes(value);
}

module.exports = {
  DOMAIN_VERTICALS,
  isValidDomainVertical,
};
