import { test } from "node:test";
import assert from "node:assert/strict";
import "../public/taxonomy.js";

const { CONNECTORS, ROLES, SPONSORED } = globalThis.TAXONOMY;

test("every sponsored entry points at a real connector with a role tag and why text", () => {
  for (const s of SPONSORED) {
    assert.ok(CONNECTORS[s.id], `SPONSORED entry "${s.id}" is not a known connector`);
    assert.ok(s.roles && s.roles.length > 0, `SPONSORED entry "${s.id}" has no roles tag`);
    assert.ok(s.why && s.why.length > 0, `SPONSORED entry "${s.id}" has no why text`);
    for (const role of s.roles) {
      assert.ok(ROLES[role], `SPONSORED entry "${s.id}" tags unknown role "${role}"`);
    }
  }
});

test("a sponsored entry's connector is not already in the bundle of any role it's tagged for", () => {
  for (const s of SPONSORED) {
    for (const role of s.roles) {
      const bundleIds = ROLES[role].bundle.map((b) => b.id);
      assert.ok(
        !bundleIds.includes(s.id),
        `SPONSORED entry "${s.id}" duplicates a connector already in ${role}'s bundle`
      );
    }
  }
});
