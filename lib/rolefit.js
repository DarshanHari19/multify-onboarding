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
