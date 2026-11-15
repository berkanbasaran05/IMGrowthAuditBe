import { CanActivate, Controller, Delete, ExecutionContext, Get, HttpException, Injectable, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { log } from "../../infrastructure/http/http-hardening.js";
import { PublicAuditService } from "../audit/public-audit.service.js";
import { isAuthed } from "../growth/lib/auth.js";
import { publicBase } from "../sales/sales.controller.js";
import { type Conversation, isConversationId } from "./assistant.logic.js";

// Panel "Asistan" sekmesi: Marka Partneri konuşmalarının listesi, dökümü ve silinmesi (oturum gerekir).
// Yol iki+ parçalı: GrowthController'daki "api/:endpoint" yakalayıcısıyla çakışmaz.

@Injectable()
class PanelSession implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    if (isAuthed(ctx.switchToHttp().getRequest())) return true;
    throw new HttpException({ error: "Giriş gerekli" }, 401);
  }
}

const PAGE = 50;
const LIST_FIELDS = {
  id: true, createdAt: true, updatedAt: true, locale: true, leadId: true, company: true, sector: true,
  auditDomain: true, firstMessage: true, userTurns: true, costUsd: true,
} as const;

// Arama metni: firma, sektör, alan adı veya ilk mesajda geçer.
export function listWhere(q: string, lead: string) {
  const text = q.trim().slice(0, 80);
  return {
    ...(lead ? { leadId: lead.slice(0, 120) } : {}),
    ...(text ? { OR: (["company", "sector", "auditDomain", "firstMessage"] as const).map((f) => ({ [f]: { contains: text, mode: "insensitive" as const } })) } : {}),
  };
}

@Controller("api/assistant-panel")
@UseGuards(PanelSession)
export class AssistantPanelController {
  constructor(private readonly prisma: PrismaService, private readonly publicAudits: PublicAuditService) {}

  @Get("conversations")
  async list(@Query("q") q = "", @Query("lead") lead = "", @Query("page") page = "1", @Res() res: Response) {
    const where = listWhere(String(q), String(lead));
    const p = Math.max(1, Math.min(200, Number(page) || 1));
    const [items, total, totals] = await Promise.all([
      this.prisma.assistantConversation.findMany({ where, select: LIST_FIELDS, orderBy: { updatedAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE }),
      this.prisma.assistantConversation.count({ where }),
      this.prisma.assistantConversation.aggregate({ where, _sum: { costUsd: true, userTurns: true } }),
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({ items, total, page: p, pageSize: PAGE, costUsd: totals._sum.costUsd ?? 0, userTurns: totals._sum.userTurns ?? 0 });
  }

  @Get("conversations/:id")
  async detail(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    if (!isConversationId(id)) return res.status(404).json({ error: "Bulunamadı" });
    const row = await this.prisma.assistantConversation.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Bulunamadı" });
    const c = row.data as unknown as Conversation;
    let audit: Record<string, unknown> | null = null;
    if (c.audit) {
      audit = { domain: c.audit.domain, leadId: c.audit.leadId };
      try {
        const out: any = await this.publicAudits.poll(c.audit.token, publicBase(req));
        if (out) audit = { ...audit, status: out.status, score: out.result?.overallScore ?? null, grade: out.result?.grade ?? null, steps: (out.result?.topOpportunities || []).map((o: any) => o.title), reportUrl: out.result?.reportUrl ?? null, message: out.message ?? null };
      } catch (e: any) { log("warn", "assistant_panel_audit", { error: e?.message }); }
    }
    res.set("Cache-Control", "no-store");
    const { data: _data, ipHash: _ip, ...cols } = row;
    const site = (process.env.PUBLIC_SITE_URL || "https://www.istanbul.marketing").replace(/\/+$/, "");
    const reports = (c.reports || []).map((r) => ({ title: r.title, kind: r.kind, score: r.score, createdAt: r.createdAt, url: `${site}/analiz/is/${r.token}` }));
    return res.json({ ...cols, messages: c.view, profile: c.profile, audit, reports, usage: c.usage });
  }

  @Delete("conversations/:id")
  async remove(@Param("id") id: string, @Res() res: Response) {
    if (!isConversationId(id)) return res.status(404).json({ error: "Bulunamadı" });
    const out = await this.prisma.assistantConversation.deleteMany({ where: { id } });
    if (out.count) await this.prisma.assistantUpload.deleteMany({ where: { conversationId: id } }); // yüklenen görseller konuşmayla silinir; raporlar kalır
    if (!out.count) return res.status(404).json({ error: "Bulunamadı" });
    log("info", "assistant_conversation_deleted", { id: id.slice(0, 6) });
    return res.json({ ok: true });
  }
}
