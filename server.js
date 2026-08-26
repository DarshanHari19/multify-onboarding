import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the shared taxonomy (sets globalThis.TAXONOMY) — same file the browser uses.
await import("./public/taxonomy.js");
const { CONNECTORS, ROLES, FALLBACK_INTENTS } = globalThis.TAXONOMY;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";

/* ============================ EVENT STORE ================================
   Funnel stages, in order. Everything is an in-memory event:
   { ts, stage, connectorId, role, surface }
   Seeded with realistic baseline data on boot; live events append on top. */
const STAGES = ["recommended", "clicked", "signed_up", "connected", "activated"];
const events = [];

// Deterministic RNG so the seeded baseline looks the same every run.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const ROLE_KEYS = Object.keys(ROLES);
const SURFACES = ["onboarding", "in_chat"];

// Per-connector "appeal" so some convert much better than others (realistic).
const APPEAL = {}; Object.keys(CONNECTORS).forEach((id) => (APPEAL[id] = 0.25 + rand() * 0.5));

function seedBaseline() {
  const now = Date.now();
  const DAY = 86400000;
  for (let d = 13; d >= 0; d--) {
    const dayTs = now - d * DAY;
    for (const id of Object.keys(CONNECTORS)) {
      // onboarding converts materially better than in-chat — the core thesis.
      for (const surface of SURFACES) {
        const surfaceBoost = surface === "onboarding" ? 1.6 : 1.0;
        const recs = Math.round((3 + rand() * 9));
        for (let i = 0; i < recs; i++) {
          const role = ROLE_KEYS[Math.floor(rand() * ROLE_KEYS.length)];
          push(dayTs, "recommended", id, role, surface);
          // Walk down the funnel probabilistically.
          const ctr = 0.55 * APPEAL[id] * surfaceBoost;
          if (rand() < ctr) {
            push(dayTs, "clicked", id, role, surface);
            if (rand() < 0.7) {
              push(dayTs, "signed_up", id, role, surface);
              if (rand() < 0.85) {
                push(dayTs, "connected", id, role, surface);
                if (rand() < 0.6) push(dayTs, "activated", id, role, surface);
              }
            }
          }
        }
      }
    }
  }
}
function push(ts, stage, connectorId, role, surface) {
  events.push({ ts, stage, connectorId, role, surface });
}
seedBaseline();

/* ============================ LLM RECOMMEND ==============================
   Real hybrid engine: deterministic role bundle + LLM mapping of free text.
   Falls back to keyword matching if no key / the call fails. */
function catalogForPrompt() {
  return Object.entries(CONNECTORS)
    .map(([id, c]) => `- ${id}: ${c.name} — ${c.cat} — ${c.desc}`)
    .join("\n");
}

function fallbackMatch(text) {
  const t = (text || "").toLowerCase();
  const hits = new Set();
  for (const rule of FALLBACK_INTENTS) {
    if (rule.kw.some((k) => t.includes(k))) rule.ids.forEach((id) => hits.add(id));
  }
  return [...hits];
}

function parseIdArray(str) {
  try {
    const m = str.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((id) => CONNECTORS[id]) : [];
  } catch {
    return [];
  }
}

async function llmMatch(text) {
  if (!OPENROUTER_API_KEY) return null; // signal: no key
  const body = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You map a user's plain-English need to connector IDs from a fixed catalog. " +
          "Return ONLY a JSON array of matching connector id strings (the part before the colon), " +
          "most relevant first, max 6. If nothing fits, return []. No prose.",
      },
      { role: "user", content: `Catalog:\n${catalogForPrompt()}\n\nUser need: "${text}"\n\nJSON array of ids:` },
    ],
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return parseIdArray(content);
}

app.post("/api/recommend", async (req, res) => {
  const { needText } = req.body || {};
  if (!needText || !needText.trim()) return res.json({ ids: [], source: "empty" });
  try {
    const llm = await llmMatch(needText);
    if (llm === null) return res.json({ ids: fallbackMatch(needText), source: "fallback-nokey" });
    if (llm.length === 0) return res.json({ ids: fallbackMatch(needText), source: "fallback-empty" });
    return res.json({ ids: llm, source: "llm", model: OPENROUTER_MODEL });
  } catch (e) {
    return res.json({ ids: fallbackMatch(needText), source: "fallback-error", error: String(e.message) });
  }
});

