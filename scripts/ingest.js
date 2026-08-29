// Ingest the official MCP Registry into data/catalog.json — the full-registry
// half of the RAG upgrade (see RAG-UPGRADE-BUILDPLAN.md). Run once (or whenever
// you want fresher data): `npm run ingest`. Re-run `npm run build-index`
// afterwards so the embeddings stay in sync.
//
// Registry shape (confirmed against the live API, 2026):
//   GET https://registry.modelcontextprotocol.io/v0/servers?cursor=...&limit=100
//   -> { servers: [{ server: {...}, _meta: {...} }], metadata: { nextCursor, count } }
//
// Each `server`: { name, description, title?, version, repository?: {url,source},
//   websiteUrl?, remotes?: [{type,url}], packages?: [{registryType,identifier,...}] }
// `_meta["io.modelcontextprotocol.registry/official"]`: { status, isLatest }
//
// Same logical server appears once per published VERSION — `name` is the stable
// logical id across versions, not `name`+version. Dedupe on `name`, keep only
// the entry with isLatest === true.

import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "catalog.json");
const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const PAGE_LIMIT = 100;
const MIN_DESCRIPTION_LENGTH = 25;
const MIN_DESCRIPTION_WORDS = 4;

// Obvious placeholder/test servers — conservative, whole-token match so we
// don't accidentally drop something like "sample-data-connector" that's real.
// Tune this once you've eyeballed what actually shows up (per the buildplan).
const JUNK_NAME_RE = /(^|[/.\-_])(test|example|demo|sample|hello-world|foo|placeholder)([/.\-_]|$)/i;

function isJunk(server) {
  if (JUNK_NAME_RE.test(server.name)) return true;
  if (server.title && JUNK_NAME_RE.test(server.title)) return true;
  return false;
}

// A title that's just a bare category word with no product identity — e.g.
// "CRM" — is exactly the junk a quality gate should drop, even with a
// legitimate description. Whole-string match only, so a real product name
// that happens to CONTAIN a generic word ("HubSpot CRM", "Email Wizard") is
// never penalized.
const GENERIC_TITLES = new Set([
  "crm", "email", "mail", "api", "server", "tool", "assistant", "agent",
  "bot", "service", "app", "platform", "system", "dashboard", "integration",
  "connector", "client", "sdk", "plugin", "extension", "widget", "mcp",
  "database", "analytics",
]);
export function isGenericTitle(title) {
  return GENERIC_TITLES.has((title || "").trim().toLowerCase());
}

// Length alone lets through padded-but-empty descriptions ("word word word
// word word."); also require a minimum number of real words.
export function isThinDescription(description) {
  const d = (description || "").trim();
  if (d.length < MIN_DESCRIPTION_LENGTH) return true;
  if (d.split(/\s+/).filter(Boolean).length < MIN_DESCRIPTION_WORDS) return true;
  return false;
}

// Multiple registry mirrors (smithery, github, etc.) often republish the same
// underlying repo — sometimes with a beta/alpha variant too. Collapse those
// to one entry, preferring a real (non-raw-name) title, then a non-beta
// version, then the longer/more descriptive one.
const PRERELEASE_RE = /beta|alpha|canary|nightly|-rc\d*$/i;
function isBetterCatalogEntry(a, b) {
  const aReal = a.title !== a.name, bReal = b.title !== b.name;
  if (aReal !== bReal) return aReal;
  const aPre = PRERELEASE_RE.test(a.name), bPre = PRERELEASE_RE.test(b.name);
  if (aPre !== bPre) return !aPre;
  return (a.description?.length || 0) > (b.description?.length || 0);
}
export function dedupeByRepo(catalogEntries) {
  const byRepo = new Map();
  const noRepo = [];
  for (const entry of catalogEntries) {
    if (!entry.repoUrl) { noRepo.push(entry); continue; }
    const key = entry.repoUrl.toLowerCase();
    const existing = byRepo.get(key);
    if (!existing || isBetterCatalogEntry(entry, existing)) byRepo.set(key, entry);
  }
  return [...byRepo.values(), ...noRepo];
}

// Stable id derived from the registry's own stable key (`name`), not array
// position — so re-ingesting never desyncs data/embeddings.json ids.
function stableId(name) {
  return createHash("sha1").update(name).digest("hex").slice(0, 12);
}

async function fetchAllPages() {
  const all = [];
  let cursor;
  let page = 0;
  for (;;) {
    const url = new URL(REGISTRY_BASE);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();

    all.push(...(data.servers || []));
    page++;
    if (page % 10 === 0) process.stdout.write(`  ...${all.length} entries fetched (page ${page})\n`);

    cursor = data.metadata?.nextCursor;
    if (!cursor || !data.servers?.length) break;
  }
  return all;
}

function qualityGate(entries) {
  // 1. Dedupe by logical name, keep only isLatest.
  const byName = new Map();
  for (const entry of entries) {
    const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
    if (!meta?.isLatest) continue;
    byName.set(entry.server.name, entry);
  }

  // 2. Filter: active status, real description, not an obvious placeholder,
  //    not a bare generic title ("CRM" with no product identity).
  const kept = [];
  let droppedDeprecated = 0, droppedNoDesc = 0, droppedJunk = 0, droppedGeneric = 0;
  for (const entry of byName.values()) {
    const s = entry.server;
    const meta = entry._meta["io.modelcontextprotocol.registry/official"];
    if (meta.status !== "active") { droppedDeprecated++; continue; }
    if (isThinDescription(s.description)) { droppedNoDesc++; continue; }
    if (isJunk(s)) { droppedJunk++; continue; }
    if (isGenericTitle(s.title)) { droppedGeneric++; continue; }
    kept.push(s);
  }

  console.log(`  Deduped to ${byName.size} latest versions.`);
  console.log(`  Dropped: ${droppedDeprecated} deprecated, ${droppedNoDesc} thin description, ${droppedJunk} junk-pattern, ${droppedGeneric} generic title.`);
  return kept;
}

function toCatalogEntry(s) {
  return {
    id: stableId(s.name),
    name: s.name,
    title: s.title || s.name,
    description: s.description,
    version: s.version,
    repoUrl: s.repository?.url || null,
    websiteUrl: s.websiteUrl || null,
    installKind: s.remotes ? "remote" : s.packages ? "package" : "unknown",
  };
}

async function main() {
  console.log(`Fetching MCP Registry from ${REGISTRY_BASE} ...`);
  const raw = await fetchAllPages();
  console.log(`Fetched ${raw.length} total (name, version) entries.`);

  const gated = qualityGate(raw);
  const beforeDedupe = gated.length;
  const catalog = dedupeByRepo(gated.map(toCatalogEntry));
  console.log(`  Deduped ${beforeDedupe - catalog.length} repo-duplicate republishes (e.g. registry mirrors, beta variants).`);

  // Guard against id collisions (extremely unlikely with a 12-hex-char sha1
  // prefix, but cheap to check).
  const seen = new Set();
  for (const c of catalog) {
    if (seen.has(c.id)) throw new Error(`id collision on ${c.id} (${c.name}) — widen stableId()`);
    seen.add(c.id);
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ ingestedAt: new Date().toISOString(), count: catalog.length, servers: catalog }, null, 2)
  );
  console.log(`\nWrote ${catalog.length} quality-gated servers to ${OUT_PATH}`);
  console.log(`Next: npm run build-index`);
}

// Guarded so `import { isGenericTitle, ... } from "./ingest.js"` in tests
// never triggers a live registry fetch — only `node scripts/ingest.js` /
// `npm run ingest` runs main().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Ingest failed:", err);
    process.exit(1);
  });
}
