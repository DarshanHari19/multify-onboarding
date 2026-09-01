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
let source = {};     // id -> "role" | "text" — lets pickRole() replace only its
                      // own previous picks on a role switch without touching
                      // anything the free-text layer added (and vice versa).
let feedbackChoice = {}; // id -> "up" | "down" | null — lets a thumbs vote be changed/undone
let infoOpen = {}; // id -> bool — whether a RAG card's click-to-expand info panel is open
function displayFor(id) { return CONNECTORS[id] || extraMeta[id]; }
const SURFACE = "onboarding"; // this whole flow is the onboarding surface

let affinity = {}; // connectorId -> { recommended, connected, rate, n }, for the currently selected role
let currentRoleBundle = null; // ROLES[selectedRole].bundle — fed to adjustBundle() below
let promotions = {}; // connectorId -> { rate, n } for suggested entries data-promoted to auto

/* ---- flywheel: per-role connect-rate cue (computed, never hardcoded) ---- */
const AFFINITY_MIN_N = 20;
const PROMOTE_THRESHOLD = 0.6;
async function loadAffinity(role) {
  try {
    const res = await fetch(`/api/affinity?role=${encodeURIComponent(role)}`);
    const data = await res.json();
    if (selectedRole === role) { affinity = data || {}; reorderRoleBundle(); renderConnectors(); }
  } catch (e) { /* no cue shown if the fetch fails — non-critical */ }
}

// Duplicated from lib/sensitivity.js — app.js is a classic script (no
// module loader, see the firstwin.js note below), so pure helpers used
// client-side get copied here rather than imported. Keep in sync.
const SENSITIVE_FINANCE_KEYWORDS = [
  "pay", "payment", "bank", "invoice", "billing", "wallet", "ledger",
  "crypto", "revenue", "stripe", "finance", "accounting", "payroll", "tax",
];
const SENSITIVE_EMAIL_KEYWORDS = [
  "email", "e-mail", "mail", "inbox", "gmail", "imap", "smtp", "mailbox",
];
function isSensitiveConnector(connector) {
  const { name = "", cat = "", desc = "" } = connector || {};
  const text = `${name} ${cat} ${desc}`.toLowerCase();
  if (!text.trim()) return null;
  if (SENSITIVE_FINANCE_KEYWORDS.some((kw) => text.includes(kw))) return "finance";
  if (SENSITIVE_EMAIL_KEYWORDS.some((kw) => text.includes(kw))) return "email";
  return null;
}

// Duplicated from lib/bundleadjust.js (unit-tested in test/bundleadjust.test.js)
// for the same classic-script reason as above. Keep in sync.
function adjustBundle(bundle, aff, opts, isSensitive) {
  const { promoteThreshold = 0.6, minN = 20 } = opts || {};
  const changes = [];
  const autoGroup = [];
  const suggestedGroup = [];
  for (const entry of bundle) {
    if (entry.auto) { autoGroup.push({ ...entry }); continue; }
    const a = (aff || {})[entry.id] || { rate: 0, n: 0 };
    if (a.rate >= promoteThreshold && a.n >= minN && !isSensitive(entry)) {
      autoGroup.push({ ...entry, auto: true });
      changes.push({ id: entry.id, type: "promoted", rate: a.rate, n: a.n });
    } else {
      suggestedGroup.push({ ...entry });
    }
  }
  const nOf = (id) => ((aff || {})[id] || {}).n || 0;
  const rateOf = (id) => ((aff || {})[id] || {}).rate || 0;
  function sortByRateDesc(group) {
    const sufficient = group.filter((e) => nOf(e.id) >= minN);
    const insufficient = group.filter((e) => nOf(e.id) < minN);
    sufficient.sort((a, b) => rateOf(b.id) - rateOf(a.id));
    return [...sufficient, ...insufficient];
  }
  return { ordered: [...sortByRateDesc(autoGroup), ...sortByRateDesc(suggestedGroup)], changes };
}

