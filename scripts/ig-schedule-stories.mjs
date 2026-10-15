// Instagram hikâyelerini zamanlar: görselleri IG_MEDIA_DIR'e JPEG olarak kopyalar ve ig_scheduled_posts'a 'queued' satır ekler.
// Yayını backend içindeki işçi yapar (IG_PUBLISHER, dakikada bir). Belirteç/sırlar yazdırılmaz.
//
// Kullanım (backend dizininde, önce `npm run build`):
//   npm run ig:schedule -- --dir ./stories --files a.png,b.png,c.png --start "2026-10-16T11:00" --every-hours 24 --tz Europe/Istanbul [--dry-run]
//   npm run ig:schedule -- --list
//   npm run ig:schedule -- --cancel <id>
// --files verilmezse dizindeki tüm .png/.jpg/.jpeg dosyaları ada göre sıralanır. Varsayılanlar: --every-hours 24, --tz Europe/Istanbul.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const logicPath = path.join(here, "../dist/modules/instagram/ig-publisher.logic.js");
if (!existsSync(logicPath)) { console.error("dist/ bulunamadı: önce `npm run build` çalıştırın."); process.exit(1); }
const L = await import(logicPath);

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, inline] = a.slice(2).split("=", 2);
    if (["list", "dry-run", "help"].includes(k)) { out.flags.add(k); continue; }
    out[k] = inline ?? argv[++i];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const tz = args.tz || "Europe/Istanbul";
const dryRun = args.flags.has("dry-run");

if (args.flags.has("help")) {
  console.log(readUsage());
  process.exit(0);
}
function readUsage() {
  return 'npm run ig:schedule -- --dir <dizin> [--files a.png,b.png] --start "2026-10-16T11:00" [--every-hours 24] [--tz Europe/Istanbul] [--dry-run]\n' +
    "npm run ig:schedule -- --list\nnpm run ig:schedule -- --cancel <id>";
}

const needDb = !(dryRun && !args.flags.has("list") && !args.cancel);
if (needDb && !process.env.DATABASE_URL) { console.error("DATABASE_URL tanımlı değil (.env)"); process.exit(1); }
const pool = needDb ? new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" }) : null;

try {
  if (args.flags.has("list")) await list();
  else if (args.cancel) await cancel(args.cancel);
  else await schedule();
} catch (e) {
  console.error(`Hata: ${e.message}`);
  process.exitCode = 1;
} finally { await pool?.end(); }

async function list() {
  const { rows } = await pool.query(`SELECT id, file_name, scheduled_at, status, attempts, media_id, error FROM ig_scheduled_posts
    WHERE status IN ('queued','publishing') OR scheduled_at >= now() - interval '14 days' ORDER BY scheduled_at`);
  if (!rows.length) { console.log("Kuyruk boş."); return; }
  for (const r of rows) {
    console.log(`${r.id}  ${L.formatInZone(r.scheduled_at, tz)}  ${r.status.padEnd(10)}  ${r.file_name}${r.attempts ? `  deneme ${r.attempts}` : ""}${r.media_id ? `  medya ${r.media_id}` : ""}${r.error ? `\n    hata: ${r.error}` : ""}`);
  }
}

async function cancel(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Geçersiz kimlik");
  const { rows } = await pool.query(`UPDATE ig_scheduled_posts SET status='canceled', updated_at=now() WHERE id=$1 AND status IN ('queued','failed') RETURNING file_name`, [id]);
  if (!rows.length) throw new Error("Satır bulunamadı ya da iptal edilemez (yalnızca queued/failed iptal edilir)");
  console.log(`İptal edildi: ${rows[0].file_name}`);
}

