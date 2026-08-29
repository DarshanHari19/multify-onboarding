// Pure cosine-similarity ranking over pre-computed vectors. Deliberately has
// no dependency on @xenova/transformers or any I/O, so it's cheap to
// unit-test with small fixture vectors instead of the full 25k-entry catalog.

// Vectors from build-index.js are already mean-pooled + normalized, so plain
// dot product IS cosine similarity — no need to re-normalize here.
export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// items: [{ id, vector }]. Returns the top-k by similarity to queryVector,
// each as { id, score }, highest first.
export function topK(queryVector, items, k = 25) {
  return items
    .map((item) => ({ id: item.id, score: dot(queryVector, item.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
