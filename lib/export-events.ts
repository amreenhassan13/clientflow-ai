import { createHmac } from "node:crypto";

export type ExportableEvent = {
  id: string;
  lead_id: string | null;
  kind: string;
  source: string;
  created_at: Date | string;
};

/**
 * Builds the NDJSON body for a BigQuery load job. Only pseudonymous fields
 * leave PostgreSQL: lead_ref is an HMAC of the lead id, so BigQuery can count
 * unique leads without holding names, emails, phones or message text.
 */
export function buildEventsNdjson(rows: ExportableEvent[], salt: string): string {
  return rows
    .map((row) =>
      JSON.stringify({
        event_id: row.id,
        event_type: row.kind,
        source: row.source,
        occurred_at: new Date(row.created_at).toISOString(),
        lead_ref: row.lead_id
          ? createHmac("sha256", salt).update(row.lead_id).digest("hex").slice(0, 32)
          : null,
      }),
    )
    .join("\n")
    .concat("\n");
}

export const BIGQUERY_EVENT_SCHEMA = [
  { name: "event_id", type: "STRING", mode: "REQUIRED" },
  { name: "event_type", type: "STRING", mode: "REQUIRED" },
  { name: "source", type: "STRING", mode: "NULLABLE" },
  { name: "occurred_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "lead_ref", type: "STRING", mode: "NULLABLE" },
];
