// Builds the "here's what your agent can do on day one" task list shown
// right after Connect (see app.js doConnect). Hybrid (locked decision):
// prefer a hand-curated multi-connector combo, then per-connector templates,
// and only ask the caller to hit the LLM gap-fill endpoint (/api/first-win)
// when the curated set produces nothing at all — i.e. the enabled set is
// entirely registry/RAG connectors with no template. Pure, dependency-free.

const MAX_TASKS = 3;
// Jaccard similarity over word tokens — catches near-duplicates that share
// most of their wording (e.g. a combo task and the individual template it
// was built from) even when the strings aren't identical.
const SIMILARITY_THRESHOLD = 0.5;

function tokenize(s) {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}

function jaccard(a, b) {
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function isNearDuplicate(line, existingLines) {
  const tokens = tokenize(line);
  return existingLines.some((existing) => jaccard(tokens, tokenize(existing)) >= SIMILARITY_THRESHOLD);
}

// enabledMetas: [{ id, ... }] — only `id` is used. FIRST_WINS: taxonomy map
// { [connectorId]: string[], __combos: [{ ids: string[], task: string }] }.
export function buildFirstWinTasks(enabledMetas, FIRST_WINS) {
  const ids = new Set((enabledMetas || []).map((m) => m.id));
  const tasks = [];

  // Combos first — most specific and most "hero" of the three sources.
  for (const combo of FIRST_WINS.__combos || []) {
    if (combo.ids.every((id) => ids.has(id)) && !isNearDuplicate(combo.task, tasks)) {
      tasks.push(combo.task);
      if (tasks.length >= MAX_TASKS) break;
    }
  }

  // Per-connector templates fill any remaining slots.
  if (tasks.length < MAX_TASKS) {
    for (const id of ids) {
      const lines = FIRST_WINS[id];
      if (!lines) continue;
      for (const line of lines) {
        if (isNearDuplicate(line, tasks)) continue;
        tasks.push(line);
        if (tasks.length >= MAX_TASKS) break;
      }
      if (tasks.length >= MAX_TASKS) break;
    }
  }

  // Only ask for the LLM gap-fill when the curated set produced NOTHING at
  // all (i.e. the enabled set is entirely registry/RAG connectors with no
  // template) — a single good curated line is a perfectly fine first-win card.
  return { tasks, needLLM: tasks.length === 0 };
}

// LLM gap-fill (hybrid, locked decision): only called by the server when
// buildFirstWinTasks() above reports needLLM — i.e. the enabled set is all
// registry/RAG connectors with no curated template. Mirrors lib/rerank.js /
// lib/roleinfer.js: untested network call, same timeout/abort discipline,
// never hangs the post-connect moment. connectors: [{ name, cat, desc }].
export async function generateFirstWinTasksLLM(connectors, { apiKey, model, timeoutMs = 9000 } = {}) {
  if (!apiKey || !connectors?.length) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const list = connectors.map((c) => `- ${c.name} (${c.cat}): ${c.desc}`).join("\n");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "A user just connected the tools listed below to their AI agent. Write 2-3 short, concrete, " +
              "specific example tasks the agent could do right now using ONLY those tools together — the kind " +
              'of thing that proves value in the user\'s first message. Return ONLY a JSON array of strings, ' +
              "no prose outside it.",
          },
          { role: "user", content: `Connected tools:\n${list}\n\nJSON array:` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;
    let arr;
    try {
      arr = JSON.parse(match[0]);
    } catch {
      return null;
    }
    const tasks = Array.isArray(arr) ? arr.filter((t) => typeof t === "string" && t.trim()).slice(0, MAX_TASKS) : [];
    return tasks.length ? tasks : null;
  } catch (err) {
    if (process.env.RERANK_DEBUG) console.error("FIRSTWIN_DEBUG catch:", err.name, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
