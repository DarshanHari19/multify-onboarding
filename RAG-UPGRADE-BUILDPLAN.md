# RAG Upgrade Buildplan — full-catalog connector retrieval

Referenced by `CLAUDE.md` under "In-progress upgrade." This is the concrete plan.

## Goal

Replace the free-text half of `/api/recommend` — currently `llmMatch()` /
`fallbackMatch()` in `server.js:87-148`, matched against the 20-entry hand-coded
`CONNECTORS` catalog in `public/taxonomy.js` — with a real retrieval pipeline over
the full MCP registry:

```
free text → embed query → cosine top-25 over full registry → OpenRouter re-rank/select/explain
          → validate ids against retrieved set → response
```

This gives the LLM a genuinely necessary job (choosing among real candidates at
real scale) instead of picking from 20 hand-picked options it could recite from
training data.

**What does NOT change:**
- `ROLES` bundles in `taxonomy.js` (deterministic, curated, editorial — untouched).
- `public/dashboard.html` / `dashboard.js` — do not touch while doing this work.
- Funnel event capture, `/api/metrics`, `/api/events` — unaffected.
- The `CONNECTORS` object in `taxonomy.js` stays as the small curated set used to
  render role bundles and their icons/categories. The registry catalog is a
  **separate, larger** dataset used only by the free-text path (see "Two
  catalogs" below).

## Two catalogs — don't merge them

- `taxonomy.CONNECTORS` (20 entries): powers role bundles, icons, `why` copy.
  Hand-curated, stays small, stays editorial.
- `data/catalog.json` (full registry, hundreds+ entries): powers free-text
  retrieval only. Ingested from `registry.modelcontextprotocol.io/v0/servers`.

A free-text match can return a registry server that has no entry in
`taxonomy.CONNECTORS`. The UI needs a render path for "connector we don't have
curated metadata for" (name + description from the registry entry itself,
generic icon). Flag this as a UI task, not a data-modeling problem — don't try
to force every registry hit into the `CONNECTORS` shape.

## Phase 1 — Ingest (`scripts/ingest.js` → `npm run ingest`)

- Fetch `https://registry.modelcontextprotocol.io/v0/servers`, cursor-paginate
  until exhausted.
- Quality gate, drop a server if:
  - description is empty/missing
  - name/description matches obvious test/example patterns (`test-`, `example-`,
    `-demo` — confirm exact filter once we see real registry data, don't guess
    the pattern set blind)
  - duplicate (same name+repo URL as an earlier entry — keep first)
- Write `data/catalog.json`: array of `{ id, name, description, repoUrl, ... }`.
  `id` must be stable across re-ingests (hash of name+repo, not array index) so
  `data/embeddings.json` doesn't silently desync from `catalog.json` after a
  re-run.
- No API key needed for this step.

## Phase 2 — Local embeddings (`scripts/build-index.js` → `npm run build-index`)

- `@xenova/transformers`, model `Xenova/all-MiniLM-L6-v2`, 384-dim.
- Embed `name + description` (confirm the exact concatenation once ingest data
  is in hand — description quality varies a lot across the real registry).
- Write `data/embeddings.json`: `{ id, vector }[]`, `id` matching `catalog.json`.
- Both `data/*.json` are generated artifacts — gitignore them, document the two
  npm commands as the regeneration path (already stated in `CLAUDE.md`'s Run
  section).

## Phase 3 — Retrieval (in-process, server-side)

- On server boot: load `catalog.json` + `embeddings.json` into memory (this is
  the "graceful fallback: missing embeddings cache" case in `CLAUDE.md` — if
  either file is absent, log the `npm run ingest && npm run build-index`
  message and disable the RAG path, falling back to the existing
  `fallbackMatch()` keyword matcher, not crashing).
- On each `/api/recommend` call: embed the query text with the same local model,
  cosine-rank against all catalog vectors, take top 25.
