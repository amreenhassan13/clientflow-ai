import "server-only";
import { BigQuery } from "@google-cloud/bigquery";
import { BIGQUERY_EVENT_SCHEMA } from "../export-events";

export function bigQueryConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CLOUD_PROJECT);
}

export function bigQueryTarget(): { dataset: string; table: string } {
  const dataset = process.env.BIGQUERY_DATASET || "clientflow";
  const table = process.env.BIGQUERY_TABLE || "events";
  if (!/^\w{1,1024}$/.test(dataset) || !/^\w{1,1024}$/.test(table)) {
    throw new Error("BIGQUERY_DATASET and BIGQUERY_TABLE may only contain letters, numbers and underscores");
  }
  return { dataset, table };
}

let client: BigQuery | undefined;
function getClient(): BigQuery {
  client ??= new BigQuery({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}"),
  });
  return client;
}

/**
 * Runs a batch load job from a local NDJSON file. table.load() waits for the
 * job to finish and rejects if BigQuery reports an error, so when this
 * resolves the rows are in the table. (Batch loads are allowed in the
 * BigQuery Sandbox; streaming inserts are not.)
 */
export async function loadNdjsonFile(filePath: string): Promise<string | undefined> {
  const { dataset, table } = bigQueryTarget();
  const [metadata] = await getClient()
    .dataset(dataset)
    .table(table)
    .load(filePath, {
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      writeDisposition: "WRITE_APPEND",
      createDisposition: "CREATE_IF_NEEDED",
      schema: { fields: BIGQUERY_EVENT_SCHEMA },
      timePartitioning: { type: "DAY", field: "occurred_at" },
    });
  return metadata.jobReference?.jobId ?? undefined;
}
