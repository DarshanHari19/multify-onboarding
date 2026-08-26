/* =========================================================================
   THE "BRAIN" — reusable taxonomy, shared by server (LLM prompt) and client.
   Loaded as a plain <script> in the browser (sets window.TAXONOMY) AND
   imported by the Node server (sets globalThis.TAXONOMY). No build step.

   - CONNECTORS: catalog grounded in real MCP servers (Multify's list + the
     broader official MCP registry: Linear, Sentry, Vercel, Neon, etc.)
   - ROLES: curated role -> connector bundle (the deterministic half).
   - FALLBACK_INTENTS: keyword map used ONLY when the LLM call is unavailable.
   ========================================================================= */
(function (root) {
  const CONNECTORS = {
    hubspot:    { name: "HubSpot",          ico: "🟠", cat: "CRM",         desc: "CRM: deals, contacts, pipeline management", isNew: false },
    salesforce: { name: "Salesforce",       ico: "☁️", cat: "CRM",         desc: "Enterprise CRM and sales cloud", isNew: false },
    apollo:     { name: "Apollo.io",        ico: "🚀", cat: "Prospecting", desc: "Lead sourcing, enrichment, and prospecting", isNew: false },
    gmail:      { name: "Gmail",            ico: "✉️", cat: "Email",       desc: "Read, draft, and send email", isNew: false },
    gcal:       { name: "Google Calendar",  ico: "📅", cat: "Calendar",    desc: "Events, scheduling, availability", isNew: false },
    gdrive:     { name: "Google Drive",     ico: "📁", cat: "Files",       desc: "Cloud file storage and documents", isNew: false },
    slack:      { name: "Slack",            ico: "💬", cat: "Comms",       desc: "Team messaging and notifications", isNew: false },
    notion:     { name: "Notion",           ico: "📝", cat: "Docs",        desc: "Docs, wikis, specs, and knowledge base", isNew: false },
    linear:     { name: "Linear",           ico: "📐", cat: "Issues",      desc: "Issue tracking and product roadmap", isNew: true },
    jira:       { name: "Jira",             ico: "🟦", cat: "Issues",      desc: "Issue tracking and agile project management", isNew: false },
    github:     { name: "GitHub",           ico: "🐙", cat: "Code",        desc: "Repos, pull requests, issues, code", isNew: false },
    sentry:     { name: "Sentry",           ico: "🛡️", cat: "Monitoring",  desc: "Error monitoring and crash reporting", isNew: true },
    vercel:     { name: "Vercel",           ico: "▲",  cat: "Deploy",      desc: "Deployments and hosting for web apps", isNew: true },
    neon:       { name: "Neon",             ico: "🟩", cat: "Database",    desc: "Serverless Postgres database", isNew: true },
    snowflake:  { name: "Snowflake",        ico: "❄️", cat: "Warehouse",   desc: "Cloud data warehouse and SQL analytics", isNew: false },
    airtable:   { name: "Airtable",         ico: "🔶", cat: "Data",        desc: "Spreadsheet-database for operational data", isNew: false },
    stripe:     { name: "Stripe",           ico: "💳", cat: "Payments",    desc: "Payments, revenue, invoices, billing", isNew: false },
    asana:      { name: "Asana",            ico: "🔴", cat: "Projects",    desc: "Task and project management", isNew: false },
    buffer:     { name: "Buffer",           ico: "📣", cat: "Social",      desc: "Social media scheduling and publishing", isNew: false },
    ga4:        { name: "Google Analytics", ico: "📊", cat: "Analytics",   desc: "Website and product analytics", isNew: false },
  };

  const ROLES = {
    sales: {
      emoji: "💼", title: "Sales", blurb: "Prospecting, CRM, and outreach",
      bundle: [
        { id: "hubspot", auto: true,  why: "Manage your pipeline and pull deal data from chat" },
        { id: "apollo",  auto: true,  why: "Enrich and find new leads without leaving Multify" },
        { id: "gmail",   auto: true,  why: "Draft and send outreach your agent personalizes" },
        { id: "gcal",    auto: true,  why: "Book meetings and check scheduling conflicts" },
        { id: "slack",   auto: false, why: "Loop your team in on won/lost deals" },
      ],
    },
    engineer: {
      emoji: "🛠️", title: "Engineer", blurb: "Code, issues, and monitoring",
      bundle: [
        { id: "github", auto: true,  why: "Read repos, open PRs, triage issues from chat" },
        { id: "linear", auto: true,  why: "Create and move tickets as work happens" },
        { id: "sentry", auto: true,  why: "Surface production errors and turn them into tasks" },
        { id: "vercel", auto: false, why: "Trigger and inspect deployments" },
        { id: "neon",   auto: false, why: "Query your database directly" },
      ],
    },
    pm: {
      emoji: "📋", title: "Product Manager", blurb: "Specs, roadmap, and coordination",
      bundle: [
        { id: "notion", auto: true,  why: "Draft specs and PRDs your agent keeps in sync" },
        { id: "linear", auto: true,  why: "Track roadmap items and status at a glance" },
        { id: "slack",  auto: true,  why: "Keep stakeholders updated automatically" },
        { id: "gcal",   auto: false, why: "Coordinate reviews and launch dates" },
        { id: "github", auto: false, why: "See what's shipping against the roadmap" },
      ],
    },
    marketer: {
      emoji: "📣", title: "Marketer", blurb: "Content, social, and analytics",
      bundle: [
        { id: "buffer",  auto: true,  why: "Schedule and publish social posts from chat" },
        { id: "ga4",     auto: true,  why: "Pull traffic and campaign performance" },
        { id: "notion",  auto: true,  why: "Manage your content calendar and briefs" },
        { id: "gmail",   auto: false, why: "Run and track email campaigns" },
        { id: "hubspot", auto: false, why: "Tie campaigns back to the pipeline" },
      ],
    },
    founder: {
      emoji: "🧭", title: "Founder / Ops", blurb: "A bit of everything",
      bundle: [
        { id: "gmail",  auto: true,  why: "Stay on top of your inbox with an agent" },
        { id: "gcal",   auto: true,  why: "Protect your calendar and schedule for you" },
        { id: "notion", auto: true,  why: "Your company wiki, reachable from chat" },
        { id: "stripe", auto: false, why: "Check revenue and payments on demand" },
        { id: "slack",  auto: false, why: "Broadcast updates to the team" },
      ],
    },
    data: {
      emoji: "📊", title: "Data / Analyst", blurb: "Warehouses, dashboards, and queries",
      bundle: [
        { id: "snowflake", auto: true,  why: "Query the warehouse in plain English" },
        { id: "airtable",  auto: true,  why: "Pull and update operational tables" },
        { id: "ga4",       auto: true,  why: "Blend product analytics into your analysis" },
        { id: "neon",      auto: false, why: "Hit application databases directly" },
        { id: "notion",    auto: false, why: "Publish findings your team can read" },
      ],
    },
  };

  // Used ONLY if the LLM call is unavailable (no key / error). Keeps the demo
  // robust so the free-text layer still returns something sensible offline.
  const FALLBACK_INTENTS = [
    { kw: ["crm", "deal", "pipeline", "lead"],               ids: ["hubspot", "salesforce"] },
    { kw: ["prospect", "enrich", "find leads", "outreach"],  ids: ["apollo"] },
    { kw: ["email", "cold email", "send email", "prospects"],ids: ["gmail"] },
    { kw: ["schedule", "meeting", "calendar", "book"],       ids: ["gcal"] },
    { kw: ["error", "bug", "crash", "exception", "monitor"], ids: ["sentry"] },
    { kw: ["ticket", "issue", "backlog", "sprint"],          ids: ["linear", "jira"] },
    { kw: ["deploy", "ship", "release", "hosting"],          ids: ["vercel"] },
    { kw: ["database", "query", "sql", "postgres"],          ids: ["neon", "snowflake"] },
    { kw: ["social", "post", "tweet", "instagram", "content"],ids: ["buffer"] },
    { kw: ["analytics", "traffic", "metrics", "dashboard"],  ids: ["ga4", "snowflake"] },
    { kw: ["payment", "revenue", "invoice", "billing"],      ids: ["stripe"] },
    { kw: ["doc", "spec", "wiki", "notes", "prd"],           ids: ["notion"] },
    { kw: ["code", "repo", "pull request", "commit"],        ids: ["github"] },
    { kw: ["team", "notify", "update team", "broadcast"],    ids: ["slack"] },
  ];

  root.TAXONOMY = { CONNECTORS, ROLES, FALLBACK_INTENTS };
})(typeof window !== "undefined" ? window : globalThis);
