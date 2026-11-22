import "server-only";
import pg from "pg";

declare global {
  var __clientflowPool: pg.Pool | undefined;
}

function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new pg.Pool({
    connectionString,
    // Serverless functions run many small instances. Keep each pool small and
    // point DATABASE_URL at your provider's pooled endpoint.
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => console.error("PostgreSQL pool error", err));
  return pool;
}

/** Created lazily so demo mode never needs a database. */
export function getPool(): pg.Pool {
  globalThis.__clientflowPool ??= createPool();
  return globalThis.__clientflowPool;
}

export type Queryable = Pick<pg.PoolClient, "query">;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<T[]> {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function recordEvent(
  leadId: string | null,
  kind: string,
  source = "system",
  metadata: Record<string, unknown> = {},
  client: Queryable = getPool(),
): Promise<void> {
  await client.query(
    "INSERT INTO events (lead_id, kind, source, metadata) VALUES ($1, $2, $3, $4)",
    [leadId, kind, source, JSON.stringify(metadata)],
  );
}
