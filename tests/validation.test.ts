import assert from "node:assert/strict";
import { test } from "node:test";
import { isE164, normalizePhone } from "../lib/phone";
import { leadSchema, leadUpdateSchema, surveySchema } from "../lib/validation";

const base = { full_name: "Olivia Martin", email: "Olivia@Example.COM ", service: "Deep cleaning" };

test("phone numbers are normalised to E.164 when possible", () => {
  assert.equal(normalizePhone("+61 400 000 000"), "+61400000000");
  assert.equal(normalizePhone("0061-400-000-000"), "+61400000000");
  assert.equal(normalizePhone("(+1) 415 555 0100"), "+14155550100");
  assert.equal(normalizePhone("0400 000 000"), "0400 000 000"); // local format kept as typed
  assert.equal(normalizePhone(""), "");
  assert.equal(isE164("+61400000000"), true);
  assert.equal(isE164("0400000000"), false);
});

test("lead schema lowercases email, normalises phone and fills defaults", () => {
  const lead = leadSchema.parse({ ...base, phone: "+61 400 111 222" });
  assert.equal(lead.email, "olivia@example.com");
  assert.equal(lead.phone, "+61400111222");
  assert.equal(lead.source, "website");
  assert.equal(lead.sms_consent, false);
  assert.equal(lead.notes, "");
});

test("lead schema rejects bad input", () => {
  assert.equal(leadSchema.safeParse({ ...base, email: "nope" }).success, false);
  assert.equal(leadSchema.safeParse({ ...base, service: "Pizza delivery" }).success, false);
  assert.equal(leadSchema.safeParse({ ...base, full_name: "X" }).success, false);
  assert.equal(leadSchema.safeParse({ ...base, idempotency_key: "not-a-uuid" }).success, false);
  assert.equal(leadSchema.safeParse({ ...base, notes: "x".repeat(1601) }).success, false);
});

test("idempotency keys must be UUIDs", () => {
  const key = crypto.randomUUID();
  assert.equal(leadSchema.parse({ ...base, idempotency_key: key }).idempotency_key, key);
});

test("lead updates need a status or a value", () => {
  assert.equal(leadUpdateSchema.safeParse({}).success, false);
  assert.equal(leadUpdateSchema.safeParse({ status: "won" }).success, true);
  assert.equal(leadUpdateSchema.safeParse({ estimated_value: 450 }).success, true);
  assert.equal(leadUpdateSchema.safeParse({ estimated_value: -1 }).success, false);
  assert.equal(leadUpdateSchema.safeParse({ status: "archived" }).success, false);
});

test("survey ratings are 1 to 5", () => {
  assert.equal(surveySchema.safeParse({ rating: 0 }).success, false);
  assert.equal(surveySchema.safeParse({ rating: 5 }).success, true);
  assert.equal(surveySchema.safeParse({ rating: 3.5 }).success, false);
});
