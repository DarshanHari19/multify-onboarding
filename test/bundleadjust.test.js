import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustBundle } from "../lib/bundleadjust.js";

const notSensitive = () => false;

function bundle() {
  return [
    { id: "hubspot", auto: true, why: "Manage your pipeline" },
    { id: "apollo", auto: true, why: "Enrich leads" },
    { id: "gmail", auto: false, why: "Draft outreach" },
    { id: "slack", auto: false, why: "Loop your team in" },
  ];
}

test("promotes a suggested connector when rate and n clear the threshold and it isn't sensitive", () => {
  const affinity = { gmail: { rate: 0.82, n: 30 } };
  const { ordered, changes } = adjustBundle(bundle(), affinity, {}, notSensitive);
  const gmail = ordered.find((e) => e.id === "gmail");
  assert.equal(gmail.auto, true);
  assert.deepEqual(
    changes.filter((c) => c.type === "promoted"),
    [{ id: "gmail", type: "promoted", rate: 0.82, n: 30 }]
  );
});

test("never promotes a sensitive connector even with a high rate", () => {
  const affinity = { gmail: { rate: 0.95, n: 50 } };
  const isSensitive = (entry) => entry.id === "gmail";
  const { ordered, changes } = adjustBundle(bundle(), affinity, {}, isSensitive);
  const gmail = ordered.find((e) => e.id === "gmail");
  assert.equal(gmail.auto, false);
  assert.equal(changes.some((c) => c.type === "promoted" && c.id === "gmail"), false);
});

test("does not promote when the rate is below threshold, even with plenty of data", () => {
  const affinity = { gmail: { rate: 0.4, n: 100 } };
  const { ordered, changes } = adjustBundle(bundle(), affinity, {}, notSensitive);
  const gmail = ordered.find((e) => e.id === "gmail");
  assert.equal(gmail.auto, false);
  assert.equal(changes.length, 0);
});

test("does not promote when n is below minN, even with a high rate", () => {
  const affinity = { gmail: { rate: 0.9, n: 5 } };
  const { ordered, changes } = adjustBundle(bundle(), affinity, {}, notSensitive);
  const gmail = ordered.find((e) => e.id === "gmail");
  assert.equal(gmail.auto, false);
  assert.equal(changes.length, 0);
});

test("a low-n suggested connector is pushed to the bottom of its group, keeping relative order among other low-n entries", () => {
  const affinity = {
    gmail: { rate: 0.9, n: 3 }, // insufficient n, would otherwise sort first
    slack: { rate: 0.5, n: 25 }, // sufficient n
  };
  const { ordered } = adjustBundle(bundle(), affinity, {}, notSensitive);
  const suggestedIds = ordered.filter((e) => !["hubspot", "apollo"].includes(e.id)).map((e) => e.id);
  assert.deepEqual(suggestedIds, ["slack", "gmail"]);
});

test("auto entries are never demoted, regardless of how low their rate is", () => {
  const affinity = { hubspot: { rate: 0.01, n: 200 } };
  const { ordered, changes } = adjustBundle(bundle(), affinity, {}, notSensitive);
  const hubspot = ordered.find((e) => e.id === "hubspot");
  assert.equal(hubspot.auto, true);
  assert.equal(changes.some((c) => c.id === "hubspot"), false);
});

test("sorts within each group by rate desc for entries with n >= minN", () => {
  const affinity = {
    hubspot: { rate: 0.2, n: 40 },
    apollo: { rate: 0.7, n: 40 },
    gmail: { rate: 0.3, n: 40 },
    slack: { rate: 0.5, n: 40 },
  };
  const { ordered } = adjustBundle(bundle(), affinity, {}, notSensitive);
  assert.deepEqual(ordered.map((e) => e.id), ["apollo", "hubspot", "slack", "gmail"]);
});

test("preserves group boundaries: auto-enabled entries (plus promotions) always precede suggested entries", () => {
  const affinity = { gmail: { rate: 0.9, n: 30 }, hubspot: { rate: 0.1, n: 30 } };
  const { ordered } = adjustBundle(bundle(), affinity, {}, notSensitive);
  const autoIds = ordered.filter((e) => e.auto).map((e) => e.id);
  const suggestedIds = ordered.filter((e) => !e.auto).map((e) => e.id);
  assert.deepEqual(ordered.map((e) => e.id), [...autoIds, ...suggestedIds]);
  assert.deepEqual(autoIds.sort(), ["apollo", "gmail", "hubspot"].sort());
});

test("does not mutate the input bundle or affinity", () => {
  const b = bundle();
  const bCopy = JSON.parse(JSON.stringify(b));
  const affinity = { gmail: { rate: 0.82, n: 30 } };
  const affinityCopy = JSON.parse(JSON.stringify(affinity));
  adjustBundle(b, affinity, {}, notSensitive);
  assert.deepEqual(b, bCopy);
  assert.deepEqual(affinity, affinityCopy);
});

test("is deterministic — same inputs produce the same ordered output", () => {
  const affinity = { gmail: { rate: 0.82, n: 30 }, slack: { rate: 0.5, n: 25 } };
  const r1 = adjustBundle(bundle(), affinity, {}, notSensitive);
  const r2 = adjustBundle(bundle(), affinity, {}, notSensitive);
  assert.deepEqual(r1, r2);
});
