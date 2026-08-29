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
