import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { query, recordEvent } from "./db";
import { analyticsSalt, appUrl } from "./env";
import { PermanentError, RetryableError } from "./errors";
import { buildEventsNdjson, type ExportableEvent } from "./export-events";
import { bigQueryConfigured, loadNdjsonFile } from "./integrations/bigquery";
import { hubspotConfigured, upsertHubSpotContact } from "./integrations/hubspot";
import { sendSms, smsEnabled, twilioConfigured } from "./integrations/twilio";
import { isE164 } from "./phone";
import { sha256 } from "./security";

export const MAX_ATTEMPTS = 5;

type Job = { id: string; kind: string; lead_id: string | null; attempts: number };

type Lead = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  service: string;
  source: string;
  status: string;
  sms_consent: boolean;
};

async function getLead(id: string | null): Promise<Lead | null> {
  if (!id) return null;
  const [lead] = await query<Lead>(
    "SELECT id, full_name, email, phone, service, source, status, sms_consent FROM leads WHERE id = $1",
    [id],
  );
  return lead ?? null;
}

async function setSmsState(leadId: string, state: string) {
  await query("UPDATE leads SET integration_sms = $2, updated_at = now() WHERE id = $1", [leadId, state]);
}

async function isSuppressed(phone: string): Promise<boolean> {
  const rows = await query("SELECT 1 FROM sms_suppressions WHERE phone_hash = $1", [sha256(phone)]);
  return rows.length > 0;
}

/** Returns why an SMS cannot be sent to this lead, or null if it can. */
async function smsBlocker(lead: Lead): Promise<string | null> {
  if (!lead.sms_consent) return "no_consent";
  if (!smsEnabled() || !twilioConfigured()) return "disabled";
  if (!isE164(lead.phone)) return "invalid_phone";
  if (await isSuppressed(lead.phone)) return "opted_out";
  return null;
}

