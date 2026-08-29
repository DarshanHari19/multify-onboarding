# Flywheel + Live Session Visibility — Design

Date: 2026-08-29
Status: approved, pending implementation plan

## Context

The recommender (`public/index.html`/`app.js`) and the attribution dashboard
(`public/dashboard.html`/`dashboard.js`) are currently two features that share
a backend. This work makes them visibly *one loop*: the dashboard's event
data justifies the recommender's role bundles (the "flywheel"), and a demo
user's own actions are unmistakable against the large seeded baseline (the
"live visibility" pairing). See `CLAUDE.md` for full project context and
`RAG-UPGRADE-BUILDPLAN.md` for the RAG pipeline this builds on top of.

## Pre-flight verification (done during brainstorming, not part of this build)

Confirmed against the actual repo before designing:

- Part 2a ("this session" counter) is **already built**: `liveSummary` in
  `GET /api/metrics` (server.js) + the "Live this session" dashboard panel
  with pulse-on-increase (`dashboard.js` `renderLiveStats`). Not touched here.
- All "known pending polish" items from the handoff are **already done**:
  display-name cleanup (`lib/displayname.js`), quality gate
  (`scripts/ingest.js`), RAG picks capped to 4 (`lib/rerank.js`
  `MAX_PICKS`), first-win semantic dedupe (`lib/firstwin.js`). Not touched
  here.
- `lib/affinity.js` and any `/api/affinity` or `/api/activity` endpoint do
  **not** exist yet — this build creates them.

This spec therefore covers only: Part 1 (flywheel) in full, and Part 2b
(activity ticker) — Part 2's counter half needs no work. Part 1 Step 4
("data-influenced bundles") is explicitly deferred, per the original ask.

## Part 1 — Flywheel

### Step 1: Realistic role→connector seed bias (`server.js`)

Today `seedBaseline()` assigns a uniformly random role to each `recommended`
event (`server.js:94`), and every connector's funnel-stage probabilities
depend only on a per-connector `APPEAL` value and the onboarding/in-chat
`surfaceBoost` — never on role. Result: connect-rate is flat across roles for
any given connector, so a per-role affinity metric would show no spread.

**Mechanism.** Add a `roleFit(role, id)` multiplier, looked up from the
existing `ROLES[role].bundle` in `taxonomy.js`:

- `1.8` base if `id` is an `auto: true` entry in that role's bundle
- `1.3` base if `id` is an `auto: false` (suggested) entry in that role's bundle
- `0.6` base if `id` is not in that role's bundle at all (softened from an
  earlier 0.4 — non-fit connectors should read as "lower," not "near-zero,"
  per review feedback)

**Jitter (per review feedback).** A flat multiplier ladder makes every
auto-fit connector in a role land at nearly the same rate (e.g. four ~79%s
for Sales), which reads as synthetic. Before `seedBaseline()` runs, precompute
a deterministic jitter table using the existing seeded `rand()` sequence:

```js
const fitJitter = {}; // `${role}:${id}` -> multiplier
for (const role of ROLE_KEYS)
  for (const id of Object.keys(CONNECTORS))
    fitJitter[`${role}:${id}`] = 0.88 + rand() * 0.24; // ±12%
```

`roleFit(role, id)` returns `base * fitJitter[\`${role}:${id}\`]`. This must
run (and consume `rand()` calls) in a fixed, documented position relative to
the existing `APPEAL` computation and `seedBaseline()` call, so the seed
stays fully deterministic run-to-run (same principle as the existing
`mulberry32(42)` comment).

**Applying the multiplier.** Multiply `roleFit(role, id)` into each of the
three funnel-stage probabilities inside `seedBaseline()`'s inner loop (click
rate, signup rate, connect rate), each clamped to `Math.min(1, ...)`. Worked
example at `APPEAL≈0.5`, onboarding surface: Sales+HubSpot (auto, fit≈1.8×
jitter) lands around 70–89% recommended→connected depending on jitter draw;
a non-fit role+HubSpot (fit≈0.6× jitter) lands around 4–9%. `activated` stays
governed by the existing flat 0.6 rate — not part of this metric, left alone.

**Coverage check (per review feedback — do not just eyeball one role card).**
After implementing the bias, explicitly enumerate all 30 curated
`(role, connector-in-bundle)` pairs (6 roles × 5 bundle entries each) and
assert `recommended count >= 20` for every one, using the real seeded event
data. If any pair falls short, raise the seed volume (e.g. widen the
`recs = Math.round(3 + rand()*9)` range in `seedBaseline`) rather than
special-casing — this must hold generally, not just for Sales. Do this as
part of implementation (a one-off check script or an assertion in the
affinity test setup), not as a manual spot-check.

### Step 2: `lib/affinity.js` + `GET /api/affinity?role=`

New pure helper, TDD (`test/affinity.test.js` first, following the existing
`lib/retriever.js`/`lib/rerank.js` pattern of dependency-free pure functions
over fixture event arrays):

```js
// roleConnectorRates(events, role) -> { [connectorId]: { recommended, connected, rate, n } }
```

