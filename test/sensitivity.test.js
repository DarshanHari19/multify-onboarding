import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitive } from "../lib/sensitivity.js";

test("isSensitive tags a Stripe-like connector as finance", () => {
  const c = { name: "Stripe", cat: "Payments", desc: "Payments, revenue, invoices, billing" };
  assert.equal(isSensitive(c), "finance");
});

test("isSensitive tags a Gmail-like connector as email", () => {
  const c = { name: "Gmail", cat: "Email", desc: "Read, draft, and send email" };
  assert.equal(isSensitive(c), "email");
});

test("isSensitive returns null for an unrelated connector", () => {
  const c = { name: "Notion", cat: "Docs", desc: "Docs, wikis, specs, and knowledge base" };
  assert.equal(isSensitive(c), null);
});

test("isSensitive is case-insensitive and checks name/desc too, not just cat", () => {
  const c = { name: "Acme Banking API", cat: "Finance Tools", desc: "Manage BANK accounts and invoices" };
  assert.equal(isSensitive(c), "finance");
});

test("isSensitive matches an IMAP/inbox-style connector as email without the word 'email'", () => {
  const c = { name: "Inbox Sync", cat: "Productivity", desc: "Sync your IMAP inbox and mailbox" };
  assert.equal(isSensitive(c), "email");
});

test("isSensitive returns null for missing/empty fields instead of throwing", () => {
  assert.equal(isSensitive({}), null);
  assert.equal(isSensitive({ name: "", cat: "", desc: "" }), null);
});

test("isSensitive prefers finance when both finance and email keywords are present", () => {
  const c = { name: "BillMail", cat: "Billing", desc: "Send invoice emails and process payments" };
  assert.equal(isSensitive(c), "finance");
});