/* ============================ EVENT CAPTURE ============================= */
app.post("/api/events", (req, res) => {
  const batch = Array.isArray(req.body) ? req.body : [req.body];
  let n = 0;
  for (const e of batch) {
    if (!e || !STAGES.includes(e.stage) || !CONNECTORS[e.connectorId]) continue;
    push(Date.now(), e.stage, e.connectorId, e.role || "unknown", e.surface || "onboarding");
    n++;
  }
  res.json({ ok: true, recorded: n });
});

/* ============================== METRICS ================================
   Optional filters: ?connector=hubspot&role=sales&surface=onboarding */
app.get("/api/metrics", (req, res) => {
  const { connector, role, surface } = req.query;
  const rows = events.filter(
    (e) =>
      (!connector || e.connectorId === connector) &&
      (!role || e.role === role) &&
      (!surface || e.surface === surface)
  );

  const funnel = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const byRole = {}, bySurface = {}, byConnector = {};
  const DAY = 86400000, now = Date.now();
  const series = {}; // dayIndex -> signed_up count (the "leads" line)

  for (const e of rows) {
    funnel[e.stage]++;
    if (e.stage === "signed_up") {
      (byRole[e.role] ||= { signed_up: 0 }).signed_up++;
      (bySurface[e.surface] ||= { recommended: 0, signed_up: 0 }).signed_up++;
      const dayIdx = Math.floor((now - e.ts) / DAY);
      series[dayIdx] = (series[dayIdx] || 0) + 1;
    }
    if (e.stage === "recommended") (bySurface[e.surface] ||= { recommended: 0, signed_up: 0 }).recommended++;
    if (e.stage === "recommended" || e.stage === "signed_up") {
      byConnector[e.connectorId] ||= { name: CONNECTORS[e.connectorId].name, ico: CONNECTORS[e.connectorId].ico, recommended: 0, signed_up: 0 };
      byConnector[e.connectorId][e.stage]++;
    }
  }
  // bySurface conversion (the headline: onboarding vs in-chat)
  for (const s of Object.keys(bySurface)) {
    const o = bySurface[s];
    o.conversion = o.recommended ? o.signed_up / o.recommended : 0;
  }
  // per-connector conversion table
  const connectorTable = Object.entries(byConnector)
    .map(([id, o]) => ({ id, ...o, conversion: o.recommended ? o.signed_up / o.recommended : 0 }))
    .sort((a, b) => b.signed_up - a.signed_up);

  // 14-day leads series (oldest -> newest)
  const seriesArr = [];
  for (let d = 13; d >= 0; d--) seriesArr.push({ day: d, leads: series[d] || 0 });

  res.json({
    generatedAt: now,
    funnel,
    stages: STAGES,
    conversionOverall: funnel.recommended ? funnel.connected / funnel.recommended : 0,
    activationRate: funnel.connected ? funnel.activated / funnel.connected : 0,
    netNewLeads: funnel.signed_up,
    byRole,
    bySurface,
    connectorTable,
    series: seriesArr,
    connectors: Object.fromEntries(Object.entries(CONNECTORS).map(([id, c]) => [id, { name: c.name, ico: c.ico }])),
  });
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, llm: OPENROUTER_API_KEY ? "enabled" : "fallback-only", model: OPENROUTER_MODEL, events: events.length })
);

app.listen(PORT, () => {
  console.log(`\n  Multify onboarding prototype running:`);
  console.log(`  → Recommender:  http://localhost:${PORT}/`);
  console.log(`  → Dashboard:    http://localhost:${PORT}/dashboard.html`);
  console.log(`  → LLM engine:   ${OPENROUTER_API_KEY ? "ENABLED (" + OPENROUTER_MODEL + ")" : "fallback keyword matching (no OPENROUTER_API_KEY set)"}\n`);
});
