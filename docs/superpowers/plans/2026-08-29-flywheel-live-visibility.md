# Flywheel + Live Session Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recommender's role bundles and the attribution dashboard visibly one self-improving loop — a computed per-role connect-rate cue on each curated connector (the "flywheel"), and a live activity ticker that proves a demo user's own actions are moving the numbers in real time (the "live visibility" pairing).

**Architecture:** Two new pure `lib/*.js` helpers (`rolefit.js`, `affinity.js`), TDD'd against `node:test` fixtures exactly like the existing `lib/retriever.js`/`lib/feedback.js`. `server.js`'s seeded baseline generator gets a role-fit multiplier (with deterministic jitter) so per-role connect-rates actually diverge; a new `GET /api/affinity?role=` endpoint and a `recentLive` field on the existing `GET /api/metrics` expose that data. `app.js` and `dashboard.js` render it — a muted cue line under bundle connectors, and a small "Activity" panel with relative timestamps and a pulse-on-new-row.

**Tech Stack:** Node.js (ESM, `"type": "module"`), Express, `node:test` + `node:assert/strict`, vanilla JS/CSS on the client (no build step, no frameworks) — matches the existing codebase exactly.

**Spec:** `docs/superpowers/specs/2026-08-29-flywheel-live-visibility-design.md`

## Global Constraints

