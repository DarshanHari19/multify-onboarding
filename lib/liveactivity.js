// De-noises the live activity ticker: a connector that goes
// clicked -> signed_up -> connected in one session used to render as three
// separate rows. Collapse to one row per connector, updated in place to its
// furthest stage reached, so the feed reads as connector progress rather than
// a raw event log. Dependency-free on purpose, same as lib/retriever.js.

const STAGE_ORDER = ["recommended", "clicked", "signed_up", "connected", "activated"];

// events: [{ id, connectorId, stage, ts, ... }], any order. Returns one entry
// per connectorId (the input event carrying its furthest stage reached, ties
// broken by latest ts), sorted newest-advanced first, capped at `limit`.
export function collapseLiveEvents(events, limit = 8) {
  const furthest = new Map();
  for (const e of events) {
    const stageIdx = STAGE_ORDER.indexOf(e.stage);
    const prev = furthest.get(e.connectorId);
    if (!prev || stageIdx > prev.stageIdx || (stageIdx === prev.stageIdx && e.ts >= prev.event.ts)) {
      furthest.set(e.connectorId, { event: e, stageIdx });
    }
  }
  return [...furthest.values()]
    .sort((a, b) => b.event.ts - a.event.ts)
    .slice(0, limit)
    .map(({ event }) => event);
}
