import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirstWinTasks } from "../lib/firstwin.js";

const FIRST_WINS = {
  hubspot: ["Pull your 10 stalest deals and draft follow-ups"],
  gmail: ["Draft and send a re-engagement email to a cold lead"],
  stripe: ["Summarize this week's failed payments"],
  __combos: [
    { ids: ["hubspot", "gmail"], task: "Pull your 10 stalest HubSpot deals and draft follow-up emails in Gmail" },
  ],
};

test("buildFirstWinTasks prefers a matching combo over individual templates", () => {
  const enabled = [{ id: "hubspot" }, { id: "gmail" }];
  const { tasks, needLLM } = buildFirstWinTasks(enabled, FIRST_WINS);
  assert.ok(tasks.includes("Pull your 10 stalest HubSpot deals and draft follow-up emails in Gmail"));
  assert.equal(needLLM, false);
});

test("buildFirstWinTasks falls back to per-connector templates when no combo matches", () => {
  const enabled = [{ id: "stripe" }];
  const { tasks, needLLM } = buildFirstWinTasks(enabled, FIRST_WINS);
  assert.deepEqual(tasks, ["Summarize this week's failed payments"]);
  assert.equal(needLLM, false);
});

test("buildFirstWinTasks caps at 3 tasks", () => {
  const many = {
    a: ["task a"], b: ["task b"], c: ["task c"], d: ["task d"],
  };
  const enabled = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const { tasks } = buildFirstWinTasks(enabled, many);
  assert.equal(tasks.length, 3);
});

test("buildFirstWinTasks dedupes identical task lines", () => {
  const dupWins = { a: ["same task"], b: ["same task"] };
  const enabled = [{ id: "a" }, { id: "b" }];
  const { tasks } = buildFirstWinTasks(enabled, dupWins);
  assert.deepEqual(tasks, ["same task"]);
});

test("buildFirstWinTasks drops a near-duplicate combo/template pair (semantic overlap, not exact match)", () => {
  const wins = {
    hubspot: ["Pull your 10 stalest deals and draft follow-ups"],
    gmail: ["Draft and send a re-engagement email to a cold lead"],
    __combos: [
      { ids: ["hubspot", "gmail"], task: "Pull your 10 stalest HubSpot deals and draft follow-up emails in Gmail" },
    ],
  };
  const enabled = [{ id: "hubspot" }, { id: "gmail" }];
  const { tasks } = buildFirstWinTasks(enabled, wins);
  // The combo line wins (checked first); hubspot's near-identical individual
  // template must NOT also appear even though the strings aren't identical.
  assert.deepEqual(tasks, [
    "Pull your 10 stalest HubSpot deals and draft follow-up emails in Gmail",
    "Draft and send a re-engagement email to a cold lead",
  ]);
});

test("buildFirstWinTasks flags needLLM when zero curated lines result (all RAG/registry connectors, no template)", () => {
  const enabled = [{ id: "some-registry-connector-xyz" }, { id: "another-unknown-one" }];
  const { tasks, needLLM } = buildFirstWinTasks(enabled, FIRST_WINS);
  assert.equal(tasks.length, 0);
  assert.equal(needLLM, true);
});

test("buildFirstWinTasks does not need the LLM whenever at least one curated line exists", () => {
  const enabled = [{ id: "gmail" }, { id: "stripe" }];
  const { tasks, needLLM } = buildFirstWinTasks(enabled, FIRST_WINS);
  assert.equal(tasks.length, 2);
  assert.equal(needLLM, false);
});
