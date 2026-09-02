import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSponsor } from "../lib/sponsor.js";

function sponsored() {
  return [
    { id: "salesforce", roles: ["sales"], keywords: ["crm", "pipeline"], why: "..." },
    { id: "stripe", roles: ["data"], keywords: ["payment", "billing"], why: "..." },
  ];
}

test("matches by role", () => {
  const s = pickSponsor(sponsored(), { role: "sales", needText: "" });
  assert.equal(s.id, "salesforce");
});

test("matches by keyword when no role is selected", () => {
  const s = pickSponsor(sponsored(), { role: null, needText: "I need to track billing" });
  assert.equal(s.id, "stripe");
});

test("role match wins over a keyword match for a different sponsor", () => {
  const s = pickSponsor(sponsored(), { role: "sales", needText: "billing" });
  assert.equal(s.id, "salesforce");
});

test("returns null when neither role nor keyword matches", () => {
  const s = pickSponsor(sponsored(), { role: "engineer", needText: "deploy a server" });
  assert.equal(s, null);
});

test("returns null for an empty sponsored list", () => {
  assert.equal(pickSponsor([], { role: "sales", needText: "crm" }), null);
});

test("is case-insensitive on keyword matching", () => {
  const s = pickSponsor(sponsored(), { role: null, needText: "Track our PIPELINE" });
  assert.equal(s.id, "salesforce");
});

test("returns null when role and needText are both absent", () => {
  assert.equal(pickSponsor(sponsored(), {}), null);
});
