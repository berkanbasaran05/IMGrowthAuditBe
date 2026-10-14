import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { getOne } from "../growth/lib/redis.js";
import type { AuditOutcome } from "./audit.runner.js";
import { toScored } from "./audit.runner.js";
import { CATEGORIES, LeadInfo, MetricResult, PROMPT_VERSION, RUBRIC_VERSION, SCORING_VERSION, ScoredMetric } from "./audit.types.js";
import { METRICS } from "./metrics.js";
import { buildOpportunities } from "./opportunities.js";
import { computeGrowthScore } from "./scoring.js";

export class AuditConflictError extends Error {
  constructor(readonly auditId: string) { super("Bu firma için devam eden bir denetim zaten var"); }
}
export class AuditNotFoundError extends Error {}

const ACTIVE = ["queued", "running"];
export const OPPORTUNITY_STATUS = ["open", "accepted", "in_progress", "done", "dismissed"];
const LEAD_ID = /^[a-z0-9-]{1,120}$/;
const n = (v: unknown) => (v == null ? null : Number(v));

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async loadLead(leadId: string): Promise<LeadInfo> {
    if (!LEAD_ID.test(leadId)) throw new AuditNotFoundError("Firma bulunamadı");
    const lead = await getOne("leads", leadId);
    if (!lead) throw new AuditNotFoundError("Firma bulunamadı");
    return { id: leadId, name: lead.name, sector: lead.sector, city: lead.city, district: lead.district, phone: lead.phone, email: lead.email, website: lead.website, instagram: lead.instagram, services: lead.services };
  }

  async start(leadId: string, triggeredBy: string | null) {
    const lead = await this.loadLead(leadId);
    const active = await this.prisma.growthAudit.findFirst({ where: { leadId, status: { in: ACTIVE } }, select: { id: true } });
    if (active) throw new AuditConflictError(active.id);
    try {
      return await this.prisma.growthAudit.create({
        data: { leadId, status: "queued", stage: "Sırada", websiteUrl: lead.website || null, scoringVersion: SCORING_VERSION, triggeredBy },
        select: { id: true, status: true, createdAt: true },
      });
    } catch (error: any) {
      // Kısmi benzersiz indeks (growth_audits_one_active_per_lead) yarış durumunda ikinci kaydı engeller.
      if (error?.code === "P2002" || /growth_audits_one_active_per_lead/.test(String(error?.message))) {
        const again = await this.prisma.growthAudit.findFirst({ where: { leadId, status: { in: ACTIVE } }, select: { id: true } });
        throw new AuditConflictError(again?.id || "");
      }
      throw error;
    }
  }

  // Kuyruktan bir işi atomik olarak alır; birden fazla işçi aynı kaydı alamaz.
  async claimNext(): Promise<{ id: string; leadId: string; attempts: number; maxAttempts: number } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string; lead_id: string; attempts: number; max_attempts: number }[]>`
      UPDATE growth_audits SET status = 'running', attempts = attempts + 1, started_at = now(), updated_at = now(), stage = 'Başladı', progress = 1, error = NULL
      WHERE id = (SELECT id FROM growth_audits WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id::text, lead_id, attempts, max_attempts`;
    const row = rows[0];
    return row ? { id: row.id, leadId: row.lead_id, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts) } : null;
  }

  async progress(id: string, stage: string, progress: number) {
    await this.prisma.growthAudit.update({ where: { id }, data: { stage: stage.slice(0, 60), progress: Math.max(1, Math.min(99, Math.round(progress))), updatedAt: new Date() } });
  }

  // Zaman aşımına uğrayıp "running" kalmış işleri (ör. sunucu yeniden başladığında) yeniden kuyruğa alır.
  async recoverStale(timeoutMs: number) {
    return this.prisma.$executeRaw`
      UPDATE growth_audits SET
        status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
        error = 'Denetim yarıda kaldı (zaman aşımı veya sunucu yeniden başlatıldı)', stage = NULL, updated_at = now(),
        finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
      WHERE status = 'running' AND started_at < now() - (${Math.round(timeoutMs / 1000)} * interval '1 second')`;
  }

  async fail(id: string, message: string, retry: { attempts: number; maxAttempts: number; retryable: boolean }) {
    const again = retry.retryable && retry.attempts < retry.maxAttempts;
    const delaySec = 30 * 4 ** (retry.attempts - 1); // 30 sn, 2 dk, 8 dk
    await this.prisma.growthAudit.update({
      where: { id },
      data: again
        ? { status: "queued", stage: `Yeniden denenecek (${retry.attempts}/${retry.maxAttempts})`, error: message.slice(0, 500), nextAttemptAt: new Date(Date.now() + delaySec * 1000), updatedAt: new Date() }
        : { status: "failed", stage: null, error: message.slice(0, 500), finishedAt: new Date(), updatedAt: new Date() },
    });
  }

  async complete(id: string, leadId: string, outcome: AuditOutcome) {
    const { score } = outcome;
    await this.prisma.$transaction([
      this.prisma.auditMetricResult.deleteMany({ where: { auditId: id } }),
      this.prisma.auditEvidence.deleteMany({ where: { auditId: id } }),
      this.prisma.growthOpportunity.deleteMany({ where: { auditId: id } }),
      this.prisma.auditMetricResult.createMany({ data: outcome.metrics.map((m) => metricRow(id, m)) }),
      this.prisma.auditEvidence.createMany({ data: outcome.evidence.map((e) => ({ auditId: id, kind: e.kind, sourceUrl: e.sourceUrl, title: e.title, data: e.data as any })) }),
      this.prisma.growthOpportunity.createMany({ data: outcome.opportunities.map((o) => ({ auditId: id, leadId, ...o, metricIds: o.metricIds, evidence: o.evidence as any })) }),
      this.prisma.growthAudit.update({
        where: { id },
        data: {
          status: outcome.status, stage: null, progress: 100, finalUrl: outcome.finalUrl, overallScore: score.overall, coverage: score.coverage, confidence: score.confidence,
          categoryScores: score.categories as any, summary: (outcome.summary ?? undefined) as any, aiModel: outcome.aiModel, promptVersion: outcome.aiModel ? PROMPT_VERSION : null,
          usage: outcome.usage as any, error: outcome.note ?? null, finishedAt: new Date(), updatedAt: new Date(),
        },
      }),
    ]);
  }

  // İnsan incelemesi: puanı geçersiz kılar (score=null → geçersiz kılmayı kaldırır), puanları ve fırsatları yeniden hesaplar.
  async review(auditId: string, metricId: string, reviewerScore: number | null, reason: string, reviewer: string | null) {
    const audit = await this.prisma.growthAudit.findUnique({ where: { id: auditId }, include: { metrics: true } });
    if (!audit) throw new AuditNotFoundError("Denetim bulunamadı");
    if (audit.status !== "completed") throw new Error("Yalnızca tamamlanmış denetimler incelenebilir");
    const row = audit.metrics.find((m) => m.metricId === metricId);
    if (!row) throw new AuditNotFoundError("Metrik bulunamadı");
    if (row.state === "NOT_APPLICABLE") throw new Error("Uygulanamaz metrik puanlanamaz");
    if (reviewerScore != null && (!Number.isFinite(reviewerScore) || reviewerScore < 0 || reviewerScore > 100)) throw new Error("Puan 0-100 arasında olmalı");
    if (!reason.trim()) throw new Error("İnceleme gerekçesi zorunlu");

    // Ölçülemeyen (UNKNOWN/FAILED) metriğe insan puanı verilirse metrik tahmini (ESTIMATED) olarak puana girer;
    // geçersiz kılma kaldırılınca puansız metrik yeniden UNKNOWN olur.
    const unscored = row.originalScore == null;
    const state = unscored ? (reviewerScore != null ? "ESTIMATED" : "UNKNOWN") : row.state;
    const metrics: ScoredMetric[] = audit.metrics.map((m) => m.metricId === metricId
      ? { ...fromRow(m), state: state as ScoredMetric["state"], reviewerScore }
      : { ...fromRow(m), reviewerScore: n(m.reviewerScore) });
    const score = computeGrowthScore(metrics);
    // Yeniden üretilen fırsatlarda kullanıcının verdiği durum (kabul, yapıldı, gizlendi) metrik bazında korunur.
    const previous = await this.prisma.growthOpportunity.findMany({ where: { auditId }, select: { metricIds: true, status: true } });
    const statusOf = new Map(previous.map((o) => [(o.metricIds as string[])[0], o.status]));
    const opportunities = buildOpportunities(metrics).map((o) => ({ ...o, status: statusOf.get(o.metricIds[0]) ?? "open" }));
    await this.prisma.$transaction([
      this.prisma.auditReview.create({ data: { auditId, metricId, previousScore: n(row.finalScore), reviewerScore, reason: reason.slice(0, 1000), reviewer } }),
      this.prisma.auditMetricResult.update({ where: { id: row.id }, data: { reviewerScore, finalScore: reviewerScore ?? n(row.originalScore), reviewReason: reason.slice(0, 1000), state } }),
      this.prisma.growthOpportunity.deleteMany({ where: { auditId } }),
      this.prisma.growthOpportunity.createMany({ data: opportunities.map((o) => ({ auditId, leadId: audit.leadId, ...o, metricIds: o.metricIds, evidence: o.evidence as any })) }),
      this.prisma.growthAudit.update({ where: { id: auditId }, data: { overallScore: score.overall, coverage: score.coverage, confidence: score.confidence, categoryScores: score.categories as any, updatedAt: new Date() } }),
    ]);
    return this.getAudit(auditId);
  }

  async setOpportunityStatus(id: string, status: string) {
    if (!OPPORTUNITY_STATUS.includes(status)) throw new Error("Geçersiz durum");
    const r = await this.prisma.growthOpportunity.updateMany({ where: { id }, data: { status } });
    if (!r.count) throw new AuditNotFoundError("Fırsat bulunamadı");
    return { ok: true, id, status };
  }

  async getAudit(id: string) {
    const audit = await this.prisma.growthAudit.findUnique({
      where: { id },
      include: { metrics: true, evidence: { orderBy: { capturedAt: "asc" } }, opportunities: { orderBy: { priorityScore: "desc" } }, reviews: { orderBy: { createdAt: "desc" }, take: 50 } },
    });
    if (!audit) throw new AuditNotFoundError("Denetim bulunamadı");
    const order = new Map(METRICS.map((m, i) => [m.id, i]));
    return {
      ...auditHead(audit),
      metrics: audit.metrics.sort((a, b) => (order.get(a.metricId) ?? 99) - (order.get(b.metricId) ?? 99)).map((m) => {
        const def = METRICS.find((d) => d.id === m.metricId);
        return {
          metricId: m.metricId, name: def?.name ?? m.metricId, rubric: def?.rubric ?? "", category: m.category, weight: Number(m.weight), method: m.method, state: m.state,
          originalScore: n(m.originalScore), reviewerScore: n(m.reviewerScore), finalScore: n(m.finalScore), confidence: n(m.confidence),
          reason: m.reason, recommendation: m.recommendation, evidence: m.evidence, reviewReason: m.reviewReason,
          rubricVersion: m.rubricVersion, modelVersion: m.modelVersion, promptVersion: m.promptVersion, evaluatedAt: m.evaluatedAt,
        };
      }),
      evidence: audit.evidence.map((e) => ({ id: e.id, kind: e.kind, sourceUrl: e.sourceUrl, title: e.title, data: e.data, capturedAt: e.capturedAt })),
      opportunities: audit.opportunities.map((o) => ({ ...o, confidence: Number(o.confidence) })),
      reviews: audit.reviews.map((r) => ({ ...r, previousScore: n(r.previousScore), reviewerScore: n(r.reviewerScore) })),
    };
  }

  async forLead(leadId: string) {
    if (!LEAD_ID.test(leadId)) throw new AuditNotFoundError("Firma bulunamadı");
    const history = await this.prisma.growthAudit.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { opportunities: true } } } });
    const latest = history.find((a) => a.status === "completed" || a.status === "no_verified_website");
    const active = history.find((a) => ACTIVE.includes(a.status));
    return {
      active: active ? auditHead(active) : null,
      latest: latest ? await this.getAudit(latest.id) : null,
      history: history.map((a) => ({ ...auditHead(a), opportunityCount: a._count.opportunities })),
    };
  }

  // Firma listesi için firma başına son denetim özeti.
  async summary() {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (a.lead_id) a.lead_id, a.id::text, a.status, a.overall_score::float8 AS score, a.coverage::float8 AS coverage, a.finished_at,
        (SELECT count(*)::int FROM growth_opportunities o WHERE o.audit_id = a.id AND o.status NOT IN ('done','dismissed')) AS opportunities
      FROM growth_audits a ORDER BY a.lead_id, a.created_at DESC`;
    return rows.map((r) => ({ leadId: r.lead_id, auditId: r.id, status: r.status, score: r.score, coverage: r.coverage, finishedAt: r.finished_at, opportunityCount: r.opportunities }));
  }

  definitions() {
    return { scoringVersion: SCORING_VERSION, rubricVersion: RUBRIC_VERSION, categories: CATEGORIES, metrics: METRICS.map(({ evaluate, ...m }) => m) };
  }
}

function metricRow(auditId: string, m: ScoredMetric) {
  return {
    auditId, metricId: m.metricId, category: m.category, weight: m.weight, method: m.method, state: m.state,
    originalScore: m.score, finalScore: m.score, confidence: m.confidence, reason: m.reason?.slice(0, 2000) ?? null,
    recommendation: m.recommendation?.slice(0, 1000) ?? null, evidence: m.evidence as any, rubricVersion: RUBRIC_VERSION,
    modelVersion: m.modelVersion ?? null, promptVersion: m.promptVersion ?? null,
  };
}

function fromRow(m: any): ScoredMetric {
  const [scored] = toScored([{ metricId: m.metricId, state: m.state, score: n(m.originalScore), confidence: n(m.confidence), evidence: (m.evidence as any[]) || [], reason: m.reason || "", recommendation: m.recommendation || undefined } as MetricResult]);
  return { ...scored, weight: Number(m.weight) };
}

function auditHead(a: any) {
  return {
    id: a.id, leadId: a.leadId, status: a.status, stage: a.stage, progress: a.progress, websiteUrl: a.websiteUrl, finalUrl: a.finalUrl,
    scoringVersion: a.scoringVersion, overallScore: n(a.overallScore), coverage: n(a.coverage), confidence: n(a.confidence),
    categoryScores: a.categoryScores, summary: a.summary, aiModel: a.aiModel, promptVersion: a.promptVersion, usage: a.usage,
    attempts: a.attempts, maxAttempts: a.maxAttempts, error: a.error, triggeredBy: a.triggeredBy,
    startedAt: a.startedAt, finishedAt: a.finishedAt, createdAt: a.createdAt,
  };
}
