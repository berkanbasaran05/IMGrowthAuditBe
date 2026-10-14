import pg from "pg";

// Upstash tanımlıysa uzak Redis kullanılır. Yerel ve standart kurulumda aynı komutlar PostgreSQL
// uyumluluk tablolarına çevrilir; böylece uygulama ikinci bir veri sunucusuna ihtiyaç duymaz.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL || "";
let pool;

export async function redis(...cmd) {
  if (URL_ && TOKEN) {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }
  if (!DATABASE_URL) throw new Error("Veritabanı bağlı değil (DATABASE_URL eksik)");
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 });
  return postgresCommand(cmd);
}

async function postgresCommand(args) {
  const [raw, ...p] = args, command = String(raw).toUpperCase();
  if (command === "HGET") return (await pool.query("SELECT value FROM hash_values WHERE bucket=$1 AND field=$2", [String(p[0]), String(p[1])])).rows[0]?.value ?? null;
  if (command === "HGETALL") {
    const rows = (await pool.query("SELECT field,value FROM hash_values WHERE bucket=$1 ORDER BY field", [String(p[0])])).rows;
    return rows.flatMap((row) => [row.field, row.value]);
  }
  if (command === "HSET") {
    await pool.query("INSERT INTO hash_values(bucket,field,value) VALUES($1,$2,$3) ON CONFLICT(bucket,field) DO UPDATE SET value=EXCLUDED.value", [String(p[0]), String(p[1]), String(p[2])]);
    return 1;
  }
  if (command === "HDEL") return (await pool.query("DELETE FROM hash_values WHERE bucket=$1 AND field=$2", [String(p[0]), String(p[1])])).rowCount;
  if (command === "GET") {
    const result = await pool.query("SELECT value FROM key_values WHERE key=$1 AND (expires_at IS NULL OR expires_at > now())", [String(p[0])]);
    return result.rows[0]?.value ?? null;
  }
  if (command === "SET") {
    const exIndex = p.findIndex((value) => String(value).toUpperCase() === "EX");
    const seconds = exIndex >= 0 ? Math.max(1, Number(p[exIndex + 1]) || 1) : null;
    await pool.query(`INSERT INTO key_values(key,value,expires_at) VALUES($1,$2,${seconds ? "now() + ($3 * interval '1 second')" : "NULL"})
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at`, seconds ? [String(p[0]), String(p[1]), seconds] : [String(p[0]), String(p[1])]);
    return "OK";
  }
  if (command === "INCR" || command === "DECR") {
    const delta = command === "INCR" ? 1 : -1;
    // $2 tek tipte (bigint) bildirilir; aynı parametre hem metin hem sayı olarak kullanılamaz ("bigint + text" hatası).
    const result = await pool.query(`INSERT INTO key_values(key,value) VALUES($1,($2::bigint)::text)
      ON CONFLICT(key) DO UPDATE SET value=((CASE WHEN key_values.expires_at IS NOT NULL AND key_values.expires_at <= now() THEN 0 ELSE key_values.value::bigint END)+$2::bigint)::text,
      expires_at=CASE WHEN key_values.expires_at IS NOT NULL AND key_values.expires_at <= now() THEN NULL ELSE key_values.expires_at END RETURNING value`, [String(p[0]), delta]);
    return Number(result.rows[0].value);
  }
  if (command === "EXPIRE") {
    const result = await pool.query("UPDATE key_values SET expires_at=now() + ($2 * interval '1 second') WHERE key=$1", [String(p[0]), Math.max(1, Number(p[1]) || 1)]);
    return result.rowCount;
  }
  if (command === "LPUSH") {
    await pool.query("INSERT INTO list_values(key,value) VALUES($1,$2)", [String(p[0]), String(p[1])]);
    return Number((await pool.query("SELECT count(*) FROM list_values WHERE key=$1", [String(p[0])])).rows[0].count);
  }
  if (command === "LRANGE") {
    const start = Math.max(0, Number(p[1]) || 0), stop = Number(p[2]);
    const limit = stop < 0 ? 2147483647 : Math.max(0, stop - start + 1);
    return (await pool.query("SELECT value FROM list_values WHERE key=$1 ORDER BY sequence DESC OFFSET $2 LIMIT $3", [String(p[0]), start, limit])).rows.map((row) => row.value);
  }
  if (command === "LTRIM") {
    const start = Math.max(0, Number(p[1]) || 0), stop = Number(p[2]), limit = stop < 0 ? 2147483647 : Math.max(0, stop - start + 1);
    await pool.query(`DELETE FROM list_values WHERE key=$1 AND sequence NOT IN
      (SELECT sequence FROM list_values WHERE key=$1 ORDER BY sequence DESC OFFSET $2 LIMIT $3)`, [String(p[0]), start, limit]);
    return "OK";
  }
  throw new Error(`Desteklenmeyen veri komutu: ${command}`);
}

export async function getAll(key) {
  const flat = (await redis("HGETALL", key)) || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ id: flat[i], ...JSON.parse(flat[i + 1]) });
  return out;
}

export async function getOne(key, id) {
  const v = await redis("HGET", key, id);
  return v ? JSON.parse(v) : null;
}

export async function put(key, id, obj) {
  await redis("HSET", key, id, JSON.stringify(obj));
}

// {"__delete__": true} alanı siler (panel ve talimatla uyumlu)
export function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && v.__delete__ === true) delete out[k];
    else out[k] = v;
  }
  return out;
}
