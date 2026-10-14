import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { log } from "../../infrastructure/http/http-hardening.js";

// Veri saklama politikası (gizlilik): artık gerekmeyen kayıtlar periyodik olarak silinir. Süreler ortam
// değişkenleriyle değiştirilebilir (gün). Denetim sonuçları ve puan geçmişi açıklanabilirlik için korunur;
// yalnızca büyük/hassas ekler (ekran görüntüleri) ve süresi geçmiş operasyonel kayıtlar silinir.

export const RETENTION_DEFAULTS = {
  screenshots: 180, // denetim ekran görüntüleri (audit_evidence kind=screenshot)
  metrics: 400, // bağlı kaynaklardan gelen günlük metrikler
  syncs: 90, // entegrasyon eşitleme kayıtları
  reportLinks: 180, // süresi dolmuş/iptal edilmiş rapor bağlantıları (bitişten itibaren)
  discardedDrafts: 90, // silinmiş satış taslakları
  closedInsights: 180, // gizlenen, çözülen veya geçerliliğini yitiren içgörüler
  briefs: 400, // günlük brifler
} as const;
export type RetentionPolicy = Record<keyof typeof RETENTION_DEFAULTS, number>;

export function retentionPolicy(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const out = { ...RETENTION_DEFAULTS } as RetentionPolicy;
  for (const k of Object.keys(out) as (keyof RetentionPolicy)[]) {
    const v = Number(env[`RETENTION_${k.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}_DAYS`]);
    if (Number.isFinite(v) && v >= 7) out[k] = Math.round(v); // en az 7 gün: yanlış ayarla toplu silmeyi önler
  }
  return out;
}
export const cutoff = (days: number, now = Date.now()) => new Date(now - days * 86_400_000);

@Injectable()
export class RetentionService {
  lastRun: { at: string; deleted: Record<string, number> } | null = null;
  constructor(private readonly prisma: PrismaService) {}

  async run(policy: RetentionPolicy = retentionPolicy()) {
    const p = this.prisma, d = (k: keyof RetentionPolicy) => cutoff(policy[k]);
    const deleted = {
      screenshots: (await p.auditEvidence.deleteMany({ where: { kind: "screenshot", capturedAt: { lt: d("screenshots") } } })).count,
      metrics: (await p.metricDaily.deleteMany({ where: { date: { lt: d("metrics") } } })).count,
      syncs: (await p.integrationSync.deleteMany({ where: { startedAt: { lt: d("syncs") } } })).count,
      reportLinks: (await p.auditReport.deleteMany({ where: { OR: [{ expiresAt: { lt: d("reportLinks") } }, { revokedAt: { lt: d("reportLinks") } }] } })).count,
      discardedDrafts: (await p.salesDraft.deleteMany({ where: { status: "discarded", updatedAt: { lt: d("discardedDrafts") } } })).count,
      closedInsights: (await p.aiInsight.deleteMany({ where: { status: { in: ["dismissed", "resolved", "expired"] }, updatedAt: { lt: d("closedInsights") } } })).count,
      briefs: (await p.dailyBrief.deleteMany({ where: { createdAt: { lt: d("briefs") } } })).count,
    };
    this.lastRun = { at: new Date().toISOString(), deleted };
    await p.keyValue.upsert({ where: { key: "retention:last" }, create: { key: "retention:last", value: JSON.stringify(this.lastRun) }, update: { value: JSON.stringify(this.lastRun) } });
    log("info", "retention", deleted);
    return this.lastRun;
  }

  // Günde bir kez (İstanbul saatiyle 03:00 sonrası) çalışır; çok sunucuda zamanlayıcının kilidi altında çağrılır.
  async runIfDue() {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }));
    const stored = await this.prisma.keyValue.findUnique({ where: { key: "retention:last" } });
    const last = stored ? JSON.parse(stored.value) : null;
    if (hour < 3 || (last?.at && new Date(last.at).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }) === today)) return null;
    return this.run();
  }

  async lastFromStore() {
    if (this.lastRun) return this.lastRun;
    const stored = await this.prisma.keyValue.findUnique({ where: { key: "retention:last" } });
    return stored ? JSON.parse(stored.value) : null;
  }
}
