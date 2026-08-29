/* Recommender client. Uses window.TAXONOMY (taxonomy.js) for role bundles,
   calls POST /api/recommend for the LLM free-text layer, and posts funnel
   events to POST /api/events so the dashboard updates live. */
const { CONNECTORS, ROLES, ICONS, FIRST_WINS } = window.TAXONOMY;

let selectedRole = null;
let enabled = {};   // id -> bool
let present = [];   // ordered ids currently shown
let reasons = {};   // id -> why
let extraMeta = {}; // id -> {name, ico, cat, desc} for ids not in TAXONOMY.CONNECTORS
                     // (RAG/registry connectors — the /api/recommend payload carries
                     // their display metadata since they aren't in the curated catalog)
function displayFor(id) { return CONNECTORS[id] || extraMeta[id]; }
const SURFACE = "onboarding"; // this whole flow is the onboarding surface

const $ = (id) => document.getElementById(id);

/* ---- event capture (fire-and-forget) ---- */
function track(stage, connectorId) {
  const payload = { stage, connectorId, role: selectedRole || "unknown", surface: SURFACE };
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
function trackMany(stage, ids) { ids.forEach((id) => track(stage, id)); }

/* ---- roles ---- */
function renderRoles() {
  const c = $("roles"); c.innerHTML = "";
  Object.entries(ROLES).forEach(([key, r]) => {
    const d = document.createElement("button");
    d.className = "role" + (selectedRole === key ? " sel" : "");
    d.onclick = () => pickRole(key);
    d.innerHTML = `<div class="role-icon">${r.icon}</div><h3>${r.title}</h3><p>${r.blurb}</p>`;
    c.appendChild(d);
  });
}

function pickRole(key) {
  selectedRole = key;
  const r = ROLES[key];
  present = r.bundle.map((b) => b.id);
  enabled = {}; reasons = {};
  r.bundle.forEach((b) => { enabled[b.id] = b.auto; reasons[b.id] = b.why; });
  $("bundlePanel").classList.remove("hidden");
  $("s3").classList.add("active");
  $("bundleHint").innerHTML = `Curated for <b>${r.title}</b>. Auto-enabled ones are on by default — toggle any off, or add more below.`;
  renderRetrievalNote({});
  renderRoles(); renderConnectors();
  trackMany("recommended", present); // the whole bundle was recommended
  $("bundlePanel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function addConnector(id, why, suggested, meta) {
  if (meta) extraMeta[id] = meta;
  if (!present.includes(id)) {
    present.push(id);
    // Risk gate: anything surfaced via free text (curated keyword match OR
    // RAG) starts OFF — only hand-curated role-bundle entries auto-enable.
    enabled[id] = !suggested;
    reasons[id] = why || "Matched from what you described";
    track("recommended", id);
  }
  // Already present (e.g. from the role bundle) — don't force its toggle;
  // just refresh the reason text so the free-text "why" still shows.
  else if (why) reasons[id] = why;
}

const CONSENT_COPY = {
  finance: "This connector can access financial data",
  email: "This connector can read & send your email",
};

function renderConnectors() {
  const c = $("connectors"); c.innerHTML = "";
  present.forEach((id) => {
    const k = displayFor(id); if (!k) return;
    const on = !!enabled[id];
    // Consent gate (RAG results only, per server's `sensitive` flag): a
    // finance/email-touching suggestion doesn't get a bare toggle — it gets
    // an explicit opt-in until the user consents, then behaves like any
    // other connector (freely toggleable).
    const needsConsent = !!k.sensitive && !on;
    const row = document.createElement("div");
    row.className = "conn" + (needsConsent ? " needs-consent" : "");
    row.innerHTML = `
      <div class="ico"><img src="${k.ico}" alt="" /></div>
      <div class="meta">
        <div class="name">${k.name}
          <span class="tag">${k.cat}</span>
          ${k.isNew ? '<span class="tag new">new · remote MCP</span>' : ""}
        </div>
        <div class="why">${reasons[id] || ""}</div>
        ${needsConsent ? `<div class="consent"><span class="consent-icon">${ICONS.alertTriangle}</span>${CONSENT_COPY[k.sensitive]} — enable?</div>` : ""}
      </div>
      <div class="feedback" title="This trains your bundles">
        <button class="fbtn" data-dir="up" aria-label="Good suggestion">${ICONS.thumbsUp}</button>
        <button class="fbtn" data-dir="down" aria-label="Not useful">${ICONS.thumbsDown}</button>
      </div>
      ${needsConsent
        ? `<button class="btn ghost consent-btn">Enable</button>`
        : `<button class="toggle ${on ? "on" : ""}" aria-label="toggle"><span class="knob"></span></button>`}`;
    if (needsConsent) {
      row.querySelector(".consent-btn").onclick = () => { enabled[id] = true; renderConnectors(); };
    } else {
      row.querySelector(".toggle").onclick = () => { enabled[id] = !enabled[id]; renderConnectors(); };
    }
    row.querySelectorAll(".fbtn").forEach((btn) => {
      btn.onclick = () => {
        track(btn.dataset.dir === "up" ? "feedback_up" : "feedback_down", id);
        row.querySelectorAll(".fbtn").forEach((b) => (b.disabled = true));
        btn.classList.add("chosen");
      };
    });
    c.appendChild(row);
  });
  updateSummary();
}

function updateSummary() {
  const n = present.filter((id) => enabled[id]).length;
  $("summary").innerHTML = `✓ <b style="color:#fff">${n}</b>&nbsp; connector${n === 1 ? "" : "s"} will be enabled and ready in your first chat.`;
  $("connectBtn").disabled = n === 0;
  $("connectBtn").textContent = `Connect ${n} connector${n === 1 ? "" : "s"} & continue →`;
}

/* ---- hybrid free-text layer (real LLM via backend) ---- */
// One input serves both jobs: if no role is selected yet, first try to infer
// one from the same text (POST /api/infer-role) and apply its curated bundle
// via the existing pickRole() — then always run the RAG free-text path below
// on top, so the same description sets up BOTH the role and the tools. If a
// role is already selected, this behaves exactly as before (RAG only).
async function interpretNeeds() {
  const text = $("needs").value.trim();
  if (!text) return;
  $("spin").classList.remove("hidden");
  $("interpretBtn").disabled = true;
  try {
    if (!selectedRole) {
      try {
        const rres = await fetch("/api/infer-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const rdata = await rres.json();
        if (rdata.role) {
          pickRole(rdata.role); // sets selectedRole, applies the curated bundle, tracks "recommended"
          $("bundleHint").innerHTML = `Curated for <b>${rdata.title}</b> (inferred from what you described). Auto-enabled ones are on by default — toggle any off, or add more below.`;
        }
      } catch (e) { /* inference failed — fall through to the plain free-text path */ }
    }
    if (!selectedRole) {
      present = []; enabled = {}; reasons = {};
      $("bundlePanel").classList.remove("hidden");
      $("bundleHint").innerHTML = "Based on what you described:";
    }

    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needText: text }),
    });
    const data = await res.json();
    const connectors = data.connectors || [];
    if (connectors.length === 0 && present.length === 0) {
      $("bundleHint").innerHTML = "Couldn't map that to a connector — try naming a tool or task type.";
    } else {
      connectors.forEach((c) =>
        addConnector(c.id, c.why, c.suggested, { name: c.name, ico: c.ico, cat: c.cat, desc: c.desc, sensitive: c.sensitive || null })
      );
    }
    renderRetrievalNote(data);
    renderConnectors();
    $("bundlePanel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    $("bundleHint").innerHTML = "Something went wrong reaching the model. Try again.";
  } finally {
    $("spin").classList.add("hidden");
    $("interpretBtn").disabled = false;
  }
}

