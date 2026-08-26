# Multify — Smart Connector Onboarding (prototype)

A working prototype of two ideas for Multify, connected into one demo:

1. **Role/intent connector recommender** — a hybrid engine that pairs a
   deterministic **role → connector bundle** with a **live LLM** that maps a
   user's plain-English need to the right connectors. Catches users at
   onboarding (lowest-friction, highest-intent) and auto-enables a starter kit.
2. **Partner attribution dashboard** — the "measurement layer": a
   partner-facing console that turns connector recommendations into a
   measurable lead-gen funnel (recommended → clicked → signed up → connected →
   activated). It seeds with realistic baseline data **and updates live** as you
   use the recommender.

The strategic bet: recommendation logic is commoditized (MCP discovery tools
already exist), so the value is the **onboarding placement + activation framing
+ the measurement layer that proves lead-gen value to connector partners.**

---

## Run it

```bash
npm install
cp .env.example .env      # optional — see below
npm start
```

Then open:
- Recommender: http://localhost:3000/
- Dashboard:   http://localhost:3000/dashboard.html

### The LLM key (optional but recommended)
Put an OpenRouter key in `.env` to enable the **real** free-text engine:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-chat
```

Without a key, the free-text layer gracefully falls back to keyword matching,
so the demo still runs end to end. The role bundles are deterministic either way.

---

## Demo script (for a walkthrough)
1. Open the recommender. Pick **Sales** → watch the curated bundle appear, auto-enabled with reasons.
2. Type a need — *"pull stale deals from my CRM and email the prospects"* → **Interpret & add**. The live model adds HubSpot + Gmail.
3. Hit **Connect** → those funnel events fire.
4. Open the **dashboard** → watch net-new leads tick up and the funnel react. Point out **Onboarding vs in-chat** conversion — the core thesis.

---

## Architecture
- `server.js` — Express. `/api/recommend` (LLM + fallback), `/api/events` (funnel capture), `/api/metrics` (dashboard data). Seeds baseline events on boot.
- `public/taxonomy.js` — the reusable "brain": connector catalog (real MCP servers), role bundles, fallback intents. Shared by server and client.
- `public/index.html` + `app.js` — the recommender.
- `public/dashboard.html` + `dashboard.js` — the attribution console (Chart.js via CDN).

## Not production
In-memory store (resets on restart), illustrative lead values, and no auth.
See the dashboard's **Methodology & caveats** for the real-world blockers
(net-new detection, attribution/incrementality, and the privacy/CCPA "sale"
question around sharing individual lead data). Not legal advice.
