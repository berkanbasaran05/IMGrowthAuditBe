// Radar/Redis yedeğini (JSON) PostgreSQL uyumluluk tablolarına aktarır.
// Kullanım: node --env-file=.env scripts/import-backup.mjs <yedek.json> [--dry-run] [--overwrite]
// - Nesne değerli alanlar (leads, runs, adsclients, bookings…) hash_values'a JSON olarak yazılır.
// - Metin değerli alanlar (adstokens: belirteç → müşteri kimliği) olduğu gibi yazılır.
// - Diziler (sends) list_values'a eskiden yeniye eklenir; aynı kayıt (messageId/at) tekrar eklenmez.
// - Varsayılan: mevcut kayıtlar korunur (--overwrite ile güncellenir). Tamamı tek işlemde yapılır.
import { readFileSync } from "node:fs";
import pg from "pg";

const [file, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run"), overwrite = flags.includes("--overwrite");
if (!file) { console.error("Kullanım: node --env-file=.env scripts/import-backup.mjs <yedek.json> [--dry-run] [--overwrite]"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL tanımlı değil"); process.exit(1); }

const data = JSON.parse(readFileSync(file, "utf8"));
if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Yedek kökü bir nesne olmalı");
const BUCKET = /^[a-z0-9_-]{1,60}$/i;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const report = [];
try {
  await client.query("BEGIN");
  for (const [bucket, value] of Object.entries(data)) {
    if (!BUCKET.test(bucket)) throw new Error(`Geçersiz anahtar: ${bucket}`);
    if (Array.isArray(value)) {
      const existing = new Set((await client.query("SELECT value FROM list_values WHERE key=$1", [bucket])).rows.map((r) => {
        try { const v = JSON.parse(r.value); return v.messageId || `${v.at}|${v.id}`; } catch { return r.value; }
      }));
      let added = 0, skipped = 0;
      // Yedekte en yeni kayıt başta (LRANGE sırası); eskiden yeniye eklenince sıra korunur.
      for (const item of [...value].reverse()) {
        const key = item && typeof item === "object" ? item.messageId || `${item.at}|${item.id}` : String(item);
        if (existing.has(key)) { skipped++; continue; }
        await client.query("INSERT INTO list_values(key,value) VALUES($1,$2)", [bucket, typeof item === "string" ? item : JSON.stringify(item)]);
        existing.add(key); added++;
      }
      report.push({ bucket, type: "list", total: value.length, added, skipped });
      continue;
    }
    if (!value || typeof value !== "object") throw new Error(`${bucket}: beklenmeyen değer tipi`);
    let added = 0, updated = 0, skipped = 0;
    for (const [field, v] of Object.entries(value)) {
      const raw = typeof v === "string" ? v : JSON.stringify(v);
      const cur = await client.query("SELECT 1 FROM hash_values WHERE bucket=$1 AND field=$2", [bucket, field]);
      if (cur.rowCount && !overwrite) { skipped++; continue; }
      await client.query("INSERT INTO hash_values(bucket,field,value) VALUES($1,$2,$3) ON CONFLICT(bucket,field) DO UPDATE SET value=EXCLUDED.value", [bucket, field, raw]);
      if (cur.rowCount) updated++; else added++;
    }
    report.push({ bucket, type: "hash", total: Object.keys(value).length, added, updated, skipped });
  }
  if (dryRun) await client.query("ROLLBACK"); else await client.query("COMMIT");
  console.table(report);
  console.log(dryRun ? "Kuru çalışma: hiçbir değişiklik kaydedilmedi." : "Aktarım tamamlandı.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Aktarım geri alındı:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
