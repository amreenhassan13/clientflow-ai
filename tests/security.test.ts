import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "../lib/csv";
import { signSession, verifySession } from "../lib/session-token";
import { signPayload, verifySignature } from "../lib/signing";

const secret = "test-secret-that-is-definitely-long-enough";
const body = JSON.stringify({ full_name: "WP Person", email: "wp@example.com" });

test("signature matches PHP hash_hmac output", () => {
  // php -r 'echo hash_hmac("sha256", "1700000000.{\"a\":1}", "k");'
  assert.equal(signPayload("k", "1700000000", '{"a":1}'), "1b6ad1bc9bf48c52ce01939866d5877c6cc4e87ddad27e16673cb8c4964394a3");
});

test("valid signatures pass and tampering fails", () => {
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const sig = signPayload(secret, ts, body);
  assert.equal(verifySignature({ secret, timestamp: ts, signature: sig, body, nowMs: now }), true);
  assert.equal(verifySignature({ secret, timestamp: ts, signature: sig.toUpperCase(), body, nowMs: now }), true);
  assert.equal(verifySignature({ secret, timestamp: ts, signature: sig, body: body + " ", nowMs: now }), false);
  assert.equal(verifySignature({ secret: "other-secret", timestamp: ts, signature: sig, body, nowMs: now }), false);
  assert.equal(verifySignature({ secret: undefined, timestamp: ts, signature: sig, body, nowMs: now }), false);
  assert.equal(verifySignature({ secret, timestamp: "abc", signature: sig, body, nowMs: now }), false);
});

test("signatures outside the 5 minute window are rejected", () => {
  const now = 1_800_000_000_000;
  const old = String(now / 1000 - 301);
  const future = String(now / 1000 + 301);
  assert.equal(verifySignature({ secret, timestamp: old, signature: signPayload(secret, old, body), body, nowMs: now }), false);
  assert.equal(verifySignature({ secret, timestamp: future, signature: signPayload(secret, future, body), body, nowMs: now }), false);
});

test("sessions verify only for the configured admin", async () => {
  const token = await signSession("admin@example.com", secret);
  assert.deepEqual(await verifySession(token, secret, "ADMIN@example.com"), { email: "admin@example.com" });
  assert.equal(await verifySession(token, secret, "someone@example.com"), null);
  assert.equal(await verifySession(token, "another-secret-that-is-definitely-long-enough", "admin@example.com"), null);
  assert.equal(await verifySession("garbage", secret, "admin@example.com"), null);
  await assert.rejects(signSession("admin@example.com", "short"));
});

test("CSV cells are escaped and formula-safe", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(420), "420");
  assert.equal(toCsv(["a", "b"], [[1, "x\ny"]]), 'a,b\r\n1,"x\ny"\r\n');
});
