/* Partner attribution dashboard. Polls /api/metrics and re-renders.
   Updates live because the recommender posts events to the same backend. */
const $ = (id) => document.getElementById(id);
const { ICONS } = window.TAXONOMY;
const STAGE_LABEL = {
  recommended: "Recommended", clicked: "Clicked connect",
  signed_up: "Signed up (lead)", connected: "Connected", activated: "Activated",
};
const LIVE_STAGES = [
  { key: "recommended", label: "Recommended" },
  { key: "connected", label: "Connected" },
  { key: "signed_up", label: "Leads" },
];
const LEAD_VALUE = 12; // illustrative $ per net-new lead
let trendChart = null;
let filtersInit = false;
let lastLive = null; // previous liveSummary, to detect an increase and pulse it
let lastMetrics = null; // most recent /api/metrics payload, for the export report

function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }
function fmtNum(n) { return n.toLocaleString(); }
function convClass(x) { return x >= 0.18 ? "good" : x >= 0.1 ? "mid" : "low"; }

/* Chart colors come from the CSS theme tokens (not hardcoded) so the trend
   chart re-colors when the light/dark toggle flips — see theme.js. */
function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

async function load() {
  const connector = $("connectorFilter").value;
  const surface = $("surfaceFilter").value;
  const qs = new URLSearchParams();
  if (connector) qs.set("connector", connector);
  if (surface) qs.set("surface", surface);
  const res = await fetch("/api/metrics?" + qs.toString());
  const m = await res.json();
  lastMetrics = m;

  if (!filtersInit) initConnectorFilter(m.connectors);
  updatePartnerViewUI(connector, m.connectors);

  // KPIs
  $("kpiLeads").textContent = fmtNum(m.netNewLeads);
  $("kpiConv").textContent = fmtPct(m.conversionOverall);
  $("kpiAct").textContent = fmtPct(m.activationRate);
  $("kpiValue").textContent = "$" + fmtNum(m.netNewLeads * LEAD_VALUE);

  renderFunnel(m.funnel, m.stages);
  renderTrend(m.series);
  renderSurface(m.bySurface);
  renderConnectors(m.connectorTable);
  renderLiveStats(m.liveSummary);
  renderFeedbackSummary(m.feedback, m.connectors);
}

function renderLiveStats(liveSummary) {
  $("liveStats").innerHTML = LIVE_STAGES.map(({ key, label }) => {
    const n = (liveSummary && liveSummary[key]) || 0;
    const pulsed = lastLive && n > lastLive[key];
    return `<div class="live-stat${pulsed ? " pulse" : ""}">
      <span class="live-stat-label">${label}</span>
      <span class="live-stat-value">+${fmtNum(n)}</span>
    </div>`;
  }).join("");
  lastLive = liveSummary;
}

function renderFeedbackSummary(feedback, connectors) {
  const f = feedback || { up: 0, down: 0, byConnector: {} };
  const rows = Object.entries(f.byConnector)
    .map(([id, v]) => ({ id, ...v, name: (connectors[id] && connectors[id].name) || id }))
    .sort((a, b) => (b.up - b.down) - (a.up - a.down))
    .slice(0, 5)
    .map((c) => `<div class="fb-row"><span>${c.name}</span><span class="fb-counts">+${c.up} / −${c.down}</span></div>`)
    .join("");
  $("feedbackSummary").innerHTML =
    `<div class="fb-totals">
      <span><span class="fb-icon up">${ICONS.thumbsUp}</span>${fmtNum(f.up)}</span>
      <span><span class="fb-icon down">${ICONS.thumbsDown}</span>${fmtNum(f.down)}</span>
    </div>` + (rows || `<div class="count">No feedback yet.</div>`);
}

// Item 7 — advertiser export: the existing ?connector= filter already
// re-scopes every metric to one partner (server.js /api/metrics). This just
// relabels the filter as "Viewing as: X" and reveals the Export button,
// hidden while "All connectors" is selected — exporting a rollup only makes
// sense once you're viewing a single partner.
function updatePartnerViewUI(connectorId, connectors) {
  const label = $("partnerLabel");
  const btn = $("exportBtn");
  const partner = connectorId && connectors[connectorId];
  if (partner) {
    label.textContent = `Viewing as: ${partner.name}`;
    btn.classList.remove("hidden");
  } else {
    label.textContent = "Partner view:";
    btn.classList.add("hidden");
  }
}

// Renders the 14-day trend as a standalone, print-safe image — fixed ink
// colors (not the live theme tokens, which may be light-on-dark and vanish
// on a printed white page), on a small offscreen canvas never added to the
// visible DOM.
function buildPrintTrendImage(series) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 220;
  const chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: series.map((p) => (p.day === 0 ? "today" : `-${p.day}d`)),
      datasets: [{ data: series.map((p) => p.leads), borderColor: "#111", backgroundColor: "rgba(17,17,17,.08)", fill: true, tension: .35, pointRadius: 2 }],
    },
    options: {
      responsive: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#ddd" }, ticks: { color: "#333", maxTicksLimit: 8 } },
        y: { grid: { color: "#ddd" }, ticks: { color: "#333" }, beginAtZero: true },
      },
    },
  });
  const dataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  return dataUrl;
}

