# CLAUDE.md — Multify Onboarding Recommender

Persistent context for Claude Code. Read this first, every session.

---

## What this project is
A working prototype of two connected ideas proposed for **Multify** (an AI-agent
platform whose business model is connector lead-gen: it recommends MCP connectors,
users create accounts with those services to connect them, and each account
creation is a monetizable lead).

1. **Smart connector onboarding recommender** — catches users at onboarding
   (lowest-friction, highest-intent) and pre-selects the connectors that fit their
   role and stated needs, auto-enabled and ready.
2. **Partner attribution dashboard** — the "measurement layer": turns connector
   recommendations into a measurable lead-gen funnel and proves value to connector
   partners (recommended → clicked → signed up → connected → activated).

## Strategic thesis (why this matters / how to pitch it)
- MCP *discovery* is already commoditized (AllInOneMCP, MCP Compass, Obot/Bifrost,
  the spec's Progressive Discovery). So the value is NOT the recommendation
  algorithm — it's the **onboarding placement + activation framing + the
  measurement layer that proves lead-gen to partners.**
- Dev discovery tools MINIMIZE connections (context efficiency); Multify's business
  wants to MAXIMIZE activations. Onboarding role-bundling aligns with the business
  in a way off-the-shelf tools don't.
- The measurement layer doubles as an **advertiser-facing attribution product**
  (like Google/Meta ads reporting) — the real B2B revenue unlock.

---

## Current architecture (what exists — build ON this)
- `server.js` — Express. Endpoints: `/api/recommend` (RAG + curated fallback),
  `/api/events` (funnel capture, registry-safe via a merged `DISPLAY` lookup),
  `/api/metrics` (dashboard data), `/api/health`. Seeds realistic baseline funnel
  events on boot (in-memory).
- `lib/embedder.js`, `lib/retriever.js`, `lib/rag.js`, `lib/rerank.js` — the RAG
  pipeline (see below). `lib/retriever.js` and `lib/rerank.js`'s pure functions
  are dependency-free on purpose, for fast unit tests (`test/*.test.js`, run via
  `npm test`).
- `scripts/ingest.js`, `scripts/build-index.js` — one-time offline generators for
  `data/catalog.json` / `data/embeddings.json` (gitignored — regenerate via
  `npm run ingest && npm run build-index`, never at demo/request time).
- `public/taxonomy.js` — the reusable "brain": CONNECTORS catalog (20 curated,
  icons are local SVG paths under `public/icons/connectors/`), ROLES bundles
  (icons are inline Lucide SVG strings), FALLBACK_INTENTS. Loaded by BOTH server
  (globalThis.TAXONOMY) and browser.
- `public/index.html` + `app.js` — recommender UI; renders connectors straight
  from the `/api/recommend` payload (works for curated AND full-registry
  results — falls back to `TAXONOMY.CONNECTORS` only when the payload omits
  metadata, i.e. role bundles); fires funnel events.
- `public/dashboard.html` + `dashboard.js` — live attribution dashboard
  (Chart.js; colors are read from CSS custom properties at chart-build time so
  it stays theme-aware).
- `public/styles.css` (shared by both pages) + `public/theme.js` — design tokens,
  fonts (Krona One / Instrument Sans), and shapes match **Multify's real brand**,
  pulled directly from multify.co's own CSS (monochrome, sharp-edged, dark/light
  via `[data-theme]`). Don't reintroduce a purple/cyan gradient or emoji icons.
  `theme.js` handles the dark/light toggle + fires a `themechange` event.
- **Don't touch dashboard *logic* while working on the recommender engine** —
  restyling both pages together (as already done for the brand pass) is fine;
  mixing funnel/metrics logic changes into unrelated recommender work is not.

## RAG upgrade — built (see RAG-UPGRADE-BUILDPLAN.md for the original plan)
Full-catalog RAG has replaced the small hand-coded free-text engine: ingest the
entire MCP registry (~25k active servers after quality-gating, ~24,941 as of
last ingest) → local `all-MiniLM-L6-v2` embeddings → in-memory cosine retrieval
(top 25) → OpenRouter LLM re-ranks/selects/explains, grounded ONLY in those 25,
with ids validated against the retrieved set (hallucinations dropped) and a
timeout (~9s) that falls back to raw vector top-hits so a request never hangs.
Falls back further to the curated keyword matcher if the catalog or an
OpenRouter key is missing. **Still open:** demo-polish (loading state, curated
example queries, a retrieval-transparency line in the UI).

