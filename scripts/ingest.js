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
const MIN_DESCRIPTION_LENGTH = 15;

// Obvious placeholder/test servers — conservative, whole-token match so we
// don't accidentally drop something like "sample-data-connector" that's real.
// Tune this once you've eyeballed what actually shows up (per the buildplan).
const JUNK_NAME_RE = /(^|[/.\-_])(test|example|demo|sample|hello-world|foo|placeholder)([/.\-_]|$)/i;

function isJunk(server) {
  if (JUNK_NAME_RE.test(server.name)) return true;
  if (server.title && JUNK_NAME_RE.test(server.title)) return true;
  return false;
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

  // 2. Filter: active status, real description, not an obvious placeholder.
  const kept = [];
  let droppedDeprecated = 0, droppedNoDesc = 0, droppedJunk = 0;
  for (const entry of byName.values()) {
    const s = entry.server;
    const meta = entry._meta["io.modelcontextprotocol.registry/official"];
    if (meta.status !== "active") { droppedDeprecated++; continue; }
    if (!s.description || s.description.trim().length < MIN_DESCRIPTION_LENGTH) { droppedNoDesc++; continue; }
    if (isJunk(s)) { droppedJunk++; continue; }
    kept.push(s);
  }

  console.log(`  Deduped to ${byName.size} latest versions.`);
  console.log(`  Dropped: ${droppedDeprecated} deprecated, ${droppedNoDesc} no/short description, ${droppedJunk} junk-pattern.`);
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
  const catalog = gated.map(toCatalogEntry);

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

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