// Assembles the partner-facing one-pager from the already-loaded, filtered
// /api/metrics payload and opens the browser's print dialog (Save as PDF) —
// the literal "this is what you'd send the connector company" artifact.
function exportPartnerReport() {
  const connectorId = $("connectorFilter").value;
  const m = lastMetrics;
  if (!connectorId || !m) return;
  const partnerName = (m.connectors[connectorId] && m.connectors[connectorId].name) || connectorId;

  const funnelRows = m.stages.map((s) =>
    `<tr><td>${STAGE_LABEL[s]}</td><td class="num">${fmtNum(m.funnel[s] || 0)}</td></tr>`
  ).join("");
  const surfaceRows = ["onboarding", "in_chat"].filter((s) => m.bySurface[s]).map((s) => {
    const o = m.bySurface[s];
    return `<tr><td>${s === "onboarding" ? "Onboarding" : "In-chat"}</td><td class="num">${fmtNum(o.recommended || 0)}</td><td class="num">${fmtNum(o.signed_up || 0)}</td><td class="num">${fmtPct(o.conversion || 0)}</td></tr>`;
  }).join("");

  $("partnerReport").innerHTML = `
    <div class="pr-header">
      <div class="pr-brand">Multify</div>
      <div class="pr-title">Partner attribution report — ${partnerName}</div>
      <div class="pr-meta">Generated ${new Date(m.generatedAt).toLocaleString()}</div>
    </div>
    <div class="pr-kpis">
      <div><span class="pr-kpi-label">Net-new leads</span><span class="pr-kpi-value">${fmtNum(m.netNewLeads)}</span></div>
      <div><span class="pr-kpi-label">Rec &rarr; Connected</span><span class="pr-kpi-value">${fmtPct(m.conversionOverall)}</span></div>
      <div><span class="pr-kpi-label">Activation rate</span><span class="pr-kpi-value">${fmtPct(m.activationRate)}</span></div>
      <div><span class="pr-kpi-label">Est. lead value (illustrative)</span><span class="pr-kpi-value">$${fmtNum(m.netNewLeads * LEAD_VALUE)}</span></div>
    </div>
    <h3>Conversion funnel</h3>
    <table><tbody>${funnelRows}</tbody></table>
    <h3>Net-new leads / day (last 14 days)</h3>
    <img class="pr-trend-img" src="${buildPrintTrendImage(m.series)}" alt="Net-new leads trend" />
    <h3>Onboarding vs in-chat</h3>
    <table><thead><tr><th>Surface</th><th class="num">Recommended</th><th class="num">Leads</th><th class="num">Conversion</th></tr></thead><tbody>${surfaceRows}</tbody></table>
    <p class="pr-footnote">
      Aggregate &amp; anonymized — no personal data is shared with partners in this view.
      Net-new-lead detection and the $/lead figure are illustrative for this prototype, not
      partner-verified production numbers. Not legal advice.
    </p>`;
  window.print();
}

function initConnectorFilter(connectors) {
  const sel = $("connectorFilter");
  Object.entries(connectors).forEach(([id, c]) => {
    const o = document.createElement("option");
    o.value = id; o.textContent = c.name; // <option> can't render <img>, name only
    sel.appendChild(o);
  });
  filtersInit = true;
}

function renderFunnel(funnel, stages) {
  const top = funnel[stages[0]] || 1;
  $("funnel").innerHTML = stages.map((s) => {
    const n = funnel[s] || 0;
    const pct = Math.round((n / top) * 100);
    return `<div class="bar">
      <div class="lab"><span>${STAGE_LABEL[s]}</span><span class="n">${fmtNum(n)} · ${pct}%</span></div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
}

function renderTrend(series) {
  const labels = series.map((p) => (p.day === 0 ? "today" : `-${p.day}d`));
  const data = series.map((p) => p.leads);
  const ctx = $("trend").getContext("2d");
  if (trendChart) { trendChart.data.labels = labels; trendChart.data.datasets[0].data = data; trendChart.update(); return; }
  const textColor = themeColor("--text");
  const mutedColor = themeColor("--muted");
  const borderColor = themeColor("--border");
  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{
      label: "Net-new leads", data,
      borderColor: textColor, backgroundColor: hexToRgba(textColor, .12),
      fill: true, tension: .35, pointRadius: 2,
    }]},
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: borderColor }, ticks: { color: mutedColor, maxTicksLimit: 8 } },
        y: { grid: { color: borderColor }, ticks: { color: mutedColor }, beginAtZero: true },
      },
    },
  });
}

function renderSurface(bySurface) {
  const order = ["onboarding", "in_chat"];
  const rows = order.filter((s) => bySurface[s]).map((s) => {
    const o = bySurface[s];
    const label = s === "onboarding" ? "Onboarding" : "In-chat";
    return `<tr>
      <td>${label}</td>
      <td class="num">${fmtNum(o.recommended || 0)}</td>
      <td class="num">${fmtNum(o.signed_up || 0)}</td>
      <td class="num"><span class="pill ${convClass(o.conversion || 0)}">${fmtPct(o.conversion || 0)}</span></td>
    </tr>`;
  }).join("");
  $("surfaceTable").querySelector("tbody").innerHTML = rows || `<tr><td colspan="4" class="count">No data for this filter.</td></tr>`;
}

function renderConnectors(table) {
  const rows = table.slice(0, 10).map((c) => `
    <tr>
      <td><img class="ico-img-sm" src="${c.ico}" alt="" /> ${c.name}</td>
      <td class="num">${fmtNum(c.recommended)}</td>
      <td class="num">${fmtNum(c.signed_up)}</td>
      <td class="num"><span class="pill ${convClass(c.conversion)}">${fmtPct(c.conversion)}</span></td>
    </tr>`).join("");
  $("connectorTable").querySelector("tbody").innerHTML = rows || `<tr><td colspan="4" class="count">No data.</td></tr>`;
}

$("connectorFilter").addEventListener("change", load);
$("surfaceFilter").addEventListener("change", load);
$("exportBtn").addEventListener("click", exportPartnerReport);
document.addEventListener("themechange", () => {
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  load(); // rebuild the chart immediately with the new theme's colors
});
load();
setInterval(load, 4000); // live refresh — picks up events from the recommender
