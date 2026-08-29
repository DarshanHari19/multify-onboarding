import { test } from "node:test";
import assert from "node:assert/strict";
import { topK, dot } from "../lib/retriever.js";

test("dot product of identical unit vectors is 1", () => {
  const v = [1, 0, 0];
  assert.equal(dot(v, v), 1);
});

test("topK ranks closer vectors first", () => {
  const query = [1, 0, 0];
  const items = [
    { id: "far", vector: [0, 1, 0] }, // orthogonal -> similarity 0
    { id: "close", vector: [0.9, 0.1, 0] }, // near-parallel -> high similarity
    { id: "opposite", vector: [-1, 0, 0] }, // opposite -> similarity -1
    { id: "mid", vector: [0.5, 0.5, 0] },
  ];

  const ranked = topK(query, items, 4);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["close", "mid", "far", "opposite"]
  );
});

test("topK respects the k limit", () => {
  const query = [1, 0];
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, vector: [1 - i * 0.01, i * 0.01] }));
  const ranked = topK(query, items, 3);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].id, "item-0");
});
