import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseLiveEvents } from "../lib/liveactivity.js";

test("collapses multiple stages of the same connector into one row", () => {
  const events = [
    { id: 1, connectorId: "slack", stage: "clicked", ts: 1000 },
    { id: 2, connectorId: "slack", stage: "signed_up", ts: 2000 },
    { id: 3, connectorId: "slack", stage: "connected", ts: 3000 },
  ];
  const rows = collapseLiveEvents(events);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, "connected");
  assert.equal(rows[0].ts, 3000);
});

test("keeps furthest stage even if a later duplicate event regresses", () => {
  const events = [
    { id: 1, connectorId: "slack", stage: "connected", ts: 1000 },
    { id: 2, connectorId: "slack", stage: "recommended", ts: 2000 },
  ];
  const rows = collapseLiveEvents(events);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, "connected");
});

test("sorts by most-recently-advanced connector first", () => {
  const events = [
    { id: 1, connectorId: "slack", stage: "clicked", ts: 1000 },
    { id: 2, connectorId: "notion", stage: "clicked", ts: 2000 },
    { id: 3, connectorId: "slack", stage: "signed_up", ts: 3000 },
  ];
  const rows = collapseLiveEvents(events);
  assert.deepEqual(rows.map((r) => r.connectorId), ["slack", "notion"]);
});

test("caps the result at the given limit, keeping the most recent connectors", () => {
  const events = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    connectorId: `c${i}`,
    stage: "clicked",
    ts: i,
  }));
  const rows = collapseLiveEvents(events, 8);
  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((r) => r.connectorId),
    ["c11", "c10", "c9", "c8", "c7", "c6", "c5", "c4"]
  );
});

test("returns an empty array for no events", () => {
  assert.deepEqual(collapseLiveEvents([]), []);
});