- Filters to `e.role === role` only.
- Counts `recommended` and `connected` stage events per `connectorId`.
- `n` = recommended count (sample size, for the client's confidence gate).
- `rate` = `connected / recommended` (0 if `recommended === 0`).
- Ignore feedback-stage events (`feedback_up`/`feedback_down`) entirely —
  same convention `/api/metrics` already uses via `STAGES`.

Exposed as its own endpoint, **`GET /api/affinity?role=<key>`**, rather than
folded into `/api/metrics`: it's queried from the recommender page (a
different surface/lifecycle than the dashboard's metrics poll) and doesn't
need funnel/series/feedback data alongside it. Validate `role` against
`ROLE_KEYS`; unknown/missing role → `{}`.

### Step 3: Recommender UI cue (`app.js`)

When `pickRole(key)` runs (including via the `/api/infer-role` path, which
already calls `pickRole` internally), fetch `/api/affinity?role=<key>` once
per role selection and cache the result. `renderConnectors()` shows a small
muted line under any row where the affinity entry has `n >= 20`:

> "78% of Sales users who saw this connected it · based on connection data,
> illustrative"

(Wording fixed per review — the metric is `connected/recommended` i.e. "of
those shown it," not "of all Sales users," so the copy says that explicitly.)
Rows with `n < 20` (or no affinity entry — e.g. RAG/free-text adds) show no
cue; no extra filtering logic needed since those naturally have low/no
role-scoped `recommended` counts. Style: reuse existing muted/small text
tokens, same visual weight as the existing retrieval-transparency line.

### Step 4 — deferred

Not built now. Ordering bundles by connect-rate or promoting a suggested
connector to auto-enable based on role-rate crossing a threshold — explicitly
optional/deferred per the original ask, and would still need to respect the
risk gate (sensitive connectors never auto-enable regardless of rate).

## Part 2b — Live activity ticker

### Server (`server.js`)

- Give every event a stable incrementing id at push time: `let nextEventId = 1`
  inside `push()`, so the client can diff "seen before" vs "new since last
  poll" without relying on array position or timestamp collisions.
- Add `recentLive` to the existing `GET /api/metrics` response: the last 10
  **funnel-stage** (not feedback-stage) events where `live === true`, newest
  first, built from the already-filtered `rows` (so it respects the existing
  `?connector=&role=&surface=` filters same as everything else in that
  handler). Each item: `{ id, stage, connectorId, name, ico, ts }` — `name`/
  `ico` resolved via the existing module-level `DISPLAY` lookup so RAG-surfaced
  connectors render correctly too, same as `connectorTable` does today.
- No new endpoint — bundling into `/api/metrics` keeps the ticker on the same
  4s poll cadence as the "Live this session" counter it pairs with, so both
  update in the same tick.

### Dashboard (`dashboard.js` / `dashboard.html`)

- New "Activity" panel directly below the existing "Live this session" panel,
  reusing `.panel` and existing tokens — no nested scroll, cap rendered rows
  at 10 (matches `recentLive`'s cap).
- Row format: inline SVG icon (from `DISPLAY`/connector metadata, no emoji) +
  `"{stage label} {connector name}"` + a relative timestamp.
- **Relative timestamps, not "just now" on every row** (per review feedback):
  compute client-side from each item's `ts` — "just now" (<30s), "Xm ago",
  falling back to a short absolute time past ~1h. Recomputed on every 4s
  poll tick so rows age visibly without needing their own timer.
- Pulse: same pattern already used for `renderLiveStats` (diff current
  `recentLive` ids against the previous poll's ids, add a pulse class to any
  row whose id wasn't seen last tick — no `setTimeout`, consistent with the
  existing no-timer pulse convention in this file). Not cross-wiring this to
  also pulse the KPI/counter row — descoped as an optional nice-to-have not
  explicitly requested.

## Testing / verification plan

- `npm test` green: existing 47 tests + new `test/affinity.test.js`.
- Seed bias: the coverage check above (all 30 curated pairs, `n >= 20`)
  passes; spot-check that Sales' four auto connectors show *different*
  percentages (jitter working), and that a non-fit role+connector shows a
  visibly lower but non-negligible percentage (softened floor working).
- Flywheel UI: pick each of the 6 roles in turn (not just Sales) → curated
  connectors show a computed cue with the corrected wording; low-`n` rows
  (RAG adds) show none.
- Session counter (already built, just confirm untouched): connecting a
  connector still increments "Live this session" within one 4s poll.
- Ticker: the same connect action appears in "Activity" as a new pulsed row
  with an accurate relative timestamp; older rows show progressively older
  relative times, not all "just now."
- Space out `/api/recommend` and `/api/infer-role` calls during manual
  testing (OpenRouter 429s under bursts) — the affinity endpoint itself makes
  no LLM call, so it's not subject to this, but the role-inference path used
  to reach `pickRole` is.

## Commit discipline

Small, focused commits, one per step (seed bias / affinity lib+endpoint /
recommender cue / event ids+recentLive / ticker UI). No ticket-key
requirement for this project (removed from global git conventions per user
request 2026-08-29).
