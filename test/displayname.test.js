import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDisplayName } from "../lib/displayname.js";

test("cleanDisplayName derives a clean name when the registry title is just the raw namespaced name", () => {
  assert.equal(cleanDisplayName({ name: "com.close/close-mcp", title: "com.close/close-mcp" }), "Close");
});

test("cleanDisplayName dedupes an accidentally-repeated segment when deriving from name", () => {
  assert.equal(
    cleanDisplayName({ name: "ai.smithery/kaszek-kaszek-attio-mcp", title: "ai.smithery/kaszek-kaszek-attio-mcp" }),
    "Kaszek Attio"
  );
});

test("cleanDisplayName trusts a registry-provided title that differs from the raw name", () => {
  assert.equal(cleanDisplayName({ name: "app.busymail/busymail", title: "Busymail" }), "Busymail");
  assert.equal(cleanDisplayName({ name: "io.github.mcp-dir/crm-mcp", title: "CRM" }), "CRM");
});

test("cleanDisplayName strips trailing generic suffix words from a real title", () => {
  assert.equal(cleanDisplayName({ name: "io.github.kesslerio/attio-mcp-server", title: "Attio MCP Server" }), "Attio");
  assert.equal(cleanDisplayName({ name: "ae.propick/propick", title: "Propick Integration MCP" }), "Propick");
});

test("cleanDisplayName strips an -mcp suffix and title-cases a single-word derived name", () => {
  assert.equal(cleanDisplayName({ name: "ac.tandem/docs-mcp", title: "ac.tandem/docs-mcp" }), "Docs");
});

test("cleanDisplayName handles a name with no namespace segment", () => {
  assert.equal(cleanDisplayName({ name: "standalone-mcp", title: "standalone-mcp" }), "Standalone");
});

test("cleanDisplayName falls back to deriving from name when title is missing", () => {
  assert.equal(cleanDisplayName({ name: "com.example/widget-mcp" }), "Widget");
});

test("cleanDisplayName never returns an empty string", () => {
  assert.equal(cleanDisplayName({ name: "mcp", title: "mcp" }), "Mcp");
});
