// Thin singleton wrapper around the local embedding model. Kept separate from
// retriever.js (which stays pure/dependency-free for fast unit tests) and from
// server.js (which just calls warmup()/embedQuery()).

import { pipeline } from "@xenova/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";
let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline("feature-extraction", MODEL);
  return extractorPromise;
}

// Load the model + run one embedding now, at server boot, so the first real
// user query isn't the one paying for model load.
export async function warmupEmbedder() {
  const extractor = await getExtractor();
  await extractor("warmup", { pooling: "mean", normalize: true });
  return extractor;
}

export async function embedQuery(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}
