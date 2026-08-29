// Infers one of the curated role keys from a free-text self-description, so
// a user can skip the role-picker grid entirely. Mirrors lib/rerank.js: a
// pure, testable validator (anti-hallucination gate) plus an untested network
// call exercised via the live demo — same 9s timeout/abort discipline.

// Anti-hallucination gate: only a key that's actually one of the six curated
// roles is accepted; anything else (typo, invented role, empty) -> null so
// the caller falls back to the plain free-text (RAG-only) path.
export function validateRole(raw, roleKeys) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return roleKeys.includes(key) ? key : null;
}

function rolesForPrompt(roles) {
  return Object.entries(roles).map(([key, r]) => `- ${key}: ${r.title} — ${r.blurb}`).join("\n");
}

// roles: TAXONOMY.ROLES ({ key: { title, blurb, ... } }). Returns
// { role: "<key>" } on a confident match, or null on timeout/error/no-key/
// no-match — the caller then falls back to the existing free-text-only path.
export async function inferRoleFromText(text, roles, { apiKey, model, timeoutMs = 9000 } = {}) {
  if (!apiKey) return null;

  const roleKeys = Object.keys(roles);
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
              "You infer a user's role from a short self-description, choosing ONLY from the roles listed below " +
              "(never invent a key outside this list). Return ONLY a JSON object " +
              '{"role": "<one of the listed keys>"}. If nothing fits confidently, return {"role": null}. ' +
              "No prose outside the JSON object.",
          },
          { role: "user", content: `Roles:\n${rolesForPrompt(roles)}\n\nSelf-description: "${text}"\n\nJSON object:` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
    const role = validateRole(parsed?.role, roleKeys);
    return role ? { role } : null;
  } catch (err) {
    if (process.env.RERANK_DEBUG) console.error("ROLEINFER_DEBUG catch:", err.name, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
