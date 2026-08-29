// Build local embeddings for the ingested MCP registry catalog — the second
// half of the RAG upgrade's offline prep (see RAG-UPGRADE-BUILDPLAN.md).
// One-time (or whenever data/catalog.json changes): `npm run build-index`.
// This is an OFFLINE step — it can take a while on the full registry; it must
// never run during a live demo.
//
// Local embeddings only (no API key): @xenova/transformers, all-MiniLM-L6-v2,
// 384-dim, mean-pooled + normalized so cosine similarity == dot product.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "@xenova/transformers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "..", "data", "catalog.json");
const OUT_PATH = path.join(__dirname, "..", "data", "embeddings.json");
const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 64;

// Embed the human-readable title (falls back to the raw registry name in
// ingest.js when no title exists) plus description — title carries real
// semantic signal that the raw reverse-DNS `name` mostly doesn't.
function embedText(entry) {
  return `${entry.title}. ${entry.description}`;
}

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const servers = catalog.servers;
  console.log(`Loaded ${servers.length} catalog entries from ${CATALOG_PATH}`);
  console.log(`Loading ${MODEL} (first run downloads + caches the model)...`);

  const extractor = await pipeline("feature-extraction", MODEL);
  console.log("Model ready. Embedding in batches of", BATCH_SIZE, "...");

  const out = [];
  const start = Date.now();
  for (let i = 0; i < servers.length; i += BATCH_SIZE) {
    const batch = servers.slice(i, i + BATCH_SIZE);
    const texts = batch.map(embedText);
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const vectors = output.tolist();
    for (let j = 0; j < batch.length; j++) {
      out.push({ id: batch[j].id, vector: vectors[j] });
    }
    if ((i / BATCH_SIZE) % 10 === 0) {
      const elapsedS = (Date.now() - start) / 1000;
      const rate = out.length / elapsedS;
      const remaining = (servers.length - out.length) / rate;
      console.log(
        `  ...${out.length}/${servers.length} embedded ` +
          `(${elapsedS.toFixed(0)}s elapsed, ~${remaining.toFixed(0)}s remaining)`
      );
    }
  }

  writeFileSync(
    OUT_PATH,
    JSON.stringify({ model: MODEL, dim: out[0]?.vector.length || 0, count: out.length, vectors: out })
  );
  console.log(`\nWrote ${out.length} vectors (${out[0]?.vector.length}-dim) to ${OUT_PATH}`);
  console.log(`Total time: ${((Date.now() - start) / 1000).toFixed(0)}s`);
  console.log(`Next: npm start`);
}

main().catch((err) => {
  console.error("build-index failed:", err);
  process.exit(1);
});