async function schedule() {
  if (!args.dir) throw new Error(`--dir gerekli\n${readUsage()}`);
  if (!args.start) throw new Error("--start gerekli (ör. 2026-10-16T11:00)");
  const dir = path.resolve(args.dir);
  const files = args.files
    ? args.files.split(",").map((f) => f.trim()).filter(Boolean)
    : readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort((a, b) => a.localeCompare(b, "tr", { numeric: true }));
  if (!files.length) throw new Error("Dosya yok");
  for (const f of files) {
    const p = path.join(dir, f);
    if (!/\.(png|jpe?g)$/i.test(f)) throw new Error(`Desteklenmeyen dosya: ${f} (png/jpg)`);
    if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`Bulunamadı: ${p}`);
  }
  const every = Number(args["every-hours"] ?? 24);
  const times = L.scheduleTimes(args.start, files.length, every, tz);
  if (times[0].getTime() < Date.now() - 60_000) throw new Error(`Başlangıç geçmişte: ${L.formatInZone(times[0], tz)} (${tz})`);
  const mediaDir = L.mediaDir(process.env);
  const plan = files.map((f, i) => ({ src: path.join(dir, f), at: times[i], name: L.storyFileName(f, times[i], tz) }));
  for (const p of plan) if (!L.isValidMediaFile(p.name)) throw new Error(`Hedef ad üretilemedi: ${p.name}`);

  console.log(`${dryRun ? "[deneme] " : ""}${plan.length} hikâye · ${tz} · her ${every} saatte · hedef dizin ${mediaDir}`);
  for (const p of plan) console.log(`  ${L.formatInZone(p.at, tz)}  ${path.basename(p.src)} → ${p.name}\n    ${L.mediaUrl(p.name, process.env)}`);
  if (dryRun) return;

  if (pool) {
    const { rows } = await pool.query(`SELECT file_name FROM ig_scheduled_posts WHERE file_name = ANY($1) AND status IN ('queued','publishing','published')`, [plan.map((p) => p.name)]);
    if (rows.length) throw new Error(`Zaten zamanlanmış: ${rows.map((r) => r.file_name).join(", ")}`);
  }
  mkdirSync(mediaDir, { recursive: true, mode: 0o755 });
  const written = [];
  try {
    for (const p of plan) {
      const dest = path.join(mediaDir, p.name);
      await toJpeg(p.src, dest);
      chmodSync(dest, 0o644);
      written.push(dest);
      const size = statSync(dest).size;
      if (size > 8 * 1024 * 1024) throw new Error(`${p.name} 8 MB'tan büyük (${(size / 1048576).toFixed(1)} MB)`);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of plan) {
        const { rows } = await client.query(`INSERT INTO ig_scheduled_posts (kind, file_name, scheduled_at) VALUES ('story', $1, $2) RETURNING id`, [p.name, p.at]);
        p.id = rows[0].id;
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (e) {
    for (const w of written) { try { unlinkSync(w); } catch {} }
    throw e;
  }
  console.log("Kuyruğa eklendi:");
  for (const p of plan) console.log(`  ${p.id}  ${L.formatInZone(p.at, tz)}  ${p.name}`);
}

// PNG/JPEG → JPEG (Instagram yalnızca JPEG kabul eder). Hikâye için en fazla 1080×1920'ye sığdırılır (büyütülmez),
// saydam alan beyazla doldurulur. Sırayla: sharp (backend ya da frontend node_modules) → macOS sips → ImageMagick.
async function toJpeg(src, dest) {
  const sharp = loadSharp();
  if (sharp) {
    await sharp(src).rotate().resize({ width: 1080, height: 1920, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toFile(dest);
    return;
  }
  const isJpeg = /\.jpe?g$/i.test(src);
  if (isJpeg) { copyFileSync(src, dest); return; }
  const tries = [
    ["sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", src, "--out", dest]],
    ["magick", [src, "-background", "white", "-flatten", "-resize", "1080x1920>", "-quality", "90", dest]],
    ["convert", [src, "-background", "white", "-flatten", "-resize", "1080x1920>", "-quality", "90", dest]],
  ];
  for (const [cmd, a] of tries) {
    try { execFileSync(cmd, a, { stdio: "ignore" }); if (existsSync(dest)) return; } catch {}
  }
  throw new Error("PNG → JPEG dönüştürülemedi: sharp, sips ya da ImageMagick bulunamadı (dosyaları .jpg olarak verin)");
}

function loadSharp() {
  for (const base of [path.join(here, "../package.json"), path.join(here, "../../frontend/package.json")]) {
    try { return createRequire(base)("sharp"); } catch {}
  }
  return null;
}
