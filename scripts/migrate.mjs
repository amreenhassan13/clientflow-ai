// Applies db/migrations/*.sql in order, once each, inside transactions.
// Usage: DATABASE_URL=... npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  process.loadEnvFile?.(".env.local");
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to your shell or .env.local first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // Prevents two deploys from migrating at the same time.
  await client.query("SELECT pg_advisory_lock(727274)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`Applying ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      count++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  console.log(count ? `Applied ${count} migration(s).` : "Database is up to date.");
} finally {
  await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
  await client.end();
}