// Applies adjustBundle() to the currently selected role's curated bundle:
// promotes qualifying suggested connectors to auto (never demotes, never
// promotes anything isSensitiveConnector flags), and reorders `present`
// within the auto/suggested groups to match — without touching sponsored or
// free-text-sourced ids elsewhere in `present`.
function reorderRoleBundle() {
  promotions = {};
  if (!currentRoleBundle) return;
  const { ordered, changes } = adjustBundle(
    currentRoleBundle,
    affinity,
    { promoteThreshold: PROMOTE_THRESHOLD, minN: AFFINITY_MIN_N },
    (entry) => !!isSensitiveConnector(CONNECTORS[entry.id])
  );
  changes.forEach((c) => {
    if (c.type === "promoted") promotions[c.id] = { rate: c.rate, n: c.n };
  });
  ordered.forEach((entry) => {
    // Risk gate, asserted at the point defaults are applied: a promotion
    // can only ever reach here for a non-sensitive connector.
    console.assert(!promotions[entry.id] || !isSensitiveConnector(CONNECTORS[entry.id]),
      "flywheel: refusing to auto-enable a sensitive connector via promotion", entry.id);
    if (promotions[entry.id]) enabled[entry.id] = true;
  });
  const roleIds = new Set(currentRoleBundle.map((b) => b.id));
  const newOrder = ordered.map((e) => e.id);
  let i = 0;
  present = present.map((id) => (roleIds.has(id) ? newOrder[i++] : id));
}

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
  if (selectedRole === key) return; // already on this role — no-op, not a re-recommend
  selectedRole = key;
  const r = ROLES[key];
  // Additive: drop only ids this function added for a *previous* role, so
  // anything the free-text layer contributed survives a role switch. An id
  // already present (e.g. matched by both) keeps its existing enabled/why
  // rather than being clobbered back to the bundle default.
  present = present.filter((id) => source[id] !== "role" && source[id] !== "sponsored");
  const newIds = [];
  // Sponsored slot goes first (renders on top, like an ad banner) — a paid,
  // clearly-labeled placement, distinct from the fit-based bundle below.
  // Illustrative only (CLAUDE.md REAL-vs-ILLUSTRATIVE): never auto-enabled,
  // no separate event tracking, just a labeled UI slot.
  if (r.featured && !present.includes(r.featured.id)) {
    present.push(r.featured.id);
    enabled[r.featured.id] = false;
    newIds.push(r.featured.id);
  }
  if (r.featured) { reasons[r.featured.id] = r.featured.why; source[r.featured.id] = "sponsored"; }
  r.bundle.forEach((b) => {
    if (!present.includes(b.id)) {
      present.push(b.id);
      enabled[b.id] = b.auto;
      newIds.push(b.id);
    }
    reasons[b.id] = b.why;
    source[b.id] = "role";
  });
  $("bundlePanel").classList.remove("hidden");
  $("s3").classList.add("active");
  $("bundleHint").innerHTML = `Curated for <b>${r.title}</b>. Auto-enabled ones are on by default — toggle any off, or add more below.`;
  $("bundleCaption").classList.remove("hidden");
  affinity = {};
  currentRoleBundle = r.bundle;
  reorderRoleBundle(); // no-op ordering until affinity loads, but keeps state consistent
  loadAffinity(key);
  renderRoles(); renderConnectors();
  if (newIds.length) trackMany("recommended", newIds); // only genuinely new recommendations
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
    source[id] = "text";
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
    const aff = affinity[id];
    const inBundle = selectedRole && ROLES[selectedRole].bundle.some((b) => b.id === id);
    const promo = promotions[id];
    const showCue = inBundle && aff && aff.n >= AFFINITY_MIN_N && !promo;
    // RAG/registry results only (curated bundle entries carry no links) —
    // clickable name reveals the registry description + provenance links,
    // mirroring Multify's own "click an MCP to see its detail" pattern
    // instead of dumping an AI-written description on every card by default.
    const hasInfo = !!(k.websiteUrl || k.repoUrl);
    const infoIsOpen = hasInfo && !!infoOpen[id];
    const isSponsored = source[id] === "sponsored";
    const row = document.createElement("div");
    row.className = "conn" + (needsConsent ? " needs-consent" : "") + (isSponsored ? " featured" : "");
    row.innerHTML = `
      <div class="ico"><img src="${k.ico}" alt="" /></div>
      <div class="meta">
        <div class="name">
          ${hasInfo ? `<button class="conn-name-btn" type="button">${k.name}<span class="info-dot">i</span></button>` : k.name}
          <span class="tag">${k.cat}</span>
          ${isSponsored ? '<span class="tag sponsored">Sponsored</span>' : ""}
          ${k.isNew ? '<span class="tag new">new · remote MCP</span>' : ""}
        </div>
        <div class="why">${reasons[id] || ""}</div>
        ${promo ? `<div class="affinity-cue promoted">Promoted to auto — ${Math.round(promo.rate * 100)}% of ${ROLES[selectedRole].title} users connect this · based on connection data, illustrative</div>` : ""}
        ${showCue ? `<div class="affinity-cue">${Math.round(aff.rate * 100)}% of ${ROLES[selectedRole].title} users who saw this connected it · based on connection data, illustrative</div>` : ""}
        ${needsConsent ? `<div class="consent"><span class="consent-icon">${ICONS.alertTriangle}</span>${CONSENT_COPY[k.sensitive]} — enable?</div>` : ""}
        ${hasInfo ? `<div class="conn-popover${infoIsOpen ? "" : " hidden"}">
          ${k.desc ? `<p>${k.desc}</p>` : ""}
          <div class="links">
            ${k.websiteUrl ? `<a href="${k.websiteUrl}" target="_blank" rel="noopener noreferrer">Official website</a>` : ""}
            ${k.repoUrl ? `<a href="${k.repoUrl}" target="_blank" rel="noopener noreferrer">Setup docs</a>` : ""}
          </div>
        </div>` : ""}
      </div>
      <div class="feedback" title="This trains your bundles">
        <button class="fbtn${feedbackChoice[id] === "up" ? " chosen" : ""}" data-dir="up" aria-label="Good suggestion">${ICONS.thumbsUp}</button>
        <button class="fbtn${feedbackChoice[id] === "down" ? " chosen" : ""}" data-dir="down" aria-label="Not useful">${ICONS.thumbsDown}</button>
      </div>
      ${needsConsent
        ? `<button class="btn ghost consent-btn">Enable</button>`
        : `<button class="toggle ${on ? "on" : ""}" aria-label="toggle"><span class="knob"></span></button>`}`;
    if (needsConsent) {
      row.querySelector(".consent-btn").onclick = () => { enabled[id] = true; renderConnectors(); };
    } else {
      row.querySelector(".toggle").onclick = () => { enabled[id] = !enabled[id]; renderConnectors(); };
    }
    if (hasInfo) {
      row.querySelector(".conn-name-btn").onclick = () => { infoOpen[id] = !infoOpen[id]; renderConnectors(); };
    }
    row.querySelectorAll(".fbtn").forEach((btn) => {
      btn.onclick = () => {
        const dir = btn.dataset.dir;
        // Clicking the currently-chosen direction retracts the vote;
        // clicking the other one switches it — always re-clickable, never
        // permanently locked.
        feedbackChoice[id] = feedbackChoice[id] === dir ? null : dir;
        if (feedbackChoice[id]) track(dir === "up" ? "feedback_up" : "feedback_down", id);
        renderConnectors();
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
      present = []; enabled = {}; reasons = {}; source = {};
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
        addConnector(c.id, c.why, c.suggested, {
          name: c.name, ico: c.ico, cat: c.cat, desc: c.desc, sensitive: c.sensitive || null,
          websiteUrl: c.websiteUrl || null, repoUrl: c.repoUrl || null,
        })
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
    el.innerHTML = `
      <span>${data.searched.toLocaleString()} connectors searched</span>
      <span class="rarrow">→</span>
      <span>${data.candidatesCount} candidates</span>
      <span class="rarrow">→</span>
      <span><b>${data.picked}</b> selected</span>
    `;
    el.classList.remove("hidden");
  } else {
    el.innerHTML = "";
    el.classList.add("hidden");
  }
}

function fillNeed(s) { $("needs").value = s; }

/* ---- browsable catalog search: plain substring search over the whole
   registry (GET /api/catalog/search) — no LLM call, instant, makes the
   "spans 24,941 connectors" claim tangible by letting a user type and see
   it directly. Separate from the RAG free-text path above. ---- */
let catalogResults = [];
let catalogDebounceTimer = null;

function toggleCatalog() {
  const panel = $("catalogSearch");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  $("catalogToggle").textContent = opening ? "Hide catalog search" : "Browse the full catalog →";
  if (opening) $("catalogQuery").focus();
}

function onCatalogInput() {
  clearTimeout(catalogDebounceTimer);
  const q = $("catalogQuery").value.trim();
  if (q.length < 2) {
    catalogResults = [];
    $("catalogResults").innerHTML = "";
    $("catalogHint").textContent = "Type at least 2 characters to search.";
    return;
  }
  $("catalogHint").textContent = "Searching…";
  catalogDebounceTimer = setTimeout(() => runCatalogSearch(q), 300);
}

async function runCatalogSearch(q) {
  try {
    const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if ($("catalogQuery").value.trim() !== q) return; // a newer query has since been typed — drop this stale response
    catalogResults = data.results || [];
    if (!data.available) {
      $("catalogHint").textContent = "Catalog search isn't available in this environment (run npm run ingest && npm run build-index).";
    } else if (catalogResults.length === 0) {
      $("catalogHint").textContent = `No matches in ${data.total.toLocaleString()} connectors — try a different term.`;
    } else {
      $("catalogHint").textContent = `${catalogResults.length} of ${data.total.toLocaleString()} connectors matched "${q}".`;
    }
    renderCatalogResults();
  } catch (e) {
    $("catalogHint").textContent = "Search failed — try again.";
  }
}

function renderCatalogResults() {
  const c = $("catalogResults"); c.innerHTML = "";
  catalogResults.forEach((r) => {
    const already = present.includes(r.id);
    const row = document.createElement("div");
    row.className = "conn catalog-result";
    row.innerHTML = `
      <div class="ico"><img src="${r.ico}" alt="" /></div>
      <div class="meta">
        <div class="name">${r.name} <span class="tag">${r.cat}</span></div>
        <div class="why">${r.desc || ""}</div>
      </div>
      <button class="btn ghost catalog-add" type="button" ${already ? "disabled" : ""}>${already ? "Added ✓" : "Add"}</button>
    `;
    if (!already) row.querySelector(".catalog-add").onclick = () => addFromCatalog(r);
    c.appendChild(row);
  });
}

function addFromCatalog(r) {
  addConnector(r.id, r.why, true, {
    name: r.name, ico: r.ico, cat: r.cat, desc: r.desc,
    sensitive: r.sensitive || null, websiteUrl: r.websiteUrl || null, repoUrl: r.repoUrl || null,
  });
  $("bundlePanel").classList.remove("hidden");
  if (!$("bundleHint").innerHTML.trim()) $("bundleHint").innerHTML = "Added from the full catalog search:";
  renderConnectors();
  renderCatalogResults();
}

function resetAll() {
  selectedRole = null; enabled = {}; present = []; reasons = {}; extraMeta = {}; affinity = {};
  source = {}; feedbackChoice = {}; infoOpen = {}; currentRoleBundle = null; promotions = {};
  $("needs").value = "";
  $("bundlePanel").classList.add("hidden");
  $("bundleCaption").classList.add("hidden");
  $("firstWinPanel").classList.add("hidden");
  $("s3").classList.remove("active");
  renderRetrievalNote({});
  renderRoles();
  catalogResults = [];
  $("catalogQuery").value = "";
  $("catalogResults").innerHTML = "";
  $("catalogHint").textContent = "Type at least 2 characters to search.";
  $("catalogSearch").classList.add("hidden");
  $("catalogToggle").textContent = "Browse the full catalog →";
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
