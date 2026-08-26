/* Partner attribution dashboard. Polls /api/metrics and re-renders.
   Updates live because the recommender posts events to the same backend. */
const $ = (id) => document.getElementById(id);
const STAGE_LABEL = {
  recommended: "Recommended", clicked: "Clicked connect",
  signed_up: "Signed up (lead)", connected: "Connected", activated: "Activated",
};
const LEAD_VALUE = 12; // illustrative $ per net-new lead
let trendChart = null;
let filtersInit = false;

function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }
function fmtNum(n) { return n.toLocaleString(); }
function convClass(x) { return x >= 0.18 ? "good" : x >= 0.1 ? "mid" : "low"; }

async function load() {
  const connector = $("connectorFilter").value;
  const surface = $("surfaceFilter").value;
  const qs = new URLSearchParams();
  if (connector) qs.set("connector", connector);
  if (surface) qs.set("surface", surface);
  const res = await fetch("/api/metrics?" + qs.toString());
  const m = await res.json();

  if (!filtersInit) initConnectorFilter(m.connectors);

  // KPIs
  $("kpiLeads").textContent = fmtNum(m.netNewLeads);
  $("kpiConv").textContent = fmtPct(m.conversionOverall);
  $("kpiAct").textContent = fmtPct(m.activationRate);
  $("kpiValue").textContent = "$" + fmtNum(m.netNewLeads * LEAD_VALUE);

  renderFunnel(m.funnel, m.stages);
  renderTrend(m.series);
  renderSurface(m.bySurface);
  renderConnectors(m.connectorTable);
}

function initConnectorFilter(connectors) {
  const sel = $("connectorFilter");
  Object.entries(connectors).forEach(([id, c]) => {
    const o = document.createElement("option");
    o.value = id; o.textContent = `${c.ico} ${c.name}`;
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
  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{
      label: "Net-new leads", data,
      borderColor: "#5cc8ff", backgroundColor: "rgba(92,200,255,.15)",
      fill: true, tension: .35, pointRadius: 2,
    }]},
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "#20252a" }, ticks: { color: "#8a929b", maxTicksLimit: 8 } },
        y: { grid: { color: "#20252a" }, ticks: { color: "#8a929b" }, beginAtZero: true },
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
      <td>${c.ico} ${c.name}</td>
      <td class="num">${fmtNum(c.recommended)}</td>
      <td class="num">${fmtNum(c.signed_up)}</td>
      <td class="num"><span class="pill ${convClass(c.conversion)}">${fmtPct(c.conversion)}</span></td>
    </tr>`).join("");
  $("connectorTable").querySelector("tbody").innerHTML = rows || `<tr><td colspan="4" class="count">No data.</td></tr>`;
}

$("connectorFilter").addEventListener("change", load);
$("surfaceFilter").addEventListener("change", load);
load();
setInterval(load, 4000); // live refresh — picks up events from the recommender
