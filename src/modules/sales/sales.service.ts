import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuditNotFoundError, AuditService } from "../audit/audit.service.js";
import { getOne, put } from "../growth/lib/redis.js";
import { buildReport, PublicReport } from "./report.model.js";
import { CallBrief, EmailDraft, generateCallBrief, generateEmail, SALES_PROMPT_VERSION, SalesLead } from "./sales-ai.js";

const LEAD_ID = /^[a-z0-9-]{1,120}$/;
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService, private readonly audits: AuditService) {}

  private async lead(leadId: string): Promise<SalesLead & Record<string, any>> {
    const lead = LEAD_ID.test(leadId) ? await getOne("leads", leadId) : null;
    if (!lead) throw new AuditNotFoundError("Firma bulunamadı");
    return { id: leadId, ...lead };
  }

  private async latestCompleted(leadId: string) {
    const row = await this.prisma.growthAudit.findFirst({ where: { leadId, status: "completed" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!row) throw new Error("Önce bu firma için tamamlanmış bir Growth Audit gerekir");
    return this.audits.getAudit(row.id);
  }

  // ---------------- Raporlar ----------------

  async reportFor(auditId: string): Promise<PublicReport> {
    const audit = await this.audits.getAudit(auditId);
    if (audit.status !== "completed") throw new Error("Rapor yalnızca tamamlanmış denetimler için oluşturulur");
    return buildReport(audit, await this.lead(audit.leadId));
  }

  async createLink(auditId: string, days: number, createdBy: string | null) {
    const audit = await this.prisma.growthAudit.findUnique({ where: { id: auditId }, select: { id: true, leadId: true, status: true } });
    if (!audit) throw new AuditNotFoundError("Denetim bulunamadı");
    if (audit.status !== "completed") throw new Error("Rapor yalnızca tamamlanmış denetimler için paylaşılabilir");
    const validDays = Math.max(1, Math.min(90, Math.round(days) || 30));
    const token = crypto.randomBytes(32).toString("base64url"); // 256 bit; tahmin edilemez
    const row = await this.prisma.auditReport.create({
      data: { auditId, leadId: audit.leadId, tokenHash: hashToken(token), tokenHint: token.slice(0, 6), createdBy, expiresAt: new Date(Date.now() + validDays * 86_400_000) },
    });
    return { id: row.id, token, expiresAt: row.expiresAt };
  }

  async links(leadId: string) {
    const rows = await this.prisma.auditReport.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 30 });
    const now = Date.now();
    return rows.map(({ tokenHash, ...r }) => ({ ...r, state: r.revokedAt ? "revoked" : r.expiresAt.getTime() <= now ? "expired" : "active" }));
  }

  async revoke(id: string) {
    const r = await this.prisma.auditReport.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new AuditNotFoundError("Bağlantı bulunamadı");
    return { ok: true };
  }

  // Herkese açık erişim: geçersiz, süresi dolmuş ve iptal edilmiş bağlantılar ayırt edilmeden 404 döner.
  async resolve(token: string, countView: boolean): Promise<PublicReport | null> {
    if (!TOKEN.test(token)) return null;
    const link = await this.prisma.auditReport.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return null;
    if (countView) await this.prisma.auditReport.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
    return this.reportFor(link.auditId).catch(() => null);
  }

  // ---------------- Taslaklar ----------------

  async generate(leadId: string, kind: "email" | "call_brief", createdBy: string | null) {
    const [lead, audit] = await Promise.all([this.lead(leadId), this.latestCompleted(leadId)]);
    const out = kind === "email" ? await generateEmail(lead, audit) : await generateCallBrief(lead, audit);
    const row = await this.prisma.salesDraft.create({
      data: { leadId, auditId: audit.id, kind, source: out.source, content: out.content as any, model: out.model, promptVersion: out.source === "ai" ? SALES_PROMPT_VERSION : null,
        usage: { ai: out.usage, note: out.note ?? null } as any, createdBy },
    });
    return { ...row, note: out.note ?? null };
  }

  async drafts(leadId: string) {
    if (!LEAD_ID.test(leadId)) throw new AuditNotFoundError("Firma bulunamadı");
    const rows = await this.prisma.salesDraft.findMany({ where: { leadId, status: { not: "discarded" } }, orderBy: { createdAt: "desc" }, take: 20 });
    return { email: rows.find((r) => r.kind === "email") || null, callBrief: rows.find((r) => r.kind === "call_brief") || null, history: rows.map(({ content, ...r }) => r) };
  }

  async callBriefs() {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (lead_id) id::text, lead_id, content, source, edited, created_at FROM sales_drafts
      WHERE kind = 'call_brief' AND status <> 'discarded' ORDER BY lead_id, created_at DESC`;
    return rows.map((r) => ({ id: r.id, leadId: r.lead_id, content: r.content, source: r.source, edited: r.edited, createdAt: r.created_at }));
  }

  async update(id: string, content: unknown) {
    const draft = await this.prisma.salesDraft.findUnique({ where: { id } });
    if (!draft || draft.status === "discarded") throw new AuditNotFoundError("Taslak bulunamadı");
    const clean = draft.kind === "email" ? cleanEmail(content, draft.content as any) : cleanBrief(content, draft.content as any);
    return this.prisma.salesDraft.update({ where: { id }, data: { content: clean as any, edited: true, updatedAt: new Date() } });
  }

  async discard(id: string) {
    const r = await this.prisma.salesDraft.updateMany({ where: { id, status: { not: "discarded" } }, data: { status: "discarded", updatedAt: new Date() } });
    if (!r.count) throw new AuditNotFoundError("Taslak bulunamadı");
    return { ok: true };
  }

  // E-posta taslağını firmanın "İlk e-posta" hazır metnine aktarır. Gönderim yine Gönderim ekranından,
  // kullanıcı onayı ve günlük limitle yapılır; burada hiçbir şey gönderilmez.
  async apply(id: string) {
    const draft = await this.prisma.salesDraft.findUnique({ where: { id } });
    if (!draft || draft.kind !== "email" || draft.status === "discarded") throw new AuditNotFoundError("E-posta taslağı bulunamadı");
    const { id: leadId, ...lead } = await this.lead(draft.leadId);
    const c = draft.content as unknown as EmailDraft;
    const next = { ...lead, outreach: { ...(lead.outreach || {}), subject: c.subject, body: c.body, edited: true, fromDraft: draft.id, fromAudit: draft.auditId } };
    await put("leads", leadId, next);
    await this.prisma.salesDraft.update({ where: { id }, data: { status: "applied", appliedAt: new Date(), updatedAt: new Date() } });
    return { ok: true, lead: { id: leadId, ...next } };
  }
}

const str = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").slice(0, max);
function cleanEmail(input: any, prev: EmailDraft): EmailDraft {
  const subject = str(input?.subject, 200).trim(), body = str(input?.body, 6000).trim();
  if (!subject || !body) throw new Error("Konu ve metin boş olamaz");
  return { ...prev, subject, body };
}
function cleanBrief(input: any, prev: CallBrief): CallBrief {
  const keys = ["scoreSummary", "reason", "recommendedService", "opening", "historySummary", "nextAction"] as const;
  const out: any = { ...prev };
  for (const k of keys) if (input?.[k] !== undefined) out[k] = str(input[k], 1000).trim();
  return out;
}
