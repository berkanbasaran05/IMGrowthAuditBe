// Upstash Redis REST (Vercel Marketplace entegrasyonu KV_REST_API_* değişkenlerini otomatik ekler)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export async function redis(...cmd) {
  if (!URL_ || !TOKEN) throw new Error("Veritabanı bağlı değil (KV_REST_API_URL / KV_REST_API_TOKEN eksik)");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
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
