import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { computeAnalytics, parsePeriod, type AnalyticsLead } from "../lib/analytics";
import { demoAnalytics, generateDemoLeads } from "../lib/demo";
import { buildEventsNdjson } from "../lib/export-events";

const NOW = new Date("2026-11-21T12:00:00Z");

test("period parsing falls back to 14 days", () => {
  assert.equal(parsePeriod("30"), 30);
  assert.equal(parsePeriod("13"), 14);
  assert.equal(parsePeriod(null), 14);
});

test("demo data is deterministic and its analytics agree with the leads table", () => {
  const leads = generateDemoLeads(NOW);
  assert.deepEqual(generateDemoLeads(NOW), leads);
  for (const days of [7, 14, 30, 90] as const) {
    const a = demoAnalytics(days, NOW);
    assert.equal(a.trend.length, days);
    assert.equal(a.trend.reduce((t, d) => t + d.leads, 0), a.kpis.leads);
    assert.equal(a.sources.reduce((t, s) => t + s.value, 0), a.kpis.leads);
    assert.equal(a.services.reduce((t, s) => t + s.value, 0), a.kpis.leads);
    assert.equal(a.pipeline.reduce((t, s) => t + s.value, 0), leads.length);
  }
  assert.ok(leads.every((l) => l.email.endsWith("@example.com")));
  assert.ok(leads.every((l) => new Date(l.created_at) <= NOW));
});

test("metric definitions on a hand-made dataset", () => {
  const lead = (over: Partial<AnalyticsLead>): AnalyticsLead => ({
    status: "new", estimated_value: 0, source: "google", service: "Deep cleaning",
    created_at: "2026-11-20T10:00:00Z", won_at: null, integration_hubspot: "synced", integration_sms: "delivered",
    ...over,
  });
  const leads = [
    lead({ status: "won", estimated_value: 500, won_at: "2026-11-21T09:00:00Z" }),
    lead({ status: "lost", estimated_value: 200 }),
    lead({ status: "qualified", estimated_value: 300 }),
    lead({ created_at: "2026-11-10T10:00:00Z", status: "won", estimated_value: 900, won_at: "2026-11-12T10:00:00Z" }),
  ];
  const a = computeAnalytics(leads, {
    days: 7, now: NOW, demo: false, optedOut: 0,
    queue: { pending: 0, processing: 0, done: 0, failed: 0 },
    exports: { pending: 0, lastExportAt: null },
  });
  assert.equal(a.kpis.leads, 3);
  assert.equal(a.kpis.leadsPrev, 1);
  assert.equal(a.kpis.wonValue, 500);
  assert.equal(a.kpis.wonValuePrev, 900);
  assert.equal(a.kpis.qualifiedOpenValue, 300);
  assert.equal(Math.round(a.kpis.conversion * 100), 33);
  assert.equal(a.kpis.conversionPrev, 1);
  assert.equal(a.kpis.averageDeal, 700);
});

test("BigQuery export rows contain no personal data", () => {
  const ndjson = buildEventsNdjson(
    [{ id: "e1", lead_id: "11111111-1111-4111-8111-111111111111", kind: "lead_created", source: "website", created_at: NOW }],
    "salt",
  );
  const row = JSON.parse(ndjson.trim());
  assert.deepEqual(Object.keys(row).sort(), ["event_id", "event_type", "lead_ref", "occurred_at", "source"]);
  assert.notEqual(row.lead_ref, "11111111-1111-4111-8111-111111111111");
  assert.equal(row.lead_ref.length, 32);
  assert.ok(ndjson.endsWith("\n"));
});

test("worker uses batch loads, never streaming inserts", () => {
  const worker = fs.readFileSync("lib/worker.ts", "utf8") + fs.readFileSync("lib/integrations/bigquery.ts", "utf8");
  assert.match(worker, /\.load\(/);
  assert.doesNotMatch(worker, /insertAll|\.insert\(|createInsertStream/);
});

test("no secrets are committed and cron is scheduled", () => {
  for (const f of [".env", ".env.local"]) assert.equal(fs.existsSync(f), false, `${f} must not be committed`);
  const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.equal(vercel.crons[0].path, "/api/cron/process");
});
