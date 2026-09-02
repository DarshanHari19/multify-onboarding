// Sponsored-slot matching (illustrative ad inventory — see CLAUDE.md
// REAL-vs-ILLUSTRATIVE). Pure, dependency-free so it's cheap to unit-test
// and safe to duplicate into app.js (classic script, no module loader —
// same precedent as bundleadjust.js/sensitivity.js).
//
// Relevance-gated (locked decision): a sponsor only surfaces when it's
// tagged for the selected role OR one of its keywords appears in the typed
// need — never forced onto an unrelated role or query. Role match wins over
// keyword match; returns at most one entry so the caller can enforce "one
// sponsored slot per view".
export function pickSponsor(sponsored, { role, needText } = {}) {
  for (const s of sponsored || []) {
    if (role && s.roles && s.roles.includes(role)) return s;
  }
  const text = (needText || "").toLowerCase();
  if (text) {
    for (const s of sponsored || []) {
      if (s.keywords && s.keywords.some((k) => text.includes(k))) return s;
    }
  }
  return null;
}
