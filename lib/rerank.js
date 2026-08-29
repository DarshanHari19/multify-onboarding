// LLM re-rank over a retrieved candidate set (see lib/rag.js for retrieval).
// Split into pure, testable pieces (parsePicks, validatePicks) and the actual
// network call (rerankWithLLM), which is not unit-tested — it's exercised via
// the live demo instead, per the project's stated demo-bar scope.

// Fewer, higher-confidence picks reads as selective ("we found the best
// matches") rather than a dump padded with weak matches.
const MAX_PICKS = 4;

// Extract a JSON array from LLM output that may be wrapped in prose or code
// fences. Returns [] (never throws) on anything unparseable.
export function parsePicks(content) {
  const match = (content || "").match(/\[[\s\S]*\]/);
  if (!match) return [];
  let arr;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((p) => p && typeof p.id === "string");
}

// Anti-hallucination gate: keep only picks whose id is actually in the
// retrieved-candidate set (NOT "any known catalog id" — the candidate set for
// THIS query). Dedupes and caps at MAX_PICKS, preserving the model's ordering.
export function validatePicks(picks, candidateIds) {
  const allowed = candidateIds instanceof Set ? candidateIds : new Set(candidateIds);
  const seen = new Set();
  const out = [];
  for (const pick of picks) {
    if (!allowed.has(pick.id) || seen.has(pick.id)) continue;
    seen.add(pick.id);
    out.push({ id: pick.id, why: typeof pick.why === "string" ? pick.why : "" });
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

function candidatesForPrompt(candidates) {
  return candidates.map((c) => `- ${c.id}: ${c.title} — ${c.description}`).join("\n");
}

// Returns { picks: [{id, why}] } on success, or null on timeout/error/no-key
// so the caller falls back to raw vector top-hits — the re-rank step must
// never hang or crash the live demo.
export async function rerankWithLLM(candidates, queryText, { apiKey, model, timeoutMs = 9000 } = {}) {
  if (!apiKey) return null;

  const candidateIds = new Set(candidates.map((c) => c.id));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You pick the best-matching MCP connectors for a user's need, from ONLY the candidates listed below " +
              "(never invent an id outside this list). Be selective — only include a candidate if it's a strong, " +
              "confident match; a shorter list of great matches beats a longer list padded with weak ones. Return " +
              'ONLY a JSON array of objects {"id": "<candidate id>", "why": "<one short sentence, specific to this ' +
              'user need>"}, most relevant first, max 4. If nothing fits well, return fewer (even []). No prose ' +
              "outside the JSON array.",
          },
          { role: "user", content: `Candidates:\n${candidatesForPrompt(candidates)}\n\nUser need: "${queryText}"\n\nJSON array:` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const picks = validatePicks(parsePicks(content), candidateIds);
    return { picks };
  } catch (err) {
    if (process.env.RERANK_DEBUG) console.error("RERANK_DEBUG catch:", err.name, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
