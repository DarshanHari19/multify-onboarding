import { test } from "node:test";
import assert from "node:assert/strict";
import "../public/taxonomy.js";

const { CONNECTORS, ROLES } = globalThis.TAXONOMY;

test("every role has a featured (sponsored) slot pointing at a real connector", () => {
  for (const [key, role] of Object.entries(ROLES)) {
    assert.ok(role.featured, `${key} has no featured slot`);
    assert.ok(CONNECTORS[role.featured.id], `${key}.featured.id "${role.featured.id}" is not a known connector`);
    assert.ok(role.featured.why && role.featured.why.length > 0, `${key}.featured has no why text`);
  }
});

test("a role's featured slot is not already in that role's own bundle", () => {
  for (const [key, role] of Object.entries(ROLES)) {
    const bundleIds = role.bundle.map((b) => b.id);
    assert.ok(
      !bundleIds.includes(role.featured.id),
      `${key}.featured.id "${role.featured.id}" duplicates a connector already in its bundle`
    );
  }
});
