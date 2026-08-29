import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePicks, validatePicks } from "../lib/rerank.js";

test("parsePicks extracts a clean JSON array", () => {
  const content = '[{"id":"abc","why":"fits the need"},{"id":"def","why":"also relevant"}]';
  assert.deepEqual(parsePicks(content), [
    { id: "abc", why: "fits the need" },
    { id: "def", why: "also relevant" },
  ]);
});

test("parsePicks extracts JSON even wrapped in prose or code fences", () => {
  const content = 'Sure, here you go:\n```json\n[{"id":"abc","why":"x"}]\n```\nHope that helps!';
  assert.deepEqual(parsePicks(content), [{ id: "abc", why: "x" }]);
});

test("parsePicks returns [] for malformed JSON", () => {
  assert.deepEqual(parsePicks("not json at all"), []);
  assert.deepEqual(parsePicks("[{id: abc}]"), []); // invalid JSON (unquoted key)
  assert.deepEqual(parsePicks(""), []);
});

test("parsePicks drops entries without a string id", () => {
  const content = '[{"id":"abc","why":"ok"},{"why":"no id"},{"id":42,"why":"non-string id"}]';
  assert.deepEqual(parsePicks(content), [{ id: "abc", why: "ok" }]);
});

test("validatePicks drops ids outside the retrieved-candidate set (anti-hallucination)", () => {
  const candidateIds = new Set(["real-1", "real-2"]);
  const picks = [
    { id: "real-1", why: "in set" },
    { id: "hallucinated-id", why: "the model made this up" },
    { id: "real-2", why: "also in set" },
  ];
  assert.deepEqual(validatePicks(picks, candidateIds), [
    { id: "real-1", why: "in set" },
    { id: "real-2", why: "also in set" },
  ]);
});

test("validatePicks dedupes and caps at 6", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
  const candidateIds = new Set(ids);
  const picks = [...ids.map((id) => ({ id, why: "" })), { id: "id-0", why: "dup" }]; // trailing dup
  const result = validatePicks(picks, candidateIds);
  assert.equal(result.length, 6);
  assert.deepEqual(result.map((p) => p.id), ["id-0", "id-1", "id-2", "id-3", "id-4", "id-5"]);
});

test("validatePicks preserves the model's why text, defaulting to empty string", () => {
  const candidateIds = new Set(["x"]);
  const result = validatePicks([{ id: "x" }], candidateIds);
  assert.deepEqual(result, [{ id: "x", why: "" }]);
});
