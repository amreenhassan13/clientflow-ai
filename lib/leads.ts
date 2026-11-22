import "server-only";
import type { AnalyticsPayload, NamedCount, Period } from "./analytics";
import { getPool, query, recordEvent, withTransaction } from "./db";
import { businessTimeZone } from "./env";
import { STATUSES, type LeadInput, type LeadStatus, type LeadUpdate } from "./validation";

export type LeadRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  service: string;
  notes: string;
  source: string;
  status: LeadStatus;
  estimated_value: string;
  sms_consent: boolean;
  created_at: string;
  won_at: string | null;
  integration_hubspot: string;
  integration_sms: string;
};

const LEAD_COLUMNS = `id, full_name, email, phone, service, notes, source, status,
  estimated_value, sms_consent, created_at, won_at, integration_hubspot, integration_sms`;

/**
 * Inserts a lead, its creation event and its follow-up jobs in one
 * transaction. A repeated idempotency key returns the original lead instead
 * of creating a duplicate.
 */
export async function addLead(input: LeadInput): Promise<{ id: string; duplicate: boolean }> {
  return withTransaction(async (client) => {
    const inserted = await query<{ id: string }>(
      `INSERT INTO leads (full_name, email, phone, service, notes, source, sms_consent, idempotency_key)
       VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.full_name,
        input.email,
        input.phone,
        input.service,
        input.notes,
        input.source,
        input.sms_consent,
        input.idempotency_key ?? null,
      ],
      client,
    );

    if (!inserted.length) {
      const [existing] = await query<{ id: string }>(
        "SELECT id FROM leads WHERE idempotency_key = $1",
        [input.idempotency_key],
        client,
      );
      return { id: existing.id, duplicate: true };
    }

    const id = inserted[0].id;
    await recordEvent(id, "lead_created", input.source, {}, client);
    await query(
      `INSERT INTO jobs (kind, lead_id) VALUES ('hubspot_sync', $1), ('sms_welcome', $1)
       ON CONFLICT (kind, lead_id) DO NOTHING`,
      [id],
      client,
    );
    return { id, duplicate: false };
  });
}

export async function updateLead(
  id: string,
  update: LeadUpdate,
): Promise<{ status: LeadStatus; estimated_value: string; won_at: string | null; surveyScheduled: boolean } | null> {
  return withTransaction(async (client) => {
    const [row] = await query<{
      status: LeadStatus;
      previous_status: LeadStatus;
      estimated_value: string;
      won_at: string | null;
    }>(
      `WITH previous AS (SELECT status FROM leads WHERE id = $1 FOR UPDATE)
       UPDATE leads SET
         status = COALESCE($2::text, leads.status),
         estimated_value = COALESCE($3::numeric, leads.estimated_value),
         won_at = CASE
           WHEN $2::text = 'won' THEN COALESCE(leads.won_at, now())
           WHEN $2::text IS NOT NULL THEN NULL
           ELSE leads.won_at END,
         updated_at = now()
       FROM previous
       WHERE leads.id = $1
       RETURNING leads.status, previous.status AS previous_status, leads.estimated_value, leads.won_at`,
      [id, update.status ?? null, update.estimated_value ?? null],
      client,
    );
    if (!row) return null;

    let surveyScheduled = false;
    if (row.status !== row.previous_status) {
      await recordEvent(id, `lead_${row.status}`, "dashboard", {}, client);
      if (row.status === "won") {
        const scheduled = await query(
          `INSERT INTO jobs (kind, lead_id, next_attempt_at)
           VALUES ('survey_sms', $1, now() + interval '24 hours')
           ON CONFLICT (kind, lead_id) DO NOTHING
           RETURNING id`,
          [id],
          client,
        );
        surveyScheduled = scheduled.length > 0;
      }
    }
    if (update.estimated_value !== undefined) {
      await recordEvent(id, "lead_value_updated", "dashboard", {}, client);
    }
    return { status: row.status, estimated_value: row.estimated_value, won_at: row.won_at, surveyScheduled };
  });
}

export async function listLeads(limit = 1000): Promise<LeadRow[]> {
  return query<LeadRow>(`SELECT ${LEAD_COLUMNS} FROM leads ORDER BY created_at DESC LIMIT $1`, [limit]);
}

export async function allLeadsForExport(): Promise<LeadRow[]> {
  return query<LeadRow>(`SELECT ${LEAD_COLUMNS} FROM leads ORDER BY created_at DESC`);
}

/** SQL implementation of the metric definitions in lib/analytics.ts. */
export async function liveAnalytics(days: Period): Promise<AnalyticsPayload> {
  const tz = businessTimeZone();
  const pool = getPool();
  const base = `WITH b AS (SELECT (now() AT TIME ZONE $1)::date AS today, $2::int AS d)`;
  const params = [tz, days];

  const [kpiRows, trend, sources, services, pipelineRows, healthRows, queueRows, exportRows] =
    await Promise.all([
      query<{
        leads: number; leads_prev: number; won_of_period: number; won_of_prev: number;
        lost_of_period: number; qualified_open: number; qualified_open_value: number;
        won_value: number; won_value_prev: number; won_count: number; average_deal: number;
      }>(
        `${base},
         l AS (
           SELECT status, estimated_value,
                  (created_at AT TIME ZONE $1)::date AS cd,
                  (won_at AT TIME ZONE $1)::date AS wd
           FROM leads)
         SELECT
           count(*) FILTER (WHERE cd > b.today - b.d)::int AS leads,
           count(*) FILTER (WHERE cd > b.today - 2 * b.d AND cd <= b.today - b.d)::int AS leads_prev,
           count(*) FILTER (WHERE cd > b.today - b.d AND status = 'won')::int AS won_of_period,
           count(*) FILTER (WHERE cd > b.today - 2 * b.d AND cd <= b.today - b.d AND status = 'won')::int AS won_of_prev,
           count(*) FILTER (WHERE cd > b.today - b.d AND status = 'lost')::int AS lost_of_period,
           count(*) FILTER (WHERE status = 'qualified')::int AS qualified_open,
           coalesce(sum(estimated_value) FILTER (WHERE status = 'qualified'), 0)::float8 AS qualified_open_value,
           coalesce(sum(estimated_value) FILTER (WHERE wd > b.today - b.d), 0)::float8 AS won_value,
           coalesce(sum(estimated_value) FILTER (WHERE wd > b.today - 2 * b.d AND wd <= b.today - b.d), 0)::float8 AS won_value_prev,
           count(*) FILTER (WHERE wd > b.today - b.d)::int AS won_count,
           coalesce(avg(estimated_value) FILTER (WHERE status = 'won' AND estimated_value > 0), 0)::float8 AS average_deal
         FROM l CROSS JOIN b`,
        params,
        pool,
      ),
      query<{ day: string; leads: number; qualified: number }>(
        `${base},
         days AS (
           SELECT generate_series(b.today - (b.d - 1), b.today, interval '1 day')::date AS day FROM b),
         l AS (
           SELECT (created_at AT TIME ZONE $1)::date AS cd, status
           FROM leads, b
           WHERE created_at >= now() - make_interval(days => b.d + 1))
         SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
                count(l.cd)::int AS leads,
                count(l.cd) FILTER (WHERE l.status IN ('qualified', 'won'))::int AS qualified
         FROM days LEFT JOIN l ON l.cd = days.day
         GROUP BY days.day
         ORDER BY days.day`,
        params,
        pool,
      ),
      query<NamedCount>(
        `${base}
         SELECT source AS name, count(*)::int AS value
         FROM leads, b
         WHERE (created_at AT TIME ZONE $1)::date > b.today - b.d
         GROUP BY source ORDER BY value DESC, name`,
        params,
        pool,
      ),
      query<NamedCount>(
        `${base}
         SELECT service AS name, count(*)::int AS value
         FROM leads, b
         WHERE (created_at AT TIME ZONE $1)::date > b.today - b.d
         GROUP BY service ORDER BY value DESC, name`,
        params,
        pool,
      ),
      query<NamedCount>(`SELECT status AS name, count(*)::int AS value FROM leads GROUP BY status`, [], pool),
      query<{
        hubspot_synced: number; hubspot_failed: number; hubspot_not_configured: number;
        sms_sent: number; sms_delivered: number; sms_failed: number; opted_out: number;
      }>(
        `SELECT
           (SELECT count(*) FROM leads WHERE integration_hubspot = 'synced')::int AS hubspot_synced,
           (SELECT count(*) FROM leads WHERE integration_hubspot = 'failed')::int AS hubspot_failed,
           (SELECT count(*) FROM leads WHERE integration_hubspot = 'not_configured')::int AS hubspot_not_configured,
           (SELECT count(*) FROM sms_messages WHERE purpose = 'welcome')::int AS sms_sent,
           (SELECT count(*) FROM sms_messages WHERE purpose = 'welcome' AND status = 'delivered')::int AS sms_delivered,
           (SELECT count(*) FROM sms_messages WHERE purpose = 'welcome' AND status IN ('failed', 'undelivered'))::int AS sms_failed,
           (SELECT count(*) FROM sms_suppressions)::int AS opted_out`,
        [],
        pool,
      ),
      query<{ status: string; total: number }>(
        `SELECT status, count(*)::int AS total FROM jobs GROUP BY status`,
        [],
        pool,
      ),
      query<{ pending: number; last_export_at: string | null }>(
        `SELECT count(*) FILTER (WHERE exported_at IS NULL)::int AS pending,
                max(exported_at) AS last_export_at
         FROM events`,
        [],
        pool,
      ),
    ]);

  const k = kpiRows[0];
  const h = healthRows[0];
  const pipelineMap = new Map(pipelineRows.map((r) => [r.name, r.value]));
  const queueMap = new Map(queueRows.map((r) => [r.status, r.total]));

  return {
    demo: false,
    periodDays: days,
    timeZone: tz,
    generatedAt: new Date().toISOString(),
    kpis: {
      leads: k.leads,
      leadsPrev: k.leads_prev,
      qualifiedOpen: k.qualified_open,
      qualifiedOpenValue: k.qualified_open_value,
      wonValue: k.won_value,
      wonValuePrev: k.won_value_prev,
      wonCount: k.won_count,
      conversion: k.leads ? k.won_of_period / k.leads : 0,
      conversionPrev: k.leads_prev ? k.won_of_prev / k.leads_prev : 0,
      lostRatio: k.leads ? k.lost_of_period / k.leads : 0,
      averageDeal: k.average_deal,
    },
    trend,
    sources,
    services,
    pipeline: STATUSES.map((name) => ({ name, value: pipelineMap.get(name) ?? 0 })),
    health: {
      hubspotSynced: h.hubspot_synced,
      hubspotFailed: h.hubspot_failed,
      hubspotNotConfigured: h.hubspot_not_configured,
      smsSent: h.sms_sent,
      smsDelivered: h.sms_delivered,
      smsFailed: h.sms_failed,
      optedOut: h.opted_out,
    },
    queue: {
      pending: queueMap.get("pending") ?? 0,
      processing: queueMap.get("processing") ?? 0,
      done: queueMap.get("done") ?? 0,
      failed: queueMap.get("failed") ?? 0,
    },
    exports: {
      pending: exportRows[0].pending,
      lastExportAt: exportRows[0].last_export_at ? new Date(exportRows[0].last_export_at).toISOString() : null,
    },
  };
}
