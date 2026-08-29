// Glue between the embedder and the pure retriever: embed the free-text query,
// rank it against the full registry catalog, return the top-k candidates with
// their catalog metadata attached. This is the "retrieved candidate set" that
// the LLM re-rank step (lib/rerank.js) is grounded in and validated against.

import { topK } from "./retriever.js";
import { embedQuery } from "./embedder.js";

export async function retrieveCandidates(rag, queryText, k = 25) {
  const queryVector = await embedQuery(queryText);
  const ranked = topK(queryVector, rag.vectors, k);
  return ranked.map(({ id, score }) => ({ ...rag.catalogById.get(id), score }));
}

// Loads catalog.json + embeddings.json into memory. Returns null (never
// throws) if either file is missing, so the server can fall back gracefully.
export function loadRagData(fs, catalogPath, embeddingsPath) {
  try {
    const catalogRaw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const embeddingsRaw = JSON.parse(fs.readFileSync(embeddingsPath, "utf8"));
    const catalogById = new Map(catalogRaw.servers.map((s) => [s.id, s]));
    return { catalogById, vectors: embeddingsRaw.vectors, count: catalogRaw.count };
  } catch {
    return null;
  }
}
