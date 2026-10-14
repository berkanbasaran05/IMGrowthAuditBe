import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { GrowthManagerService } from "./growth-manager.service.js";
import { RetentionService } from "../ops/retention.service.js";

// Zamanlanmış işler (10 dakikada bir):
//  1) 6 saatten eski bağlı entegrasyonları eşitler, ardından o organizasyonu yeniden analiz eder.
//  2) Saat 07:00'den (İstanbul) sonra bugünün brifi olmayan organizasyonlar için Günlük Brif üretir.
// Çok sunuculu kurulumda pg_try_advisory_lock ile aynı işin iki kez çalışması önlenir. GM_WORKER=0 kapatır.

const LOCK_ID = 727_001;
const INTERVAL_MS = Number(process.env.GM_INTERVAL_MS || 10 * 60_000);

@Injectable()
export class GrowthManagerScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("GrowthManagerScheduler");
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  lastTick: { at: string; ok: boolean; error?: string; locked?: boolean } | null = null;

  constructor(private readonly gm: GrowthManagerService, private readonly prisma: PrismaService, private readonly retention: RetentionService) {}

  onModuleInit() {
    if (process.env.GM_WORKER === "0" || !process.env.DATABASE_URL) return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    setTimeout(() => void this.tick(), 15_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Kilit aynı bağlantıda alınıp bırakılmalı; Prisma havuzunda bunu tek işlem (transaction) içinde yapıyoruz.
      await this.prisma.$transaction(async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS locked`;
        if (!locked) { this.lastTick = { at: new Date().toISOString(), ok: true, locked: false }; return; }
        const touched = new Set<string>();
        for (const i of await this.gm.dueIntegrations()) {
          try { await this.gm.syncIntegration(i.id); touched.add(i.organizationId); }
          catch (e: any) { this.log.warn(`Eşitleme başarısız (${i.id}): ${e.message}`); }
        }
        for (const orgId of touched) await this.gm.analyze(orgId).catch((e) => this.log.warn(`Analiz başarısız (${orgId}): ${e.message}`));
        const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }));
        if (hour >= 7) for (const orgId of await this.gm.orgsNeedingBrief()) {
          await this.gm.analyze(orgId).catch(() => {});
          await this.gm.generateBrief(orgId).catch((e) => this.log.warn(`Brif üretilemedi (${orgId}): ${e.message}`));
        }
        await this.retention.runIfDue().catch((e) => this.log.warn(`Veri saklama işi başarısız: ${e.message}`));
        this.lastTick = { at: new Date().toISOString(), ok: true, locked: true };
      }, { timeout: INTERVAL_MS - 30_000, maxWait: 5_000 });
    } catch (e: any) {
      this.lastTick = { at: new Date().toISOString(), ok: false, error: String(e.message).slice(0, 300) };
      this.log.warn(`Zamanlanmış iş hatası: ${e.message}`);
    } finally {
      this.busy = false;
    }
  }
}
