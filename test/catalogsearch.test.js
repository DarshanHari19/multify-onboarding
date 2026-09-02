import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCatalog } from "../lib/catalogsearch.js";

const entries = [
  { id: "postgres-mcp", name: "postgres-mcp", title: "Postgres", description: "Query and manage Postgres databases" },
  { id: "neon-mcp", name: "neon-mcp", title: "Neon", description: "Serverless Postgres database platform" },
  { id: "slack-mcp", name: "slack-mcp", title: "Slack", description: "Team messaging and notifications" },
  { id: "weather-mcp", name: "weather-mcp", title: "Weather", description: "Look up current weather by postcode" },
];

test("empty query returns no results", () => {
  assert.deepEqual(searchCatalog(entries, ""), []);
  assert.deepEqual(searchCatalog(entries, "   "), []);
});

test("name matches rank above description-only matches", () => {
  const results = searchCatalog(entries, "postgres");
  const ids = results.map((r) => r.id);
  assert.ok(ids.indexOf("postgres-mcp") < ids.indexOf("neon-mcp"));
});

test("prefix name matches rank above mid-string name matches", () => {
  const withMidMatch = [
    { id: "the-slacker", name: "the-slacker", title: "The Slacker", description: "unrelated" },
    { id: "slack-mcp", name: "slack-mcp", title: "Slack", description: "Team messaging" },
  ];
  const results = searchCatalog(withMidMatch, "slack");
  assert.equal(results[0].id, "slack-mcp");
});

test("matching is case-insensitive", () => {
  const results = searchCatalog(entries, "SLACK");
  assert.equal(results[0].id, "slack-mcp");
});

test("no matches returns an empty array", () => {
  assert.deepEqual(searchCatalog(entries, "nonexistentxyz"), []);
});

test("respects the limit parameter", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `mcp-${i}`, name: `mcp-${i}`, title: `Widget ${i}`, description: "postgres widget",
  }));
  const results = searchCatalog(many, "postgres", 5);
  assert.equal(results.length, 5);
});

test("description is optional and doesn't throw", () => {
  const noDesc = [{ id: "bare", name: "bare-mcp", title: "Bare" }];
  assert.doesNotThrow(() => searchCatalog(noDesc, "bare"));
});
