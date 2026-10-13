// Firmaları canlı panele gönderir.
// Kullanım: SITE_URL=https://... INGEST_TOKEN=... node scripts/push.mjs <dosya.json | klasör> [--run 2026-09-25 --sectors "A,B" --summary "..."]
// Dosya: [{id, name, ...}] dizisi. Klasör: her firma için bir JSON (ArtifactData dışa aktarımı dahil).
import fs from "node:fs";
import path from "node:path";

const { SITE_URL, INGEST_TOKEN } = process.env;
if (!SITE_URL || !INGEST_TOKEN) { console.error("SITE_URL ve INGEST_TOKEN gerekli"); process.exit(1); }
const [src, ...rest] = process.argv.slice(2);
const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };

const unwrap = (o, id) => (o && o.data && typeof o.data === "object" ? { id: o.id || id, ...o.data } : { id, ...o });
let leads = [];
if (fs.statSync(src).isDirectory()) {
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".json")))
    leads.push(unwrap(JSON.parse(fs.readFileSync(path.join(src, f), "utf8")), f.replace(/\.json$/, "")));
} else leads = JSON.parse(fs.readFileSync(src, "utf8")).map((l) => unwrap(l, l.id));

const run = arg("--run") ? { date: arg("--run"), found: leads.length, sectors: (arg("--sectors") || "").split(",").filter(Boolean), summary: arg("--summary") || "" } : undefined;

for (let i = 0; i < leads.length; i += 25) {
  const r = await fetch(SITE_URL.replace(/\/$/, "") + "/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${INGEST_TOKEN}` },
    body: JSON.stringify({ leads: leads.slice(i, i + 25), run: i + 25 >= leads.length ? run : undefined }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Hata:", r.status, j.error); process.exit(1); }
  console.log(`Gönderildi: ${j.added} yeni, ${j.updated} güncellendi`);
}
