import { test } from "node:test";
import assert from "node:assert/strict";
import { isGenericTitle, isThinDescription, dedupeByRepo } from "../scripts/ingest.js";

test("isGenericTitle flags a bare category word with no differentiation", () => {
  assert.equal(isGenericTitle("CRM"), true);
  assert.equal(isGenericTitle("email"), true);
  assert.equal(isGenericTitle("  Server  "), true);
});

test("isGenericTitle does not flag a real product name that happens to contain a generic word", () => {
  assert.equal(isGenericTitle("Attio"), false);
  assert.equal(isGenericTitle("Email Wizard"), false);
  assert.equal(isGenericTitle("HubSpot CRM"), false);
});

test("isThinDescription flags descriptions that are too short or too few words", () => {
  assert.equal(isThinDescription("Short."), true);
  assert.equal(isThinDescription(""), true);
  assert.equal(isThinDescription(undefined), true);
  assert.equal(isThinDescription("Word word word word."), true); // long enough chars, too few real words
});

test("isThinDescription accepts a real, specific description", () => {
  assert.equal(isThinDescription("CRM to manage your sales pipeline. Learn more at close.com."), false);
});

test("dedupeByRepo keeps only one entry per repoUrl, preferring a real (non-raw) title", () => {
  const entries = [
    { id: "a", name: "ai.smithery/kesslerio-attio-mcp-server-beta", title: "ai.smithery/kesslerio-attio-mcp-server-beta", description: "d1", repoUrl: "https://github.com/kesslerio/attio-mcp-server" },
    { id: "b", name: "io.github.kesslerio/attio-mcp-server", title: "Attio MCP Server", description: "d2", repoUrl: "https://github.com/kesslerio/attio-mcp-server" },
  ];
  const result = dedupeByRepo(entries);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "b");
});

test("dedupeByRepo prefers a non-beta entry when both have real titles", () => {
  const entries = [
    { id: "a", name: "x/thing-beta", title: "Thing Beta", description: "short one", repoUrl: "https://example.com/repo" },
    { id: "b", name: "x/thing", title: "Thing", description: "the real one", repoUrl: "https://example.com/repo" },
  ];
  const result = dedupeByRepo(entries);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "b");
});

test("dedupeByRepo leaves entries with no repoUrl untouched", () => {
  const entries = [
    { id: "a", name: "x/a", title: "A", description: "d", repoUrl: null },
    { id: "b", name: "x/b", title: "B", description: "d", repoUrl: null },
  ];
  const result = dedupeByRepo(entries);
  assert.equal(result.length, 2);
});