async function alreadySent(leadId: string, purpose: "welcome" | "survey"): Promise<boolean> {
  const rows = await query("SELECT 1 FROM sms_messages WHERE lead_id = $1 AND purpose = $2", [leadId, purpose]);
  return rows.length > 0;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

const businessName = () => process.env.BUSINESS_NAME || "ClientFlow";

async function runHubSpotSync(lead: Lead) {
  if (!hubspotConfigured()) {
    await query("UPDATE leads SET integration_hubspot = 'not_configured' WHERE id = $1", [lead.id]);
    return;
  }
  await upsertHubSpotContact(lead);
  await query("UPDATE leads SET integration_hubspot = 'synced', updated_at = now() WHERE id = $1", [lead.id]);
  await recordEvent(lead.id, "hubspot_synced", "hubspot");
}

async function runWelcomeSms(lead: Lead) {
  if (await alreadySent(lead.id, "welcome")) return;
  const blocker = await smsBlocker(lead);
  if (blocker) {
    await setSmsState(lead.id, blocker);
    await recordEvent(lead.id, "sms_skipped", "twilio", { reason: blocker });
    return;
  }
  const result = await sendSms(
    lead.phone!,
    `${businessName()}: Thanks ${firstName(lead.full_name)}! We received your ${lead.service.toLowerCase()} request and will be in touch soon. Reply STOP to opt out.`,
  );
  await query(
    "INSERT INTO sms_messages (sid, lead_id, purpose, status) VALUES ($1, $2, 'welcome', $3) ON CONFLICT (sid) DO NOTHING",
    [result.sid, lead.id, result.status],
  );
  await setSmsState(lead.id, result.status);
  await recordEvent(lead.id, "sms_queued", "twilio");
}

/**
 * The survey token is generated at send time and only its hash is stored, so
 * no usable survey link ever sits in the database.
 */
async function runSurveySms(lead: Lead) {
  if (lead.status !== "won") return; // moved out of won before the survey was due
  if (await alreadySent(lead.id, "survey")) return;
  const [existing] = await query<{ submitted_at: string | null }>(
    "SELECT submitted_at FROM surveys WHERE lead_id = $1",
    [lead.id],
  );
  if (existing?.submitted_at) return;
  const blocker = await smsBlocker(lead);
  if (blocker) {
    await recordEvent(lead.id, "survey_skipped", "twilio", { reason: blocker });
    return;
  }

  const token = randomBytes(32).toString("hex");
  await query(
    `INSERT INTO surveys (lead_id, token_hash) VALUES ($1, $2)
     ON CONFLICT (lead_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()
     WHERE surveys.submitted_at IS NULL`,
    [lead.id, sha256(token)],
  );
  const result = await sendSms(
    lead.phone!,
    `${businessName()}: Thanks for choosing us, ${firstName(lead.full_name)}! How did we do? ${appUrl()}/survey/${token} Reply STOP to opt out.`,
  );
  await query(
    "INSERT INTO sms_messages (sid, lead_id, purpose, status) VALUES ($1, $2, 'survey', $3) ON CONFLICT (sid) DO NOTHING",
    [result.sid, lead.id, result.status],
  );
  await recordEvent(lead.id, "survey_sent", "twilio");
}

async function runJob(job: Job) {
  const lead = await getLead(job.lead_id);
  if (!lead) return; // lead deleted; nothing to do
  switch (job.kind) {
    case "hubspot_sync":
      return runHubSpotSync(lead);
    case "sms_welcome":
      return runWelcomeSms(lead);
    case "survey_sms":
      return runSurveySms(lead);
    default:
      throw new PermanentError(`Unknown job kind: ${job.kind}`);
  }
}

/** Atomically claims the next due job. Safe with concurrent workers. */
async function claimNextJob(leadId?: string): Promise<Job | null> {
  const [job] = await query<Job>(
    `UPDATE jobs SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'pending' AND next_attempt_at <= now()
         AND ($1::uuid IS NULL OR lead_id = $1::uuid)
       ORDER BY next_attempt_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1)
     RETURNING id, kind, lead_id, attempts`,
    [leadId ?? null],
  );
  return job ?? null;
}

async function recordFailure(job: Job, err: unknown): Promise<"retried" | "failed"> {
  const message = String(err instanceof Error ? err.message : err).slice(0, 500);
  const permanent = err instanceof PermanentError;
  const retry = !permanent && job.attempts < MAX_ATTEMPTS;
  const backoff =
    err instanceof RetryableError && err.retryAfterSeconds
      ? err.retryAfterSeconds
      : Math.min(3600, 60 * 2 ** (job.attempts - 1));

  await query(
    `UPDATE jobs SET status = $2, locked_at = NULL, last_error = $3, updated_at = now(),
       next_attempt_at = now() + make_interval(secs => $4)
     WHERE id = $1`,
    [job.id, retry ? "pending" : "failed", message, backoff],
  );
  if (!retry && job.lead_id) {
    if (job.kind === "hubspot_sync") {
      await query("UPDATE leads SET integration_hubspot = 'failed' WHERE id = $1", [job.lead_id]);
    } else if (job.kind === "sms_welcome") {
      await setSmsState(job.lead_id, "failed");
    }
  }
  console.error(`Job ${job.kind} ${job.id} ${retry ? "will retry" : "failed"}: ${message}`);
  return retry ? "retried" : "failed";
}

export type ProcessResult = { completed: number; retried: number; failed: number };

/**
 * Drains due jobs until the queue is empty, maxJobs is reached or the time
 * budget runs out. Pass leadId to process just one lead's jobs right after
 * intake.
 */
export async function processJobs(
  options: { maxJobs?: number; timeBudgetMs?: number; leadId?: string } = {},
): Promise<ProcessResult> {
  const { maxJobs = 500, timeBudgetMs = 40_000, leadId } = options;
  const deadline = Date.now() + timeBudgetMs;
  const result: ProcessResult = { completed: 0, retried: 0, failed: 0 };

  for (let i = 0; i < maxJobs && Date.now() < deadline; i++) {
    const job = await claimNextJob(leadId);
    if (!job) break;
    try {
      await runJob(job);
      await query(
        "UPDATE jobs SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = now() WHERE id = $1",
        [job.id],
      );
      result.completed++;
    } catch (err) {
      result[await recordFailure(job, err)]++;
    }
  }
  return result;
}

/** Releases stuck locks, re-queues work that was blocked on config, trims old rows. */
export async function housekeeping(): Promise<void> {
  await query(
    `UPDATE jobs SET status = 'pending', locked_at = NULL, updated_at = now()
     WHERE status = 'processing' AND locked_at < now() - interval '10 minutes'`,
  );
  if (hubspotConfigured()) {
    await query(
      `UPDATE jobs SET status = 'pending', attempts = 0, next_attempt_at = now(), updated_at = now()
       FROM leads
       WHERE jobs.lead_id = leads.id AND jobs.kind = 'hubspot_sync'
         AND jobs.status = 'done' AND leads.integration_hubspot = 'not_configured'`,
    );
  }
  await query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
}

export async function retryFailedJobs(): Promise<number> {
  const rows = await query(
    `UPDATE jobs SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now()
     WHERE status = 'failed' RETURNING id`,
  );
  return rows.length;
}

export type ExportResult =
  | { status: "not-configured" }
  | { status: "up-to-date" | "loaded" | "partial"; count: number; jobIds: string[] };

/**
 * Loads unexported events into BigQuery in batches of up to 1,000. Events are
 * marked exported only after BigQuery confirms the load. If marking fails
 * after a successful load, the next run re-sends that batch; the clean_events
 * view in analytics/queries.sql removes those duplicates.
 */
export async function exportToBigQuery(
  options: { batchSize?: number; maxBatches?: number; timeBudgetMs?: number } = {},
): Promise<ExportResult> {
  if (!bigQueryConfigured()) return { status: "not-configured" };
  const { batchSize = 1000, maxBatches = 10, timeBudgetMs = 15_000 } = options;
  const deadline = Date.now() + timeBudgetMs;
  const jobIds: string[] = [];
  let count = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    if (Date.now() >= deadline) return { status: "partial", count, jobIds };
    const rows = await query<ExportableEvent>(
      `SELECT id, lead_id, kind, source, created_at FROM events
       WHERE exported_at IS NULL ORDER BY created_at LIMIT $1`,
      [batchSize],
    );
    if (!rows.length) break;

    const file = path.join(os.tmpdir(), `clientflow-${randomBytes(8).toString("hex")}.ndjson`);
    await fs.writeFile(file, buildEventsNdjson(rows, analyticsSalt()), { mode: 0o600 });
    try {
      const jobId = await loadNdjsonFile(file);
      if (jobId) jobIds.push(jobId);
    } finally {
      await fs.unlink(file).catch(() => undefined);
    }
    await query("UPDATE events SET exported_at = now() WHERE id = ANY($1::uuid[])", [rows.map((r) => r.id)]);
    count += rows.length;
    if (rows.length < batchSize) break;
  }
  return { status: count ? "loaded" : "up-to-date", count, jobIds };
}
