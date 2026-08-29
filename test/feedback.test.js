import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeFeedback } from "../lib/feedback.js";

test("summarizeFeedback counts up/down totals and ignores non-feedback stages", () => {
  const events = [
    { stage: "feedback_up", connectorId: "hubspot" },
    { stage: "feedback_up", connectorId: "hubspot" },
    { stage: "feedback_down", connectorId: "stripe" },
    { stage: "recommended", connectorId: "hubspot" }, // ignored
    { stage: "connected", connectorId: "gmail" }, // ignored
  ];
  const result = summarizeFeedback(events);
  assert.equal(result.up, 2);
  assert.equal(result.down, 1);
});

test("summarizeFeedback breaks totals down per connector", () => {
  const events = [
    { stage: "feedback_up", connectorId: "hubspot" },
    { stage: "feedback_down", connectorId: "hubspot" },
    { stage: "feedback_up", connectorId: "stripe" },
  ];
  const result = summarizeFeedback(events);
  assert.deepEqual(result.byConnector, {
    hubspot: { up: 1, down: 1 },
    stripe: { up: 1, down: 0 },
  });
});

test("summarizeFeedback returns zeroed totals for an empty event list", () => {
  const result = summarizeFeedback([]);
  assert.deepEqual(result, { up: 0, down: 0, byConnector: {} });
});

test("summarizeFeedback handles a missing/undefined events array without throwing", () => {
  assert.deepEqual(summarizeFeedback(undefined), { up: 0, down: 0, byConnector: {} });
});