// Retrieval transparency: the RAG path returns real searched/candidatesCount/
// picked counts (see server.js /api/recommend) — surface them verbatim rather
// than fabricating anything for the curated/keyword fallback paths.
function renderRetrievalNote(data) {
  const el = $("retrievalNote");
  if (data.source && data.source.startsWith("rag") && typeof data.searched === "number") {
    el.innerHTML = `Searched <b>${data.searched.toLocaleString()}</b> connectors → <b>${data.candidatesCount}</b> candidates → selected <b>${data.picked}</b> · via ${data.model}`;
    el.classList.remove("hidden");
  } else {
    el.innerHTML = "";
    el.classList.add("hidden");
  }
}

function fillNeed(s) { $("needs").value = s; }

function resetAll() {
  selectedRole = null; enabled = {}; present = []; reasons = {}; extraMeta = {};
  $("needs").value = "";
  $("bundlePanel").classList.add("hidden");
  $("firstWinPanel").classList.add("hidden");
  $("s3").classList.remove("active");
  renderRetrievalNote({});
  renderRoles();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Mirrors lib/firstwin.js's buildFirstWinTasks (server/Node side, unit-tested
// in test/firstwin.test.js). Duplicated here rather than imported because
// app.js is a classic script (no bundler/module loader) relying on global
// onclick bindings — keep in sync if the selection logic changes.
const MAX_FIRST_WIN_TASKS = 3;
const FIRST_WIN_SIMILARITY_THRESHOLD = 0.5;
function firstWinTokenize(s) { return new Set((s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)); }
function firstWinJaccard(a, b) {
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
function isFirstWinNearDuplicate(line, existingLines) {
  const tokens = firstWinTokenize(line);
  return existingLines.some((existing) => firstWinJaccard(tokens, firstWinTokenize(existing)) >= FIRST_WIN_SIMILARITY_THRESHOLD);
}
function buildFirstWinTasks(ids) {
  const idSet = new Set(ids);
  const tasks = [];
  for (const combo of FIRST_WINS.__combos || []) {
    if (combo.ids.every((id) => idSet.has(id)) && !isFirstWinNearDuplicate(combo.task, tasks)) {
      tasks.push(combo.task);
      if (tasks.length >= MAX_FIRST_WIN_TASKS) break;
    }
  }
  if (tasks.length < MAX_FIRST_WIN_TASKS) {
    for (const id of idSet) {
      const lines = FIRST_WINS[id];
      if (!lines) continue;
      for (const line of lines) {
        if (isFirstWinNearDuplicate(line, tasks)) continue;
        tasks.push(line);
        if (tasks.length >= MAX_FIRST_WIN_TASKS) break;
      }
      if (tasks.length >= MAX_FIRST_WIN_TASKS) break;
    }
  }
  return { tasks, needLLM: tasks.length === 0 };
}

function renderFirstWin(tasks) {
  $("bundlePanel").classList.add("hidden");
  $("firstWinTasks").innerHTML = tasks.map((t) => `<div class="firstwin-task">${t}</div>`).join("");
  $("firstWinPanel").classList.remove("hidden");
  $("firstWinPanel").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function doConnect() {
  const chosen = present.filter((id) => enabled[id]);
  // fire the rest of the funnel for each enabled connector
  chosen.forEach((id) => { track("clicked", id); track("signed_up", id); track("connected", id); });

  $("connectBtn").disabled = true;
  const { tasks, needLLM } = buildFirstWinTasks(chosen);
  let finalTasks = tasks;

  // Hybrid (locked decision): only hit the LLM gap-fill when the curated
  // templates produced nothing (an all-RAG/registry enabled set) — the
  // common curated-role demo path makes zero extra LLM calls here.
  if (needLLM) {
    try {
      const res = await fetch("/api/first-win", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectors: chosen.map((id) => { const k = displayFor(id); return { name: k.name, cat: k.cat, desc: k.desc }; }) }),
      });
      const data = await res.json();
      if (data.tasks && data.tasks.length) finalTasks = data.tasks;
    } catch (e) { /* fall through to the generic line below */ }
  }
  if (!finalTasks.length) {
    finalTasks = ["Ask your agent what it can already see across your connected tools — it's ready now."];
  }
  renderFirstWin(finalTasks);
}

document.addEventListener("DOMContentLoaded", () => {
  renderRoles();
  $("connectBtn").onclick = doConnect;
  $("interpretBtn").innerHTML = `<span class="btn-icon">${ICONS.wandSparkles}</span>Set me up`;
});
