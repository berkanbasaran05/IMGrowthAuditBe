import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { runAudit } from "./audit.runner.js";
import { AuditService } from "./audit.service.js";

// Veritabanı destekli arka plan kuyruğu: ek altyapı (Redis/BullMQ) gerektirmez.
// - İş alma: FOR UPDATE SKIP LOCKED ile atomik; birden fazla sunucu örneği güvenle çalışır.
// - Zaman aşımı: AUDIT_TIMEOUT_MS sonunda iş iptal edilir.
// - Yeniden deneme: geçici hatalarda üstel bekleme (30 sn, 2 dk, 8 dk), en fazla max_attempts.
// - AUDIT_WORKER=0 ile bu örnekte işçi kapatılabilir (yalnızca API sunucusu olarak çalışır).

const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 240_000);
const CONCURRENCY = Math.max(1, Number(process.env.AUDIT_CONCURRENCY || 2));
const POLL_MS = 2_000;

@Injectable()
export class AuditQueue implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("GrowthAudit");
  private timer: NodeJS.Timeout | null = null;
  private running = new Map<string, AbortController>();
  private ticking = false;
  lastTick: string | null = null;
  get active() { return this.running.size; }

  constructor(private readonly audits: AuditService) {}

  onModuleInit() {
    if (process.env.AUDIT_WORKER === "0" || !process.env.DATABASE_URL) return;
    this.audits.recoverStale(TIMEOUT_MS + 30_000).catch((e) => this.log.warn(`Yarım kalan denetimler kurtarılamadı: ${e.message}`));
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.running.values()) controller.abort(new Error("Sunucu kapanıyor"));
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true; this.lastTick = new Date().toISOString();
    try {
      while (this.running.size < CONCURRENCY) {
        const job = await this.audits.claimNext();
        if (!job) break;
        void this.execute(job);
      }
    } catch (error: any) {
      this.log.warn(`Kuyruk okunamadı: ${error.message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async execute(job: { id: string; leadId: string; attempts: number; maxAttempts: number }) {
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const timer = setTimeout(() => controller.abort(Object.assign(new Error("Denetim zaman aşımına uğradı"), { name: "TimeoutError" })), TIMEOUT_MS);
    try {
      const lead = await this.audits.loadLead(job.leadId);
      const outcome = await runAudit(lead, (stage, pct) => this.audits.progress(job.id, stage, pct), controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      await this.audits.complete(job.id, job.leadId, outcome);
      this.log.log(`${job.leadId}: ${outcome.status} · skor ${outcome.score.overall ?? "-"} · kapsam ${Math.round(outcome.score.coverage * 100)}%`);
    } catch (error: any) {
      const timedOut = controller.signal.aborted;
      const retryable = timedOut || !!error?.retryable;
      const message = timedOut ? "Denetim zaman aşımına uğradı" : String(error?.message || error);
      this.log.warn(`${job.leadId}: deneme ${job.attempts}/${job.maxAttempts} başarısız — ${message}`);
      await this.audits.fail(job.id, message, { attempts: job.attempts, maxAttempts: job.maxAttempts, retryable }).catch(() => {});
    } finally {
      clearTimeout(timer);
      this.running.delete(job.id);
    }
  }
}
