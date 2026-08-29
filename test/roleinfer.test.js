import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRole } from "../lib/roleinfer.js";

const ROLE_KEYS = ["sales", "engineer", "pm", "marketer", "founder", "data"];

test("validateRole passes through a valid role key", () => {
  assert.equal(validateRole("engineer", ROLE_KEYS), "engineer");
});

test("validateRole is case-insensitive and trims whitespace", () => {
  assert.equal(validateRole("  Sales \n", ROLE_KEYS), "sales");
});

test("validateRole returns null for an unknown key (anti-hallucination)", () => {
  assert.equal(validateRole("astronaut", ROLE_KEYS), null);
});

test("validateRole returns null for empty, non-string, or missing input", () => {
  assert.equal(validateRole("", ROLE_KEYS), null);
  assert.equal(validateRole(null, ROLE_KEYS), null);
  assert.equal(validateRole(undefined, ROLE_KEYS), null);
  assert.equal(validateRole(42, ROLE_KEYS), null);
});
