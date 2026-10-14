import { Injectable, Logger } from "@nestjs/common";
import { getAll, getOne, put, redis } from "../growth/lib/redis.js";

// Firma konumları (harita görünümü için). Sonuçlar firma kaydından ayrı "geo" kovasında saklanır;
// böylece panelde yapılan firma düzenlemeleriyle çakışmaz.
// Kaynak önceliği: radar kaydındaki koordinat > Google Maps bağlantısındaki koordinat > adres araması > ilçe merkezi.
// OpenStreetMap Nominatim kullanım politikası gereği saniyede en fazla 1 istek atılır ve sonuçlar kalıcı önbelleğe alınır.

export interface GeoPoint { lat: number; lon: number; precision: "source" | "address" | "district" | "city" | "none"; query?: string; at: string }

const UA = "IMGrowthAudit/1.0 (istanbul.marketing)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const valid = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

export function pointFromLead(lead: any): { lat: number; lon: number } | null {
  const l = lead?.location;
  if (l && valid(Number(l.lat), Number(l.lon))) return { lat: Number(l.lat), lon: Number(l.lon) };
  const url = String(lead?.mapsUrl || "");
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m && valid(Number(m[1]), Number(m[2])) ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

export function addressQuery(lead: any): string | null {
  try {
    const q = new URL(String(lead?.mapsUrl || "")).searchParams.get("query");
    if (q && !/^-?\d+\.\d+,/.test(q)) return q.slice(0, 200);
  } catch { /* geçersiz bağlantı */ }
  return null;
}

@Injectable()
export class GeoService {
  private readonly log = new Logger("Geo");
  private running = false;
  private progress = { done: 0, total: 0 };
  private lastCall = 0;

  async all(): Promise<Record<string, GeoPoint>> {
    const rows = await getAll("geo");
    return Object.fromEntries(rows.map(({ id, ...p }: any) => [id, p as GeoPoint]));
  }

  async status() {
    const [leads, geo] = await Promise.all([getAll("leads"), this.all()]);
    const missing = leads.filter((l: any) => !geo[l.id] && !pointFromLead(l)).length;
    return { total: leads.length, located: leads.length - missing, missing, running: this.running, progress: this.progress };
  }

  private async nominatim(query: string): Promise<{ lat: number; lon: number } | null> {
    const wait = 1100 - (Date.now() - this.lastCall); if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
    const params = new URLSearchParams({ q: query, format: "jsonv2", countrycodes: "tr", limit: "1", "accept-language": "tr" });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (res.status === 429) throw Object.assign(new Error("Nominatim hız sınırı"), { retryable: true });
    if (!res.ok) return null;
    const hit = (await res.json().catch(() => []))?.[0];
    return hit && valid(Number(hit.lat), Number(hit.lon)) ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  }

  // Eksik konumları arka planda tamamlar (aynı anda tek iş). İlçe merkezleri önbelleğe alınır.
  start() {
    if (this.running) return { started: false, running: true };
    this.running = true;
    void this.run().catch((e) => this.log.warn(`Konum işi durdu: ${e.message}`)).finally(() => { this.running = false; });
    return { started: true, running: true };
  }

  private async run() {
    const [leads, geo] = await Promise.all([getAll("leads"), this.all()]);
    const todo = leads.filter((l: any) => !geo[l.id]);
    this.progress = { done: 0, total: todo.length };
    const areaCache = new Map<string, { lat: number; lon: number } | null>();
    for (const lead of todo) {
      const at = new Date().toISOString();
      let point: GeoPoint | null = null;
      const direct = pointFromLead(lead);
      if (direct) point = { ...direct, precision: "source", at };
      if (!point) {
        const q = addressQuery(lead) || [lead.name, lead.district, lead.city].filter(Boolean).join(" ");
        const hit = q ? await this.nominatim(q).catch(() => null) : null;
        if (hit) point = { ...hit, precision: "address", query: q, at };
      }
      for (const [precision, parts] of [["district", [lead.district, lead.city]], ["city", [lead.city]]] as const) {
        if (point || !parts.every(Boolean)) continue;
        const key = parts.join(", ");
        if (!areaCache.has(key)) areaCache.set(key, await this.nominatim(`${key}, Türkiye`).catch(() => null));
        const hit = areaCache.get(key);
        if (hit) point = { ...hit, precision, query: key, at };
      }
      await put("geo", lead.id, point || { lat: 0, lon: 0, precision: "none", at });
      this.progress.done++;
    }
  }

  // Adres değişirse konum silinir; bir sonraki işte yeniden hesaplanır.
  async reset(leadId: string) {
    if (!(await getOne("leads", leadId))) throw new Error("Firma bulunamadı");
    await redis("HDEL", "geo", leadId);
    return { ok: true };
  }
}
