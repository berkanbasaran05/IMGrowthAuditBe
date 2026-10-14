import { Controller, Get, Injectable, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateConfig } from "../../infrastructure/config.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuditQueue } from "../audit/audit.queue.js";
import { GeoService } from "../geo/geo.service.js";
import { GrowthManagerScheduler } from "../growth-manager/growth-manager.scheduler.js";
import { isAuthed } from "../growth/lib/auth.js";
import { redis } from "../growth/lib/redis.js";
import { RetentionService, retentionPolicy } from "./retention.service.js";

// Operasyon görünümü (yalnızca yönetici): kuyruklar, zamanlayıcılar, entegrasyon hataları, AI/API maliyeti,
// e-posta limiti, veritabanı ve sürüm. Gizli değer içermez.

const VERSION = (() => { try { return JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")).version; } catch { return "?"; } })();
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

@Injectable()
export class OpsService {
  constructor(private readonly prisma: PrismaService, private readonly queue: AuditQueue, private readonly scheduler: GrowthManagerScheduler, private readonly geo: GeoService, private readonly retention: RetentionService) {}

  async status() {
    const since30 = new Date(Date.now() - 30 * 86_400_000), since24 = new Date(Date.now() - 86_400_000);
    const [audits, failed24, durations, integrations, aiRows, dbSize, sentToday, migrations] = await Promise.all([
      this.prisma.growthAudit.groupBy({ by: ["status"], _count: true }),
      this.prisma.growthAudit.findMany({ where: { status: "failed", updatedAt: { gte: since24 } }, select: { leadId: true, error: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
      this.prisma.$queryRaw<{ avg: number | null; oldest_queued: Date | null }[]>`
        SELECT (SELECT avg(EXTRACT(EPOCH FROM finished_at - started_at)) FROM (SELECT finished_at, started_at FROM growth_audits WHERE status='completed' AND started_at IS NOT NULL ORDER BY finished_at DESC LIMIT 20) t)::float8 AS avg,
               (SELECT min(created_at) FROM growth_audits WHERE status='queued') AS oldest_queued`,
      this.prisma.customerIntegration.findMany({ where: { status: { in: ["error", "connected", "pending"] } }, select: { provider: true, status: true, lastError: true, lastSyncAt: true, organization: { select: { name: true } } } }),
      // AI kullanımı üç kaynaktan toplanır: denetim analisti, satış taslakları, günlük brif.
      this.prisma.$queryRaw<{ feature: string; calls: number; input: number; output: number; cost: number }[]>`
        SELECT 'growth_audit' AS feature, count(*)::int AS calls, coalesce(sum((usage->'ai'->>'inputTokens')::int),0)::int AS input, coalesce(sum((usage->'ai'->>'outputTokens')::int),0)::int AS output, coalesce(sum((usage->'ai'->>'costUsd')::float8),0)::float8 AS cost
          FROM growth_audits WHERE created_at >= ${since30} AND usage->'ai' IS NOT NULL AND usage->'ai' <> 'null'::jsonb
        UNION ALL SELECT 'sales_drafts', count(*)::int, coalesce(sum((usage->'ai'->>'inputTokens')::int),0)::int, coalesce(sum((usage->'ai'->>'outputTokens')::int),0)::int, coalesce(sum((usage->'ai'->>'costUsd')::float8),0)::float8
          FROM sales_drafts WHERE created_at >= ${since30} AND usage->'ai' IS NOT NULL AND usage->'ai' <> 'null'::jsonb
        UNION ALL SELECT 'daily_briefs', count(*)::int, coalesce(sum((usage->'ai'->>'inputTokens')::int),0)::int, coalesce(sum((usage->'ai'->>'outputTokens')::int),0)::int, coalesce(sum((usage->'ai'->>'costUsd')::float8),0)::float8
          FROM daily_briefs WHERE created_at >= ${since30} AND usage->'ai' IS NOT NULL AND usage->'ai' <> 'null'::jsonb`,
      this.prisma.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
      redis("GET", `sent:${today()}`).catch(() => 0),
      this.prisma.$queryRaw<{ name: string; finished: Date | null }[]>`SELECT migration_name AS name, finished_at AS finished FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1`.catch(() => []),
    ]);
    const psi = await this.prisma.$queryRaw<{ runs: number; ok: number }[]>`
      SELECT count(*)::int AS runs, count(*) FILTER (WHERE (usage->'pagespeed'->>'mobile')::boolean)::int AS ok FROM growth_audits WHERE created_at >= ${since30} AND usage ? 'pagespeed'`;
    const cfg = validateConfig();
    return {
      version: VERSION, node: process.version, env: process.env.NODE_ENV || "development", uptimeSec: Math.round(process.uptime()),
      features: cfg.features, configWarnings: cfg.warnings, configErrors: cfg.errors,
      database: { size: dbSize[0]?.size ?? null, lastMigration: migrations[0]?.name ?? null },
      auditQueue: {
        worker: process.env.AUDIT_WORKER !== "0", active: this.queue.active, lastTick: this.queue.lastTick,
        byStatus: Object.fromEntries(audits.map((a) => [a.status, a._count])), avgDurationSec: durations[0]?.avg ? Math.round(durations[0].avg) : null,
        oldestQueued: durations[0]?.oldest_queued ?? null, failedLast24h: failed24,
      },
      scheduler: { worker: process.env.GM_WORKER !== "0", lastTick: this.scheduler.lastTick },
      integrations: {
        byStatus: integrations.reduce((acc: Record<string, number>, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {}),
        errors: integrations.filter((i) => i.status === "error" || i.lastError).map((i) => ({ org: i.organization.name, provider: i.provider, status: i.status, error: i.lastError, lastSyncAt: i.lastSyncAt })),
      },
      costs30d: { ai: aiRows, aiTotalUsd: Math.round(aiRows.reduce((s, r) => s + Number(r.cost), 0) * 100) / 100, pagespeed: psi[0] ?? { runs: 0, ok: 0 } },
      email: { sentToday: Number(sentToday || 0), dailyLimit: Number(process.env.SEND_DAILY_LIMIT || 25), dryRun: process.env.MAIL_DRY_RUN === "1" },
      geo: await this.geo.status().catch(() => null),
      retention: { policyDays: retentionPolicy(), lastRun: await this.retention.lastFromStore() },
    };
  }
}

@Controller("api/ops")
export class OpsController {
  constructor(private readonly ops: OpsService, private readonly retention: RetentionService) {}

  @Get("status") async status(@Req() req: Request, @Res() res: Response) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    return res.json(await this.ops.status());
  }
  @Post("retention/run") async runRetention(@Req() req: Request, @Res() res: Response) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    return res.json(await this.retention.run());
  }
}
