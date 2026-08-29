// Cleans up display names for full-registry (RAG) connectors. Many registry
// entries carry no real `title`, so ingest.js falls back to the raw reverse-
// DNS `name` (e.g. "com.close/close-mcp") — shown verbatim that reads as
// broken, not polished. Pure, dependency-free, unit-tested.

// Trailing words that add no identity once we already know it's an MCP
// connector — stripped repeatedly (so "Propick Integration MCP" -> "Propick").
const GENERIC_SUFFIX_RE = /\s*[-–—]?\s*(mcp[\s-]?server|mcp|integration|connector|server)\s*$/i;

function stripGenericSuffixes(s) {
  let cur = s.trim();
  for (;;) {
    const next = cur.replace(GENERIC_SUFFIX_RE, "").trim();
    if (next === cur || !next) break;
    cur = next;
  }
  return cur || s.trim();
}

function titleCase(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Drops immediately-repeated words (case-insensitive) — a real quirk seen in
// registry names like "kaszek-kaszek-attio-mcp" (an author handle doubled).
function dedupeAdjacent(words) {
  const out = [];
  for (const w of words) {
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  return out;
}

// name examples: "com.close/close-mcp", "standalone-mcp" (no namespace).
function deriveFromName(name) {
  const lastSegment = (name || "").split("/").pop() || name || "";
  const words = lastSegment.split(/[-_]+/).filter(Boolean);
  const withoutBoilerplate = words.filter((w) => !/^(mcp|server)$/i.test(w));
  const chosen = withoutBoilerplate.length ? withoutBoilerplate : words;
  const deduped = dedupeAdjacent(chosen);
  return titleCase(deduped.join(" ") || lastSegment);
}

// entry: { name, title? }. A registry title identical to `name` means the
// registry never supplied a real one (see ingest.js `title: s.title || s.name`)
// — in that case derive a name from the reverse-DNS path instead of trusting it.
export function cleanDisplayName(entry) {
  const { name, title } = entry || {};
  if (title && name && title !== name) {
    return stripGenericSuffixes(title) || title.trim();
  }
  return deriveFromName(name || title || "");
}