- Seeding stays fully deterministic: everything derives from `mulberry32(42)`; any new `rand()` consumption must happen in a fixed, documented position relative to existing consumption (`APPEAL`, then seed generation) so re-running produces the same events.
- No emoji anywhere in new UI — inline SVG icons only (existing `ICONS` in `taxonomy.js`, or the connector's own icon).
- TDD for every new pure `lib/*.js` function: failing test first, then implementation.
- Every new "computed" number must actually be computed from real event data — never hardcoded — and must carry an honest "illustrative" label per `CLAUDE.md`'s REAL-vs-ILLUSTRATIVE rule.
- The affinity cue only renders when sample size `n >= 20`; below that, render nothing (no cue), never a low-confidence number.
- The activity feed and any list built from `recentLive` caps at 10 items, no nested scroll.
- No JIRA/ticket-key requirement for commits or branches (removed from this user's global git conventions on 2026-08-29) — plain conventional commit messages are fine.
- Small, focused commits — one per task below.

---

## File Structure

- `lib/rolefit.js` (new) — pure per-`(role, connector)` fit multiplier + deterministic jitter table. No imports, no I/O.
- `lib/affinity.js` (new) — pure per-role connect-rate aggregation over the existing event shape. No imports, no I/O.
- `test/rolefit.test.js` (new)
- `test/affinity.test.js` (new)
- `server.js` (modify) — import both new libs; bias `seedBaseline()`'s funnel probabilities by role fit; give every event a stable `id`; add `GET /api/affinity?role=`; add `recentLive` to `GET /api/metrics`.
- `scripts/check-affinity-coverage.js` (new) — one-off dev script (same category as `scripts/ingest.js`) that hits the running server's `/api/affinity` for all 6 roles and asserts every curated bundle connector clears `n >= 20`.
- `public/app.js` (modify) — fetch affinity per role selection; render the cue in `renderConnectors()`.
- `public/dashboard.js` (modify) — render the new `recentLive` field as an "Activity" panel with relative timestamps and pulse-on-new-row.
- `public/dashboard.html` (modify) — add the "Activity" panel markup.
- `public/styles.css` (modify) — `.affinity-cue`, `.activity-feed`/`.activity-row`/`.pulse`/`@keyframes rowpulse`.

---

### Task 1: `lib/rolefit.js` — role-fit multiplier + deterministic jitter

**Files:**
- Create: `lib/rolefit.js`
- Create: `test/rolefit.test.js`

**Interfaces:**
- Produces: `roleFitBase(role, id, roles) -> number`, `buildFitJitterTable(roleKeys, connectorIds, rand) -> { "<role>:<id>": number }`, `roleFit(role, id, roles, jitterTable) -> number`, `FIT_BASE` (`{ auto, suggested, none }`) — all consumed by `server.js` in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `test/rolefit.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleFitBase, buildFitJitterTable, roleFit, FIT_BASE } from "../lib/rolefit.js";

const ROLES = {
  sales: { bundle: [
    { id: "hubspot", auto: true },
    { id: "slack", auto: false },
  ] },
  engineer: { bundle: [
    { id: "github", auto: true },
  ] },
};

test("roleFitBase returns the auto base for an auto-enabled bundle entry", () => {
  assert.equal(roleFitBase("sales", "hubspot", ROLES), FIT_BASE.auto);
});

test("roleFitBase returns the suggested base for a non-auto bundle entry", () => {
  assert.equal(roleFitBase("sales", "slack", ROLES), FIT_BASE.suggested);
});

test("roleFitBase returns the none base for a connector outside the role's bundle", () => {
  assert.equal(roleFitBase("sales", "github", ROLES), FIT_BASE.none);
});

test("roleFitBase returns the none base for an unknown role", () => {
  assert.equal(roleFitBase("unknown", "hubspot", ROLES), FIT_BASE.none);
});

test("buildFitJitterTable is deterministic for a deterministic rand function", () => {
  const seq = [0.1, 0.9, 0.5, 0.2];
  let i = 0;
  const rand = () => seq[i++ % seq.length];
  const table1 = buildFitJitterTable(["sales", "engineer"], ["hubspot", "github"], rand);
  i = 0;
  const table2 = buildFitJitterTable(["sales", "engineer"], ["hubspot", "github"], rand);
  assert.deepEqual(table1, table2);
});

test("buildFitJitterTable keeps every multiplier within the +/-12% band", () => {
  const rand = () => Math.random();
  const table = buildFitJitterTable(["sales"], ["hubspot", "slack"], rand);
  for (const v of Object.values(table)) {
    assert.ok(v >= 0.88 && v <= 1.12, `jitter ${v} out of band`);
  }
});

test("roleFit multiplies the base by the jitter for that exact role:id pair", () => {
  const jitterTable = { "sales:hubspot": 1.1 };
  assert.equal(roleFit("sales", "hubspot", ROLES, jitterTable), FIT_BASE.auto * 1.1);
});

test("roleFit defaults jitter to 1 when the pair is missing from the table", () => {
  assert.equal(roleFit("sales", "hubspot", ROLES, {}), FIT_BASE.auto);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rolefit.test.js`
Expected: FAIL — `Cannot find module '../lib/rolefit.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/rolefit.js`:

```js
// Per-(role, connector) fit multiplier for the seeded baseline (server.js
// seedBaseline) — the flywheel's data-generation half. Pure and
// dependency-free, same convention as lib/retriever.js and lib/feedback.js.
//
// base: how well a connector fits a role, from the curated bundle in
// taxonomy.js (auto-enabled > suggested > not-in-bundle-at-all).
// jitter: a deterministic per-(role, id) multiplier so every connector in a
// role doesn't land at the exact same rate (would read as synthetic) —
// generated once from the SAME seeded rand() the rest of seeding uses, so
// the whole seed stays reproducible.

export const FIT_BASE = { auto: 1.8, suggested: 1.3, none: 0.6 };
const JITTER_MIN = 0.88;
const JITTER_RANGE = 0.24; // multiplier lands in [0.88, 1.12] — a +/-12% band

export function roleFitBase(role, id, roles) {
  const bundle = (roles[role] && roles[role].bundle) || [];
  const entry = bundle.find((b) => b.id === id);
  if (!entry) return FIT_BASE.none;
  return entry.auto ? FIT_BASE.auto : FIT_BASE.suggested;
}

export function buildFitJitterTable(roleKeys, connectorIds, rand) {
  const table = {};
  for (const role of roleKeys) {
    for (const id of connectorIds) {
      table[`${role}:${id}`] = JITTER_MIN + rand() * JITTER_RANGE;
    }
  }
  return table;
}

export function roleFit(role, id, roles, jitterTable) {
  const base = roleFitBase(role, id, roles);
  const jitter = (jitterTable && jitterTable[`${role}:${id}`]) ?? 1;
  return base * jitter;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rolefit.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/rolefit.js test/rolefit.test.js
git commit -m "feat: add role-fit multiplier with deterministic jitter for seed bias"
```

---

### Task 2: `lib/affinity.js` — per-role connect-rate aggregation

**Files:**
- Create: `lib/affinity.js`
- Create: `test/affinity.test.js`

**Interfaces:**
- Consumes: nothing new — operates on the existing event shape `{ ts, stage, connectorId, role, surface, live }` (see `server.js` `push()`).
- Produces: `roleConnectorRates(events, role) -> { [connectorId]: { recommended, connected, rate, n } }` — consumed by `server.js`'s new `GET /api/affinity` in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `test/affinity.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleConnectorRates } from "../lib/affinity.js";

function ev(stage, connectorId, role) {
  return { ts: 0, stage, connectorId, role, surface: "onboarding", live: false };
}

test("counts recommended and connected per connector, scoped to one role", () => {
  const events = [
    ev("recommended", "hubspot", "sales"),
    ev("recommended", "hubspot", "sales"),
    ev("connected", "hubspot", "sales"),
    ev("recommended", "hubspot", "engineer"), // different role, must not count
  ];
  const rates = roleConnectorRates(events, "sales");
  assert.deepEqual(rates.hubspot, { recommended: 2, connected: 1, rate: 0.5, n: 2 });
});

test("rate and n are 0 when a connector has no recommended events for this role", () => {
  const events = [ev("connected", "slack", "sales")];
  const rates = roleConnectorRates(events, "sales");
  assert.deepEqual(rates.slack, { recommended: 0, connected: 1, rate: 0, n: 0 });
});

test("ignores non-funnel stages (clicked, signed_up, feedback) for this metric", () => {
  const events = [
    ev("recommended", "hubspot", "sales"),
    ev("clicked", "hubspot", "sales"),
    ev("signed_up", "hubspot", "sales"),
    ev("feedback_up", "hubspot", "sales"),
    ev("connected", "hubspot", "sales"),
  ];
  const rates = roleConnectorRates(events, "sales");
  assert.deepEqual(rates.hubspot, { recommended: 1, connected: 1, rate: 1, n: 1 });
});

test("returns an empty object for a role with no matching events", () => {
  const rates = roleConnectorRates([ev("recommended", "hubspot", "sales")], "marketer");
  assert.deepEqual(rates, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/affinity.test.js`
Expected: FAIL — `Cannot find module '../lib/affinity.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/affinity.js`:

```js
// Per-role connect-rate for the flywheel UI cue (app.js pickRole) — pure
// aggregation over the existing event shape, same convention as
// lib/feedback.js. Scoped to ONE role at a time (the client only ever needs
// the currently-selected role's numbers).

export function roleConnectorRates(events, role) {
  const result = {};
  for (const e of events || []) {
    if (e.role !== role) continue;
    if (e.stage !== "recommended" && e.stage !== "connected") continue;
    const row = (result[e.connectorId] ||= { recommended: 0, connected: 0, rate: 0, n: 0 });
    if (e.stage === "recommended") row.recommended++;
    else row.connected++;
  }
  for (const row of Object.values(result)) {
    row.n = row.recommended;
    row.rate = row.recommended ? row.connected / row.recommended : 0;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/affinity.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/affinity.js test/affinity.test.js
git commit -m "feat: add per-role connector connect-rate aggregation"
```

---

### Task 3: Wire role-fit bias + stable event ids into `server.js`

**Files:**
- Modify: `server.js:1-16` (imports), `server.js:76-116` (`APPEAL`/`seedBaseline`/`push`)

**Interfaces:**
- Consumes: `roleFit`, `buildFitJitterTable` from `lib/rolefit.js` (Task 1).
- Produces: every event in the shared `events` array now carries a stable numeric `id` (consumed by Task 5's `recentLive` and the dashboard's pulse-diffing in Task 7).

- [ ] **Step 1: Add the import**

In `server.js`, add to the top import block (after the existing `cleanDisplayName` import at line 13):

```js
import { roleFit, buildFitJitterTable } from "./lib/rolefit.js";
```

- [ ] **Step 2: Build the jitter table and switch on event ids**

Replace this block (`server.js:76-82`):

```js
const rand = mulberry32(42);
const ROLE_KEYS = Object.keys(ROLES);
const SURFACES = ["onboarding", "in_chat"];

// Per-connector "appeal" so some convert much better than others (realistic).
const APPEAL = {}; Object.keys(CONNECTORS).forEach((id) => (APPEAL[id] = 0.25 + rand() * 0.5));
```

with:

```js
const rand = mulberry32(42);
const ROLE_KEYS = Object.keys(ROLES);
const SURFACES = ["onboarding", "in_chat"];

// Per-connector "appeal" so some convert much better than others (realistic).
const APPEAL = {}; Object.keys(CONNECTORS).forEach((id) => (APPEAL[id] = 0.25 + rand() * 0.5));

// Per-(role, connector) fit multiplier for the flywheel (lib/rolefit.js) —
// built from the SAME seeded rand() sequence, right after APPEAL and before
// seedBaseline() consumes rand() itself, so the whole seed stays
// deterministic run-to-run (same principle as the mulberry32(42) seed above).
const FIT_JITTER = buildFitJitterTable(ROLE_KEYS, Object.keys(CONNECTORS), rand);

// Stable id per event, assigned in push() below — lets the dashboard diff
// "seen before" vs "new since last poll" for the activity ticker (Task 5/7).
let nextEventId = 1;
```

- [ ] **Step 3: Apply the fit multiplier inside `seedBaseline()`'s funnel walk**

Replace this block (`server.js:83-116`, the whole `seedBaseline`/`push` pair):

```js
function seedBaseline() {
  const now = Date.now();
  const DAY = 86400000;
  for (let d = 13; d >= 0; d--) {
    const dayTs = now - d * DAY;
    for (const id of Object.keys(CONNECTORS)) {
      // onboarding converts materially better than in-chat — the core thesis.
      for (const surface of SURFACES) {
        const surfaceBoost = surface === "onboarding" ? 1.6 : 1.0;
        const recs = Math.round((3 + rand() * 9));
        for (let i = 0; i < recs; i++) {
          const role = ROLE_KEYS[Math.floor(rand() * ROLE_KEYS.length)];
          push(dayTs, "recommended", id, role, surface);
          // Walk down the funnel probabilistically.
          const ctr = 0.55 * APPEAL[id] * surfaceBoost;
          if (rand() < ctr) {
            push(dayTs, "clicked", id, role, surface);
            if (rand() < 0.7) {
              push(dayTs, "signed_up", id, role, surface);
              if (rand() < 0.85) {
                push(dayTs, "connected", id, role, surface);
                if (rand() < 0.6) push(dayTs, "activated", id, role, surface);
              }
            }
          }
        }
      }
    }
  }
}
function push(ts, stage, connectorId, role, surface, live = false) {
  events.push({ ts, stage, connectorId, role, surface, live });
}
seedBaseline();
```

with:

```js
function seedBaseline() {
  const now = Date.now();
  const DAY = 86400000;
  for (let d = 13; d >= 0; d--) {
    const dayTs = now - d * DAY;
    for (const id of Object.keys(CONNECTORS)) {
      // onboarding converts materially better than in-chat — the core thesis.
      for (const surface of SURFACES) {
        const surfaceBoost = surface === "onboarding" ? 1.6 : 1.0;
        const recs = Math.round((3 + rand() * 9));
        for (let i = 0; i < recs; i++) {
          const role = ROLE_KEYS[Math.floor(rand() * ROLE_KEYS.length)];
          push(dayTs, "recommended", id, role, surface);
          // Walk down the funnel probabilistically, boosted by how well this
          // connector fits the role it was recommended to — the flywheel's
          // seed half (lib/rolefit.js). Clamped so no probability exceeds 1.
          const fit = roleFit(role, id, ROLES, FIT_JITTER);
          const ctr = Math.min(1, 0.55 * APPEAL[id] * surfaceBoost * fit);
          if (rand() < ctr) {
            push(dayTs, "clicked", id, role, surface);
            const signupRate = Math.min(1, 0.7 * fit);
            if (rand() < signupRate) {
              push(dayTs, "signed_up", id, role, surface);
              const connectRate = Math.min(1, 0.85 * fit);
              if (rand() < connectRate) {
                push(dayTs, "connected", id, role, surface);
                if (rand() < 0.6) push(dayTs, "activated", id, role, surface);
              }
            }
          }
        }
      }
    }
  }
}
function push(ts, stage, connectorId, role, surface, live = false) {
  events.push({ id: nextEventId++, ts, stage, connectorId, role, surface, live });
}
seedBaseline();
```

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (all existing suites — this task touches no `lib/*` files consumed by other tests, only `server.js`, which has no direct test file)

- [ ] **Step 5: Manually sanity-check the server still boots and seeds**

Run: `npm start` (Ctrl+C after confirming), or `node -e "process.env.PORT=0; import('./server.js')"` briefly.
Expected: Console prints the usual boot banner with no errors; `GET /api/health` (if you leave it running: `curl localhost:3000/api/health`) returns `events` greater than 0.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: bias seeded funnel conversion by role-connector fit"
```

---

### Task 4: `GET /api/affinity?role=` endpoint

**Files:**
- Modify: `server.js` (add import, add route)

**Interfaces:**
- Consumes: `roleConnectorRates` from `lib/affinity.js` (Task 2), `ROLE_KEYS` and `events` (already in module scope).
- Produces: `GET /api/affinity?role=<key>` → JSON `{ [connectorId]: { recommended, connected, rate, n } }` (or `{}` for an invalid/missing role) — consumed by `app.js` in Task 6.

- [ ] **Step 1: Add the import**

Add alongside the Task 3 import, in the top import block:

```js
import { roleConnectorRates } from "./lib/affinity.js";
```

- [ ] **Step 2: Add the route**

Insert this new block into `server.js`, directly after the closing `});` of the existing `app.post("/api/first-win", ...)` handler and before the `/* ============================ EVENT CAPTURE ============================= */` comment:

```js
/* ============================ ROLE AFFINITY ===============================
   Flywheel — how well the event data (seeded + live) justifies a role's
   curated bundle. Pure aggregation (lib/affinity.js) over the same `events`
   store metrics/funnel use, scoped to ONE role. Called from app.js right
   after a role bundle renders (see pickRole -> loadAffinity in app.js). */
app.get("/api/affinity", (req, res) => {
  const { role } = req.query;
  if (!role || !ROLE_KEYS.includes(role)) return res.json({});
  return res.json(roleConnectorRates(events, role));
});
```

- [ ] **Step 3: Manually verify the endpoint**

Run: `npm start` (leave running in background), then in another shell:
`curl -s "localhost:3000/api/affinity?role=sales" | head -c 500`
Expected: JSON object keyed by connector id (at least `hubspot`, `apollo`, `gmail`, `gcal`, `slack`), each with `recommended`/`connected`/`rate`/`n` fields and `n` well above 0.

Also check the invalid-role guard: `curl -s "localhost:3000/api/affinity?role=nonsense"` → Expected: `{}`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: expose per-role connector affinity via GET /api/affinity"
```

---

### Task 5: `recentLive` on `GET /api/metrics`

**Files:**
- Modify: `server.js:270-339` (the `/api/metrics` handler)

**Interfaces:**
- Consumes: `rows` (already computed in the handler), `DISPLAY` (already in module scope), the `id` field added to events in Task 3.
- Produces: `recentLive` field on the `/api/metrics` JSON response — array of up to 10 items `{ id, stage, connectorId, name, ico, ts }`, newest first — consumed by `dashboard.js` in Task 7.

- [ ] **Step 1: Compute `recentLive` and add it to the response**

In `server.js`, inside the `app.get("/api/metrics", ...)` handler, find this line (immediately before the final `res.json({...})` call):

```js
  // 14-day leads series (oldest -> newest)
  const seriesArr = [];
  for (let d = 13; d >= 0; d--) seriesArr.push({ day: d, leads: series[d] || 0 });
```

Add directly after it:

```js
  // Last 10 live (this-session) funnel events, newest first — the activity
  // ticker that pairs with liveSummary's counter (see dashboard.js
  // renderActivity). Feedback events are excluded, same as the funnel above.
  const recentLive = rows
    .filter((e) => STAGES.includes(e.stage) && e.live)
    .slice(-10)
    .reverse()
    .map((e) => ({
      id: e.id,
      stage: e.stage,
      connectorId: e.connectorId,
      name: DISPLAY[e.connectorId].name,
      ico: DISPLAY[e.connectorId].ico,
      ts: e.ts,
    }));
```

Then find the `res.json({ ... })` call and add `recentLive,` on its own line, right after the existing `liveSummary,` line:

```js
    // This session's own activity, isolated from the seeded baseline — see
    // the `live` flag on events. Same filters as everything else above.
    liveSummary,
    recentLive,
```

- [ ] **Step 2: Manually verify**

Run: `npm start` (leave running), then:
`curl -s localhost:3000/api/metrics | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).recentLive))"`
Expected: `[]` on a fresh boot (no live events posted yet — the seeded baseline is all `live:false`).

Then POST a fake live event and re-check:
```bash
curl -s -X POST localhost:3000/api/events -H 'Content-Type: application/json' \
  -d '{"stage":"connected","connectorId":"hubspot","role":"sales","surface":"onboarding"}'
curl -s localhost:3000/api/metrics | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).recentLive))"
```
Expected: an array with one item, `stage: "connected"`, `connectorId: "hubspot"`, a real `name`/`ico`, and a recent `ts`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: expose recent live events via /api/metrics recentLive"
```

---

### Task 6: Recommender UI — the affinity cue (`app.js`, `styles.css`)

**Files:**
- Modify: `public/app.js:1-14` (top-level state), `public/app.js:41-54` (`pickRole`), `public/app.js:76-120` (`renderConnectors`), `public/app.js:202-211` (`resetAll`)
- Modify: `public/styles.css` (add `.affinity-cue`)

**Interfaces:**
- Consumes: `GET /api/affinity?role=` (Task 4).
- Produces: nothing consumed elsewhere — leaf UI change.

- [ ] **Step 1: Add affinity state and the fetch-and-cache function**

In `public/app.js`, after the existing top-of-file state declarations (right after `const SURFACE = "onboarding";` at line 14), add:

```js
let affinity = {}; // connectorId -> { recommended, connected, rate, n }, for the currently selected role

/* ---- flywheel: per-role connect-rate cue (computed, never hardcoded) ---- */
const AFFINITY_MIN_N = 20;
async function loadAffinity(role) {
  try {
    const res = await fetch(`/api/affinity?role=${encodeURIComponent(role)}`);
    const data = await res.json();
    if (selectedRole === role) { affinity = data || {}; renderConnectors(); }
  } catch (e) { /* no cue shown if the fetch fails — non-critical */ }
}
```

- [ ] **Step 2: Reset and fetch affinity in `pickRole`**

Replace `pickRole` (`public/app.js:41-54`):

```js
function pickRole(key) {
  selectedRole = key;
  const r = ROLES[key];
  present = r.bundle.map((b) => b.id);
  enabled = {}; reasons = {};
  r.bundle.forEach((b) => { enabled[b.id] = b.auto; reasons[b.id] = b.why; });
  $("bundlePanel").classList.remove("hidden");
  $("s3").classList.add("active");
  $("bundleHint").innerHTML = `Curated for <b>${r.title}</b>. Auto-enabled ones are on by default — toggle any off, or add more below.`;
  renderRetrievalNote({});
  renderRoles(); renderConnectors();
  trackMany("recommended", present); // the whole bundle was recommended
  $("bundlePanel").scrollIntoView({ behavior: "smooth", block: "center" });
}
```

with:

```js
function pickRole(key) {
  selectedRole = key;
  const r = ROLES[key];
  present = r.bundle.map((b) => b.id);
  enabled = {}; reasons = {};
  r.bundle.forEach((b) => { enabled[b.id] = b.auto; reasons[b.id] = b.why; });
  $("bundlePanel").classList.remove("hidden");
  $("s3").classList.add("active");
  $("bundleHint").innerHTML = `Curated for <b>${r.title}</b>. Auto-enabled ones are on by default — toggle any off, or add more below.`;
  renderRetrievalNote({});
  affinity = {};
  loadAffinity(key);
  renderRoles(); renderConnectors();
  trackMany("recommended", present); // the whole bundle was recommended
  $("bundlePanel").scrollIntoView({ behavior: "smooth", block: "center" });
}
```

- [ ] **Step 3: Render the cue in `renderConnectors`**

In `public/app.js`, inside `renderConnectors()` (`public/app.js:76-120`), find this section of the row-building code:

```js
    const row = document.createElement("div");
    row.className = "conn" + (needsConsent ? " needs-consent" : "");
    row.innerHTML = `
      <div class="ico"><img src="${k.ico}" alt="" /></div>
      <div class="meta">
        <div class="name">${k.name}
          <span class="tag">${k.cat}</span>
          ${k.isNew ? '<span class="tag new">new · remote MCP</span>' : ""}
        </div>
        <div class="why">${reasons[id] || ""}</div>
        ${needsConsent ? `<div class="consent"><span class="consent-icon">${ICONS.alertTriangle}</span>${CONSENT_COPY[k.sensitive]} — enable?</div>` : ""}
      </div>
```

Replace it with:

```js
    const aff = affinity[id];
    const showCue = aff && aff.n >= AFFINITY_MIN_N;
    const row = document.createElement("div");
    row.className = "conn" + (needsConsent ? " needs-consent" : "");
    row.innerHTML = `
      <div class="ico"><img src="${k.ico}" alt="" /></div>
      <div class="meta">
        <div class="name">${k.name}
          <span class="tag">${k.cat}</span>
          ${k.isNew ? '<span class="tag new">new · remote MCP</span>' : ""}
        </div>
        <div class="why">${reasons[id] || ""}</div>
        ${showCue ? `<div class="affinity-cue">${Math.round(aff.rate * 100)}% of ${ROLES[selectedRole].title} users who saw this connected it · based on connection data, illustrative</div>` : ""}
        ${needsConsent ? `<div class="consent"><span class="consent-icon">${ICONS.alertTriangle}</span>${CONSENT_COPY[k.sensitive]} — enable?</div>` : ""}
      </div>
```

- [ ] **Step 4: Clear affinity on reset**

In `public/app.js`, `resetAll()` (`public/app.js:202-211`), find:

```js
function resetAll() {
  selectedRole = null; enabled = {}; present = []; reasons = {}; extraMeta = {};
```

Replace with:

```js
function resetAll() {
  selectedRole = null; enabled = {}; present = []; reasons = {}; extraMeta = {}; affinity = {};
```

- [ ] **Step 5: Add the cue style**

In `public/styles.css`, directly after this existing line (find `.conn .meta .why`):

```css
.conn .meta .why { color: var(--muted); font-size: 12.5px; margin-top: 3px; line-height: 1.4; }
```

add:

```css
.conn .meta .affinity-cue { color: var(--muted); font-size: 11.5px; margin-top: 4px; }
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm start`, open `http://localhost:3000/`.
- Click the "Sales" role card. Expected: each of the 4 auto-enabled connectors (HubSpot, Apollo, Gmail, Gcal) shows a muted cue line like "82% of Sales users who saw this connected it · based on connection data, illustrative" underneath its "why" text, within roughly a second (after the `/api/affinity` fetch resolves). The 4 percentages should differ from each other (jitter working), not all read the same.
- Click a different role (e.g. "Engineer"). Expected: cues update to that role's numbers; no stale "Sales" cue lingers.
- Use the free-text box with a query that surfaces a non-curated/RAG connector. Expected: that connector shows no cue (low/no `n` for any role).

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: show computed per-role connect-rate cue on curated connectors"
```

---

### Task 7: Dashboard — live activity ticker (`dashboard.html`, `dashboard.js`, `styles.css`)

**Files:**
- Modify: `public/dashboard.html` (add the "Activity" panel)
- Modify: `public/dashboard.js` (render `recentLive`, relative timestamps, pulse)
- Modify: `public/styles.css` (add `.activity-feed`/`.activity-row`/`.pulse`)

**Interfaces:**
- Consumes: `recentLive` from `GET /api/metrics` (Task 5).
- Produces: nothing consumed elsewhere — leaf UI change.

- [ ] **Step 1: Add the panel markup**

In `public/dashboard.html`, find the first `grid2` block (the one containing "Live this session" and "Suggestion feedback"):

```html
  <div class="grid2">
    <div class="panel">
      <h2>Live this session</h2>
      <p class="hint">Your activity this session, live — isolated from the seeded baseline below so a single connect is visible.</p>
      <div class="live-stats" id="liveStats"></div>
    </div>
    <div class="panel">
      <h2>Suggestion feedback</h2>
      <p class="hint">Thumbs up/down on suggestions in the recommender — this trains future bundles.</p>
      <div class="feedback-summary" id="feedbackSummary"></div>
    </div>
  </div>
```

Add a new panel directly after this block's closing `</div>` (before the next `grid2` block that starts with "Conversion funnel"):

```html

  <div class="panel">
    <h2>Activity</h2>
    <p class="hint">Individual live events from this session, newest first — proves "live" isn't just a bigger number.</p>
    <div class="activity-feed" id="activityFeed"></div>
  </div>
```

- [ ] **Step 2: Add the rendering logic**

In `public/dashboard.js`, add near the top, alongside the existing `STAGE_LABEL`/`LIVE_STAGES` constants (after the `LIVE_STAGES` array, before `const LEAD_VALUE`):

```js
const ACTIVITY_VERB = {
  recommended: "recommended",
  clicked: "clicked connect on",
  signed_up: "signed up for",
  connected: "connected",
  activated: "activated",
};
let lastActivityIds = new Set(); // previous poll's recentLive ids, to pulse only new rows
```

Then, after the existing `renderLiveStats` function, add:

```js
function relativeTime(ts) {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 30) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderActivity(recentLive) {
  const items = recentLive || [];
  const seenIds = new Set(items.map((e) => e.id));
  $("activityFeed").innerHTML = items.length
    ? items.map((e) => {
        const isNew = !lastActivityIds.has(e.id);
        return `<div class="activity-row${isNew ? " pulse" : ""}">
          <span class="ico-sm"><img src="${e.ico}" alt="" /></span>
          <span class="activity-text">${ACTIVITY_VERB[e.stage] || e.stage} <b>${e.name}</b></span>
          <span class="activity-time">${relativeTime(e.ts)}</span>
        </div>`;
      }).join("")
    : `<div class="count">No live activity yet this session.</div>`;
  lastActivityIds = seenIds;
}
```

Then, in the `load()` function, find:

```js
  renderLiveStats(m.liveSummary);
  renderFeedbackSummary(m.feedback, m.connectors);
```

and replace with:

```js
  renderLiveStats(m.liveSummary);
  renderActivity(m.recentLive);
  renderFeedbackSummary(m.feedback, m.connectors);
```

- [ ] **Step 3: Add the styles**

In `public/styles.css`, directly after this existing line (find `.live-stat.pulse .live-stat-value`):

```css
.live-stat.pulse .live-stat-value { animation: valuepulse .7s ease; }
```

add:

```css
.activity-feed { display: flex; flex-direction: column; gap: 8px; }
.activity-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); background: var(--panel-2); font-size: 13px; }
.activity-row .ico-sm { width: 20px; height: 20px; flex: none; display: grid; place-items: center; }
.activity-row .ico-sm img { width: 100%; height: 100%; object-fit: contain; }
.activity-row .activity-text { flex: 1; }
.activity-row .activity-time { color: var(--muted); font-size: 11.5px; flex: none; }
.activity-row.pulse { animation: rowpulse .8s ease; }
@keyframes rowpulse { 0% { background: rgba(34,197,94,.18); } 100% { background: var(--panel-2); } }
```

- [ ] **Step 4: Manually verify in the browser**

Run: `npm start`. Open `http://localhost:3000/dashboard.html` in one tab and `http://localhost:3000/` in another.
- Dashboard: Expected the new "Activity" panel shows "No live activity yet this session." on first load (seeded events are all `live:false`).
- Recommender tab: pick a role, toggle a connector, click "Connect N connectors & continue".
- Dashboard tab (within ~4s, the poll interval): Expected a new row appears at the top of "Activity" ("connected HubSpot" or similar), briefly highlighted (pulse), with "just now". On the next poll (~4s later), the same row should no longer be highlighted and should read something like "just now" still if <30s, or age normally.
- Wait a couple of minutes without further action: Expected the row's relative time updates to "1m ago" / "2m ago" on subsequent polls without needing a page reload.

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.html public/dashboard.js public/styles.css
git commit -m "feat: add live activity ticker with relative timestamps to dashboard"
```

---

### Task 8: Coverage verification script + end-to-end sign-off

**Files:**
- Create: `scripts/check-affinity-coverage.js`

**Interfaces:**
- Consumes: the running server's `GET /api/affinity` (Task 4) and `public/taxonomy.js`'s `ROLES`.
- Produces: nothing consumed by other code — a standalone dev verification script, same category as `scripts/ingest.js`.

- [ ] **Step 1: Write the script**

Create `scripts/check-affinity-coverage.js`:

```js
// One-off dev check (not part of `npm test`): confirms the seeded baseline
// gives every curated (role, connector-in-bundle) pair enough volume for the
// app.js affinity cue to actually show (n >= 20) — per review feedback,
// don't just eyeball one role card. Run against a running server:
//   npm start &
//   node scripts/check-affinity-coverage.js
import "dotenv/config";

const BASE = process.env.BASE_URL || "http://localhost:3000";
await import("../public/taxonomy.js");
const { ROLES } = globalThis.TAXONOMY;

const MIN_N = 20;
let failures = 0;

for (const [role, r] of Object.entries(ROLES)) {
  const res = await fetch(`${BASE}/api/affinity?role=${role}`);
  const rates = await res.json();
  for (const entry of r.bundle) {
    const n = (rates[entry.id] && rates[entry.id].n) || 0;
    const ok = n >= MIN_N;
    if (!ok) failures++;
    console.log(`${ok ? "OK  " : "FAIL"} ${role.padEnd(10)} ${entry.id.padEnd(12)} n=${n}`);
  }
}

console.log(
  failures
    ? `\n${failures} pair(s) below n=${MIN_N} — widen the recs range in server.js seedBaseline() (e.g. "Math.round((3 + rand() * 9))" -> "Math.round((5 + rand() * 11))") and re-run.`
    : "\nAll curated (role, connector) pairs clear the n>=20 threshold."
);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it against the real seeded server**

Run:
```bash
npm start &
sleep 2
node scripts/check-affinity-coverage.js
```
Expected: a line per (role, connector) pair (30 total), all `OK`, ending in "All curated (role, connector) pairs clear the n>=20 threshold." and exit code 0.

- [ ] **Step 3: If any pair fails, widen seed volume and re-check**

If Step 2 printed any `FAIL` lines: in `server.js`, inside `seedBaseline()`, change:
```js
const recs = Math.round((3 + rand() * 9));
```
to:
```js
const recs = Math.round((5 + rand() * 11));
```
Restart the server (`npm start`) and re-run `node scripts/check-affinity-coverage.js` until all 30 pairs read `OK`.

- [ ] **Step 4: Full regression pass**

Run: `npm test`
Expected: PASS — all prior suites plus `rolefit.test.js` and `affinity.test.js` (should be 58 tests: the existing 47 + 7 rolefit + 4 affinity).

Then repeat the manual browser checks from Task 6 Step 6 and Task 7 Step 4 once more end-to-end, in order:
1. Open the dashboard, confirm "Live this session" reads all zeros and "Activity" reads "No live activity yet this session."
2. In the recommender, pick each of the 6 roles in turn (not just Sales) — confirm every role's auto-enabled connectors show a cue with plausible, non-identical percentages, and the wording reads "...who saw this connected it...".
3. Connect a bundle from one role. Confirm within one 4s dashboard poll: "Live this session" increments from 0, and "Activity" shows the new events pulsed, newest first, with correct relative timestamps.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-affinity-coverage.js
git commit -m "chore: add affinity seed-coverage verification script"
```

(If Step 3 required a `server.js` edit, include it in this commit or a preceding one — `git add server.js scripts/check-affinity-coverage.js` — with message `"fix: widen seed volume so every curated role-connector pair clears n>=20"`.)
