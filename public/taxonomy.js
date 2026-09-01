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
  // Line icons (Lucide, MIT) for role cards — inline SVG so `currentColor`
  // picks up the active theme's text color. Fetched verbatim, not hand-drawn.
  const ICONS = {
    briefcase: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><rect width="20" height="14" x="2" y="6" rx="2" /></svg>',
    wrench: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></svg>',
    clipboardList: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></svg>',
    megaphone: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" /><path d="M8 6v8" /></svg>',
    compass: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" /></svg>',
    barChart: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>',
    // Consent / feedback / role-inference affordances — no-emoji rule: every
    // new UI affordance uses an inline SVG from this shared set, never a
    // glyph. Reused by both index.html (recommender) and dashboard.html.
    alertTriangle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>',
    thumbsUp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" /></svg>',
    thumbsDown: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" /></svg>',
    wandSparkles: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></svg>',
  };

  // ico: path to a local SVG. Curated brands = real logo (Simple Icons, MIT,
  // official brand color baked in). No accurate mark available (Apollo.io) or
  // a full-registry connector -> icons/plug.svg (fixed neutral gray fallback).
  const CONNECTORS = {
    hubspot:    { name: "HubSpot",          ico: "icons/connectors/hubspot.svg",    cat: "CRM",         desc: "CRM: deals, contacts, pipeline management", isNew: false, websiteUrl: "https://www.hubspot.com" },
    salesforce: { name: "Salesforce",       ico: "icons/connectors/salesforce.svg", cat: "CRM",         desc: "Enterprise CRM and sales cloud", isNew: false, websiteUrl: "https://www.salesforce.com" },
    apollo:     { name: "Apollo.io",        ico: "icons/plug.svg",                  cat: "Prospecting", desc: "Lead sourcing, enrichment, and prospecting", isNew: false, websiteUrl: "https://www.apollo.io" },
    gmail:      { name: "Gmail",            ico: "icons/connectors/gmail.svg",      cat: "Email",       desc: "Read, draft, and send email", isNew: false, websiteUrl: "https://workspace.google.com/products/gmail/" },
    gcal:       { name: "Google Calendar",  ico: "icons/connectors/gcal.svg",       cat: "Calendar",    desc: "Events, scheduling, availability", isNew: false, websiteUrl: "https://workspace.google.com/products/calendar/" },
    gdrive:     { name: "Google Drive",     ico: "icons/connectors/gdrive.svg",     cat: "Files",       desc: "Cloud file storage and documents", isNew: false, websiteUrl: "https://workspace.google.com/products/drive/" },
    slack:      { name: "Slack",            ico: "icons/connectors/slack.svg",      cat: "Comms",       desc: "Team messaging and notifications", isNew: false, websiteUrl: "https://slack.com" },
    notion:     { name: "Notion",           ico: "icons/connectors/notion.svg",     cat: "Docs",        desc: "Docs, wikis, specs, and knowledge base", isNew: false, websiteUrl: "https://www.notion.so" },
    linear:     { name: "Linear",           ico: "icons/connectors/linear.svg",     cat: "Issues",      desc: "Issue tracking and product roadmap", isNew: true, websiteUrl: "https://linear.app" },
    jira:       { name: "Jira",             ico: "icons/connectors/jira.svg",       cat: "Issues",      desc: "Issue tracking and agile project management", isNew: false, websiteUrl: "https://www.atlassian.com/software/jira" },
    github:     { name: "GitHub",           ico: "icons/connectors/github.svg",     cat: "Code",        desc: "Repos, pull requests, issues, code", isNew: false, websiteUrl: "https://github.com" },
    sentry:     { name: "Sentry",           ico: "icons/connectors/sentry.svg",     cat: "Monitoring",  desc: "Error monitoring and crash reporting", isNew: true, websiteUrl: "https://sentry.io" },
    vercel:     { name: "Vercel",           ico: "icons/connectors/vercel.svg",     cat: "Deploy",      desc: "Deployments and hosting for web apps", isNew: true, websiteUrl: "https://vercel.com" },
    neon:       { name: "Neon",             ico: "icons/connectors/neon.svg",       cat: "Database",    desc: "Serverless Postgres database", isNew: true, websiteUrl: "https://neon.tech" },
    snowflake:  { name: "Snowflake",        ico: "icons/connectors/snowflake.svg",  cat: "Warehouse",   desc: "Cloud data warehouse and SQL analytics", isNew: false, websiteUrl: "https://www.snowflake.com" },
    airtable:   { name: "Airtable",         ico: "icons/connectors/airtable.svg",   cat: "Data",        desc: "Spreadsheet-database for operational data", isNew: false, websiteUrl: "https://www.airtable.com" },
    stripe:     { name: "Stripe",           ico: "icons/connectors/stripe.svg",     cat: "Payments",    desc: "Payments, revenue, invoices, billing", isNew: false, websiteUrl: "https://stripe.com" },
    asana:      { name: "Asana",            ico: "icons/connectors/asana.svg",      cat: "Projects",    desc: "Task and project management", isNew: false, websiteUrl: "https://asana.com" },
    buffer:     { name: "Buffer",           ico: "icons/connectors/buffer.svg",     cat: "Social",      desc: "Social media scheduling and publishing", isNew: false, websiteUrl: "https://buffer.com" },
    ga4:        { name: "Google Analytics", ico: "icons/connectors/ga4.svg",        cat: "Analytics",   desc: "Website and product analytics", isNew: false, websiteUrl: "https://marketingplatform.google.com/about/analytics/" },
  };

  const ROLES = {
    sales: {
      icon: ICONS.briefcase, title: "Sales", blurb: "Prospecting, CRM, and outreach",
      bundle: [
        { id: "hubspot", auto: true,  why: "Manage your pipeline and pull deal data from chat" },
        { id: "apollo",  auto: true,  why: "Enrich and find new leads without leaving Multify" },
        { id: "gmail",   auto: true,  why: "Draft and send outreach your agent personalizes" },
        { id: "gcal",    auto: true,  why: "Book meetings and check scheduling conflicts" },
        { id: "slack",   auto: false, why: "Loop your team in on won/lost deals" },
      ],
      // Ad-inventory demo (illustrative — see CLAUDE.md REAL-vs-ILLUSTRATIVE):
      // one paid, clearly-labeled slot per role, always shown regardless of
      // fit, distinct from the bundle above. Never auto-enabled.
      featured: { id: "salesforce", why: "Sponsored placement — Salesforce paid to appear here for every Sales user, regardless of fit." },
    },
    engineer: {
      icon: ICONS.wrench, title: "Engineer", blurb: "Code, issues, and monitoring",
      bundle: [
        { id: "github", auto: true,  why: "Read repos, open PRs, triage issues from chat" },
        { id: "linear", auto: true,  why: "Create and move tickets as work happens" },
        { id: "sentry", auto: true,  why: "Surface production errors and turn them into tasks" },
        { id: "vercel", auto: false, why: "Trigger and inspect deployments" },
        { id: "neon",   auto: false, why: "Query your database directly" },
      ],
      featured: { id: "jira", why: "Sponsored placement — Jira paid to appear here for every Engineer, regardless of fit." },
    },
    pm: {
      icon: ICONS.clipboardList, title: "Product Manager", blurb: "Specs, roadmap, and coordination",
      bundle: [
        { id: "notion", auto: true,  why: "Draft specs and PRDs your agent keeps in sync" },
        { id: "linear", auto: true,  why: "Track roadmap items and status at a glance" },
        { id: "slack",  auto: true,  why: "Keep stakeholders updated automatically" },
        { id: "gcal",   auto: false, why: "Coordinate reviews and launch dates" },
        { id: "github", auto: false, why: "See what's shipping against the roadmap" },
      ],
      featured: { id: "asana", why: "Sponsored placement — Asana paid to appear here for every Product Manager, regardless of fit." },
    },
    marketer: {
      icon: ICONS.megaphone, title: "Marketer", blurb: "Content, social, and analytics",
      bundle: [
        { id: "buffer",  auto: true,  why: "Schedule and publish social posts from chat" },
        { id: "ga4",     auto: true,  why: "Pull traffic and campaign performance" },
        { id: "notion",  auto: true,  why: "Manage your content calendar and briefs" },
        { id: "gmail",   auto: false, why: "Run and track email campaigns" },
        { id: "hubspot", auto: false, why: "Tie campaigns back to the pipeline" },
      ],
      featured: { id: "slack", why: "Sponsored placement — Slack paid to appear here for every Marketer, regardless of fit." },
    },
    founder: {
      icon: ICONS.compass, title: "Founder / Ops", blurb: "A bit of everything",
      bundle: [
        { id: "gmail",  auto: true,  why: "Stay on top of your inbox with an agent" },
        { id: "gcal",   auto: true,  why: "Protect your calendar and schedule for you" },
        { id: "notion", auto: true,  why: "Your company wiki, reachable from chat" },
        { id: "stripe", auto: false, why: "Check revenue and payments on demand" },
        { id: "slack",  auto: false, why: "Broadcast updates to the team" },
      ],
      featured: { id: "airtable", why: "Sponsored placement — Airtable paid to appear here for every Founder/Ops user, regardless of fit." },
    },
    data: {
      icon: ICONS.barChart, title: "Data / Analyst", blurb: "Warehouses, dashboards, and queries",
      bundle: [
        { id: "snowflake", auto: true,  why: "Query the warehouse in plain English" },
        { id: "airtable",  auto: true,  why: "Pull and update operational tables" },
        { id: "ga4",       auto: true,  why: "Blend product analytics into your analysis" },
        { id: "neon",      auto: false, why: "Hit application databases directly" },
        { id: "notion",    auto: false, why: "Publish findings your team can read" },
      ],
      featured: { id: "stripe", why: "Sponsored placement — Stripe paid to appear here for every Data/Analyst user, regardless of fit." },
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

  // "First win" preview (item 1, hybrid): concrete day-one tasks shown right
  // after Connect, grounded in the specific connectors just enabled. Curated
  // for the 20 known connectors + a handful of multi-connector combos; any
  // registry/RAG connector with no entry here falls through to the server's
  // LLM gap-fill (see lib/firstwin.js + POST /api/first-win).
  const FIRST_WINS = {
    hubspot:    ["Pull your 10 stalest deals and draft follow-ups"],
    salesforce: ["Summarize this week's pipeline changes across your top accounts"],
    apollo:     ["Find and enrich 20 new leads matching your ICP"],
    gmail:      ["Draft replies to your 5 oldest unanswered emails"],
    gcal:       ["Find your next open hour this week and block focus time"],
    gdrive:     ["Summarize the latest doc your team shared with you"],
    slack:      ["Post a daily standup summary to your team channel"],
    notion:     ["Draft a one-pager from your latest meeting notes"],
    linear:     ["Triage new bugs into this week's sprint"],
    jira:       ["Summarize open blockers across your active sprint"],
    github:     ["Summarize open pull requests waiting on your review"],
    sentry:     ["Turn this week's top production error into a ticket"],
    vercel:     ["Check the status of your last production deploy"],
    neon:       ["Query your database for last week's signups"],
    snowflake:  ["Run a query across last month's revenue by region"],
    airtable:   ["Pull this week's updated rows from your ops base"],
    stripe:     ["Summarize this week's failed payments"],
    asana:      ["List tasks due this week across your projects"],
    buffer:     ["Draft and schedule 3 social posts for next week"],
    ga4:        ["Summarize this week's top traffic sources"],
    __combos: [
      { ids: ["hubspot", "gmail"],   task: "Pull your 10 stalest HubSpot deals and draft follow-up emails in Gmail" },
      { ids: ["apollo", "gmail"],    task: "Find 10 new leads on Apollo and draft a personalized cold email in Gmail" },
      { ids: ["github", "linear"],   task: "Turn your 3 oldest open GitHub issues into Linear tickets" },
      { ids: ["sentry", "linear"],   task: "Convert this week's top Sentry error into a Linear ticket" },
      { ids: ["notion", "slack"],    task: "Draft a project update in Notion and post it to Slack" },
      { ids: ["stripe", "slack"],    task: "Post this week's Stripe revenue summary to Slack" },
      { ids: ["buffer", "ga4"],      task: "Schedule next week's social posts based on your top GA4 traffic sources" },
      { ids: ["snowflake", "notion"],task: "Pull last month's revenue query and publish the summary in Notion" },
    ],
  };

  root.TAXONOMY = { CONNECTORS, ROLES, FALLBACK_INTENTS, ICONS, FIRST_WINS };
})(typeof window !== "undefined" ? window : globalThis);
