// Pure substring search over the full registry catalog, powering "browse the
// whole catalog" (unlike /api/recommend, which is semantic/LLM-driven). No
// embeddings, no network — instant, so it's cheap to call on every keystroke.
// Dependency-free (besides the pure displayname helper) so it's fast to
// unit-test with small fixtures instead of the full ~25k-entry catalog.

import { cleanDisplayName } from "./displayname.js";

const PREFIX_MATCH_SCORE = 100;
const NAME_MATCH_SCORE = 80;
const DESCRIPTION_MATCH_SCORE = 40;

// entries: catalog server objects (id, name, title?, description?).
// Returns [{ id, score }], highest first, capped at `limit`. Empty/blank
// query or no matches -> [].
export function searchCatalog(entries, query, limit = 20) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (const entry of entries) {
    const name = cleanDisplayName(entry).toLowerCase();
    const description = (entry.description || "").toLowerCase();
    const nameIdx = name.indexOf(q);
    const descIdx = description.indexOf(q);
    if (nameIdx === -1 && descIdx === -1) continue;

    const score = nameIdx === 0 ? PREFIX_MATCH_SCORE : nameIdx > 0 ? NAME_MATCH_SCORE : DESCRIPTION_MATCH_SCORE;
    scored.push({ id: entry.id, score, name });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ id, score }) => ({ id, score }));
}
