import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { appUrl, businessTimeZone, isDemo } from "@/lib/env";
import { bigQueryConfigured } from "@/lib/integrations/bigquery";
import { hubspotConfigured } from "@/lib/integrations/hubspot";
import { smsEnabled, twilioConfigured } from "@/lib/integrations/twilio";
import { json } from "@/lib/security";

export type HealthPayload = {
  demo: boolean;
  database: { ok: boolean; latencyMs: number | null; error?: string };
  integrations: { key: string; name: string; description: string; state: "ready" | "needs_setup" | "off" | "demo"; detail: string }[];
  queue: { pending: number; processing: number; failed: number };
  recentFailures: { kind: string; error: string | null; updatedAt: string }[];
  settings: { appUrl: string | null; timeZone: string };
};

function integrations(demo: boolean): HealthPayload["integrations"] {
  type State = HealthPayload["integrations"][number]["state"];
  const state = (ready: boolean, off = false): State => (demo ? "demo" : off ? "off" : ready ? "ready" : "needs_setup");
  return [
    {
      key: "database",
      name: "PostgreSQL",
      description: "Leads, jobs and the event log",
      state: state(Boolean(process.env.DATABASE_URL)),
      detail: process.env.DATABASE_URL ? "DATABASE_URL is set" : "Set DATABASE_URL",
    },
    {
      key: "hubspot",
      name: "HubSpot",
      description: "Contact create or update by email",
      state: state(hubspotConfigured()),
      detail: hubspotConfigured()
        ? `API version ${process.env.HUBSPOT_API_VERSION || "2026-09"}`
        : "Set HUBSPOT_ACCESS_TOKEN (Service Key)",
    },
    {
      key: "twilio",
      name: "Twilio SMS",
      description: "Consent-based SMS, delivery callbacks, STOP handling",
      state: state(twilioConfigured(), !smsEnabled()),
      detail: !smsEnabled()
        ? "SMS_ENABLED is false"
        : twilioConfigured()
          ? "Sender and callbacks configured"
          : "Set Twilio credentials, sender and APP_URL",
    },
    {
      key: "bigquery",
      name: "BigQuery",
      description: "Daily batch load of pseudonymous events",
      state: state(bigQueryConfigured()),
      detail: bigQueryConfigured()
        ? `${process.env.BIGQUERY_DATASET || "clientflow"}.${process.env.BIGQUERY_TABLE || "events"}`
        : "Set GOOGLE_CLOUD_PROJECT and GOOGLE_SERVICE_ACCOUNT_JSON",
    },
    {
      key: "wordpress",
      name: "WordPress intake",
      description: "HMAC-signed leads from the PHP plugin",
      state: state(Boolean(process.env.WORDPRESS_WEBHOOK_SECRET)),
      detail: process.env.WORDPRESS_WEBHOOK_SECRET ? "Shared secret set" : "Set WORDPRESS_WEBHOOK_SECRET",
    },
    {
      key: "cron",
      name: "Scheduled worker",
      description: "Retries, delayed surveys, exports",
      state: state(Boolean(process.env.CRON_SECRET)),
      detail: process.env.CRON_SECRET ? "CRON_SECRET set" : "Set CRON_SECRET",
    },
  ];
}

export async function GET() {
  const demo = isDemo();
  const settings = { appUrl: appUrl(), timeZone: businessTimeZone() };

  if (demo) {
    const payload: HealthPayload = {
      demo,
      database: { ok: true, latencyMs: null },
      integrations: integrations(true),
      queue: { pending: 0, processing: 0, failed: 0 },
      recentFailures: [],
      settings,
    };
    return json(payload);
  }
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);

  const started = Date.now();
  try {
    const [queueRows, failures] = await Promise.all([
      query<{ status: string; total: number }>("SELECT status, count(*)::int AS total FROM jobs GROUP BY status"),
      query<{ kind: string; last_error: string | null; updated_at: string }>(
        "SELECT kind, last_error, updated_at FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 5",
      ),
    ]);
    const q = new Map(queueRows.map((r) => [r.status, r.total]));
    const payload: HealthPayload = {
      demo,
      database: { ok: true, latencyMs: Date.now() - started },
      integrations: integrations(false),
      queue: { pending: q.get("pending") ?? 0, processing: q.get("processing") ?? 0, failed: q.get("failed") ?? 0 },
      recentFailures: failures.map((f) => ({
        kind: f.kind,
        error: f.last_error,
        updatedAt: new Date(f.updated_at).toISOString(),
      })),
      settings,
    };
    return json(payload);
  } catch (err) {
    console.error(err);
    const payload: HealthPayload = {
      demo,
      database: { ok: false, latencyMs: null, error: "Could not reach the database" },
      integrations: integrations(false),
      queue: { pending: 0, processing: 0, failed: 0 },
      recentFailures: [],
      settings,
    };
    return json(payload, 503);
  }
}
