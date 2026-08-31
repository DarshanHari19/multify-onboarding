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
