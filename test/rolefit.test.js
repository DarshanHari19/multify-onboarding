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