## Locked decisions (do not re-litigate)
- Catalog source: official MCP Registry API (`registry.modelcontextprotocol.io/v0/servers`, cursor-paginated).
- Scope: full registry + quality gate (non-empty description, dedupe, drop test servers).
- Embeddings: LOCAL `@xenova/transformers` `Xenova/all-MiniLM-L6-v2` (384-dim), cached to disk. No embedding API key.
- Vector store: in-memory cosine now; MongoDB Atlas vector search named as the production path.
- LLM re-rank: OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`).
- One key only (OpenRouter). Embeddings are local so no second key.

---

## Taxonomy methodology (how role → connector bundles are decided)
Deciding **which connectors belong to a role**, strongest signal first:
1. **Data-driven** — connectors users in that role actually connect + use, sourced
   from the measurement layer. (The dashboard feeds the taxonomy — closed loop.)
2. **Semantic** — define each role by canonical tasks, embed them, run through the
   RAG retriever to auto-generate candidate bundles; human-curate the head.
3. **Editorial** — hand-pick the obvious head; partner/monetization priorities may
   influence ORDERING, transparently.

Deciding **auto-enabled vs suggested (off by default)**, score each on:
- Relevance to the role · Breadth of usefulness · Risk/sensitivity · Conversion data.
- Rule: **auto-enable high-relevance + broad + LOW-RISK connectors only.**
  NEVER auto-enable anything touching sensitive data (finances, email, full drive)
  without explicit opt-in. Everything else defaults to suggested. This risk gate is
  both good product sense and consistent with the project's privacy stance.
- **Extension (locked):** any connector surfaced via the free-text/RAG path is
  ALWAYS suggested, never auto-enabled — regardless of role or LLM confidence.
  Only hand-curated role-bundle entries in `taxonomy.js` may auto-enable, since
  the full registry has no risk review, unlike the curated catalog. Implemented
  in `server.js` as `suggested: true` on every `/api/recommend` result.

---

## What's REAL vs ILLUSTRATIVE (be honest in code + docs)
- REAL: the recommender engine, the RAG pipeline, the live LLM call, the funnel
  event logic, the registry catalog.
- ILLUSTRATIVE: the seeded baseline dashboard numbers, the $/lead value, the
  role bundles (curated, not yet data-driven). Do not claim these use Multify's
  real internal data — the catalog is the public MCP registry, a proxy for
  Multify's "connects to any public API" universe.

## Conventions
- TDD where practical: failing test first for logic (retriever, re-rank validation).
- NEVER put secrets/API keys in frontend code — server-side only. `.env` git-ignored.
- Small, focused commits — one logical change each. Stop and show diffs on request.
- The LLM re-rank must NEVER return a connector id outside the retrieved candidate
  set — validate and drop hallucinated ids.
- Graceful fallback: no key → return top vector hits; missing embeddings cache →
  print a clear "run npm run ingest && npm run build-index" message, don't crash.
- Space out `/api/recommend` test calls during dev — OpenRouter/DeepSeek 429s
  under bursty testing (10+ requests in ~2 min observed). The fallback ladder
  handles it fine (`source: "rag-vector-fallback"`), but you want `"rag-llm"`
  responses for realistic testing.

## Run
```
npm install
npm run ingest        # one-time: fetch + quality-gate the registry -> data/catalog.json
npm run build-index   # one-time: embed catalog locally -> data/embeddings.json
cp .env.example .env  # add OPENROUTER_API_KEY
npm start             # recommender at /, dashboard at /dashboard.html
```

## Not production
In-memory stores reset on restart; no auth. Real-world blockers documented in the
dashboard's methodology panel: net-new-lead detection, attribution/incrementality,
and the privacy/CCPA "sale" question around sharing individual lead data. Not legal advice.
