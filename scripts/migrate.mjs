import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = path.resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tanımlı değil");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  await client.query("SELECT pg_advisory_lock(706132411)");
  const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name));
  for (const name of readdirSync(path.resolve("migrations")).filter((file) => file.endsWith(".sql")).sort()) {
    if (done.has(name)) { console.log(`Atlandı: ${name}`); continue; }
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(path.resolve("migrations", name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      await client.query("COMMIT");
      console.log(`Uygulandı: ${name}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  await client.query("SELECT pg_advisory_unlock(706132411)");
} finally { await client.end(); }
