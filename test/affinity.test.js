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