- This replaces `catalogForPrompt()` (`server.js:81-85`), which currently dumps
  the entire small catalog into the prompt — at registry scale that dump
  becomes the top-25 retrieved candidates instead of everything.

## Phase 4 — LLM re-rank (OpenRouter)

- Reuse the existing OpenRouter call shape (`server.js:107-135`) but:
  - prompt is grounded ONLY in the 25 retrieved candidates, not the full catalog
  - system prompt asks for id + one-line "why", not just ids (mirrors the
    `why` field role bundles already have, so free-text results and role-bundle
    results render consistently in the UI)
  - **validate the model's returned ids against the retrieved-candidate set**
    (not just "any known catalog id" — `parseIdArray()` at `server.js:96-105`
    currently checks `CONNECTORS[id]`, which is the wrong set once the catalog
    is the registry; it must check against the top-25 candidate ids for this
    request). Drop anything else — this is the anti-hallucination gate called
    out in `CLAUDE.md`.
- No key → same fallback behavior as today (`fallback-nokey` source), but the
  fallback matcher should run against the registry catalog via keyword-in-name
  matching, not vanish just because the LLM path is unavailable — otherwise the
  no-key deployment gets *worse* on this upgrade than it is today.

## Phase 5 — Risk gate for RAG results (new, not in `CLAUDE.md` yet — decide before building)

`CLAUDE.md`'s auto-enable rule was written for the curated 20-entry catalog,
where every entry was manually risk-reviewed. The registry has hundreds of
servers nobody has reviewed for sensitivity. Proposed rule: **any connector
surfaced via the free-text/RAG path is always "suggested," never auto-enabled**,
regardless of what the LLM says about it — only role-bundle entries (still
hand-curated in `taxonomy.js`) can be auto-enabled. This is a stricter version
of the existing risk gate, not a new mechanism. Confirm with the user before
implementing — it's a product decision, not just an implementation detail.

## Phase 6 — Wiring into `server.js`

- New deps in `package.json`: `@xenova/transformers`; nothing else needed
  (registry fetch and OpenRouter calls use built-in `fetch`).
- New scripts: `"ingest": "node scripts/ingest.js"`,
  `"build-index": "node scripts/build-index.js"`.
- `/api/recommend` response shape gains fields but should stay
  backward-compatible with `app.js` where reasonable (check `app.js` for exactly
  what it reads off the response before changing shape).

## Testing (TDD per `CLAUDE.md` conventions)

Write failing tests first for the two pieces of real logic:
1. **Retriever**: given a small fixture catalog + embeddings, cosine-rank
   returns expected top-N ordering.
2. **Re-rank validator**: given a fixture "LLM response" containing a mix of
   valid candidate ids, out-of-candidate-set ids, and malformed JSON, the
   validator keeps only ids present in the candidate set.
No test runner is in `package.json` yet — pick one (`node:test` is dependency-free
and fits this project's zero-build-step philosophy) before writing tests.

## Suggested build order

1. `scripts/ingest.js` + confirm real registry data shape (quality-gate rules
   may need adjusting once real data is visible — don't over-design the filter
   set from spec alone).
2. `scripts/build-index.js`.
3. Retriever module + tests.
4. Wire retriever into `/api/recommend` behind the existing fallback structure.
5. Re-rank prompt + validator + tests.
6. Risk-gate decision (Phase 5) — confirm with user, then implement in the
   response shape / `app.js` render logic.
7. Update `README.md` run instructions and `CLAUDE.md` if any locked decision
   changes shape during implementation.

## Open questions to resolve with the user before/during implementation

- Exact quality-gate filter patterns for Phase 1 (need real registry data first).
- Whether free-text/RAG results ever get curated into `taxonomy.CONNECTORS`
  over time (the methodology doc mentions a data-driven feedback loop from the
  dashboard — is that in scope now or later?).
- Phase 5 risk-gate rule — needs explicit sign-off, it's a behavior change users
  will notice (fewer things pre-enabled from free text than before).
