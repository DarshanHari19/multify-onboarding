// Heuristic risk classifier for RAG/free-text-surfaced connectors. No
// sensitivity metadata exists anywhere in the catalog (registry or curated),
// so this infers a coarse category from the text a connector already carries
// (name/cat/desc) — pure, dependency-free, cheap to unit-test.
//
// Scope (locked decision): consent UX built on top of this applies ONLY to
// RAG/free-text results — curated role-bundle connectors (e.g. gmail
// auto-enabled in some bundles) are NOT reclassified by this module.

const FINANCE_KEYWORDS = [
  "pay", "payment", "bank", "invoice", "billing", "wallet", "ledger",
  "crypto", "revenue", "stripe", "finance", "accounting", "payroll", "tax",
];
const EMAIL_KEYWORDS = [
  "email", "e-mail", "mail", "inbox", "gmail", "imap", "smtp", "mailbox",
];

function textOf(connector) {
  const { name = "", cat = "", desc = "" } = connector || {};
  return `${name} ${cat} ${desc}`.toLowerCase();
}

// Returns "finance" | "email" | null. Finance wins on overlap (money access
// is the higher-severity category for the consent gate).
export function isSensitive(connector) {
  const text = textOf(connector);
  if (!text.trim()) return null;
  if (FINANCE_KEYWORDS.some((kw) => text.includes(kw))) return "finance";
  if (EMAIL_KEYWORDS.some((kw) => text.includes(kw))) return "email";
  return null;
}
