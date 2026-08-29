/* Recommender client. Uses window.TAXONOMY (taxonomy.js) for role bundles,
   calls POST /api/recommend for the LLM free-text layer, and posts funnel
   events to POST /api/events so the dashboard updates live. */
const { CONNECTORS, ROLES } = window.TAXONOMY;

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

function renderConnectors() {
  const c = $("connectors"); c.innerHTML = "";
  present.forEach((id) => {
    const k = displayFor(id); if (!k) return;
    const on = !!enabled[id];
    const row = document.createElement("div");
    row.className = "conn";
    row.innerHTML = `
      <div class="ico"><img src="${k.ico}" alt="" /></div>
      <div class="meta">
        <div class="name">${k.name}
          <span class="tag">${k.cat}</span>
          ${k.isNew ? '<span class="tag new">new · remote MCP</span>' : ""}
        </div>
        <div class="why">${reasons[id] || ""}</div>
      </div>
      <button class="toggle ${on ? "on" : ""}" aria-label="toggle"><span class="knob"></span></button>`;
    row.querySelector(".toggle").onclick = () => { enabled[id] = !enabled[id]; renderConnectors(); };
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
async function interpretNeeds() {
  const text = $("needs").value.trim();
  if (!text) return;
  if (!selectedRole) {
    present = []; enabled = {}; reasons = {};
    $("bundlePanel").classList.remove("hidden");
    $("bundleHint").innerHTML = "Based on what you described:";
  }
  $("spin").classList.remove("hidden");
  $("interpretBtn").disabled = true;
  try {
    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needText: text }),
    });
    const data = await res.json();
    const connectors = data.connectors || [];
    if (connectors.length === 0) {
      $("bundleHint").innerHTML = "Couldn't map that to a connector — try naming a tool or task type.";
    } else {
      connectors.forEach((c) =>
        addConnector(c.id, c.why, c.suggested, { name: c.name, ico: c.ico, cat: c.cat, desc: c.desc })
      );
    }
    renderConnectors();
    $("bundlePanel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    $("bundleHint").innerHTML = "Something went wrong reaching the model. Try again.";
  } finally {
    $("spin").classList.add("hidden");
    $("interpretBtn").disabled = false;
  }
}

function fillNeed(s) { $("needs").value = s; }

function resetAll() {
  selectedRole = null; enabled = {}; present = []; reasons = {}; extraMeta = {};
  $("needs").value = "";
  $("bundlePanel").classList.add("hidden");
  $("s3").classList.remove("active");
  renderRoles();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function doConnect() {
  const chosen = present.filter((id) => enabled[id]);
  // fire the rest of the funnel for each enabled connector
  chosen.forEach((id) => { track("clicked", id); track("signed_up", id); track("connected", id); });
  const names = chosen.map((id) => displayFor(id).name);
  alert(
    "Connecting: " + names.join(", ") +
    "\n\nEach opens an account-creation / OAuth flow with the service (the lead-gen moment) " +
    "and lands auto-enabled in the user's first chat.\n\nThese events were just sent to the " +
    "partner attribution dashboard — open it to watch the funnel update."
  );
}

document.addEventListener("DOMContentLoaded", () => {
  renderRoles();
  $("connectBtn").onclick = doConnect;
});
