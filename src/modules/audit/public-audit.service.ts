import { Injectable } from "@nestjs/common";
import { reportAssets, reportLink } from "../sales/report.public.js";
import crypto from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { addEvent } from "../growth/lib/events.js";
import { mailConfig, sendMail } from "../growth/lib/mail.js";
import { getAll, getOne, put } from "../growth/lib/redis.js";
import { hashToken } from "../sales/sales.service.js";
import { AuditConflictError, AuditService } from "./audit.service.js";
import { CATEGORIES } from "./audit.types.js";
import { categoryPlain, gradeOf, opportunityPlain } from "./plain-language.js";
import { assertPublicUrl, normalizeWebsite } from "./safe-fetch.js";

// Ücretsiz dijital analiz (herkese açık form). Web sitesi ve Instagram trafiğinden gelen talep:
// firma kaydı (leads) oluşturur ya da aynı alan adındaki kaydı günceller, Growth Audit başlatır ve
// oturumsuz sorgulama için tahmin edilemez bir belirteç döner. Satış puanı, notlar vb. asla dönmez.

export type Locale = "tr" | "en";
export interface PublicAuditInput {
  websiteUrl: string; name: string; email: string; phone: string; company: string; sector: string;
  instagram: string; message: string; source: "web" | "instagram"; locale: Locale;
}
export class PublicAuditError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

const MESSAGES: Record<string, Record<Locale, string>> = {
  invalid_url: { tr: "Geçerli bir web sitesi adresi girin.", en: "Please enter a valid website address." },
  unreachable_url: { tr: "Bu web sitesi adresi analiz edilemiyor.", en: "This website address cannot be analysed." },
  name_required: { tr: "Adınızı girin.", en: "Please enter your name." },
  contact_required: { tr: "E-posta veya telefon numaranızdan en az birini girin.", en: "Please provide an email address or phone number." },
  invalid_email: { tr: "E-posta adresi geçersiz.", en: "The email address is invalid." },
  invalid_phone: { tr: "Telefon numarası geçersiz.", en: "The phone number is invalid." },
  consent_required: { tr: "KVKK aydınlatma metnini onaylamanız gerekir.", en: "Please accept the privacy notice." },
  spam: { tr: "İstek reddedildi.", en: "Request rejected." },
};
export const publicMessage = (code: string, locale: Locale) => MESSAGES[code]?.[locale] ?? MESSAGES.spam[locale];

const s = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[a-z]{2,}$/i;

// Gövdeyi doğrular ve temizler. Saf fonksiyondur (ağ erişimi yok); URL'nin herkese açık olması ayrıca denetlenir.
// Proje strict modda derlenmediği için ayrışık birleşim daralmaz; tek arayüz kullanılır.
export interface ValidationResult { ok: boolean; data?: PublicAuditInput; code?: string; locale: Locale }
export function validatePublicAuditInput(body: any): ValidationResult {
  const b = body && typeof body === "object" ? body : {};
  const locale: Locale = b.locale === "en" ? "en" : "tr";
  const fail = (code: string): ValidationResult => ({ ok: false, code, locale });
  if (s(b.website_hp, 200)) return fail("spam"); // bal küpü: insanlar bu alanı görmez
  const url = normalizeWebsite(s(b.websiteUrl, 300));
  if (!url) return fail("invalid_url");
  // Yalnızca web sitesi adresi zorunludur; ad ve iletişim bilgileri isteğe bağlıdır (verilirse doğrulanır).
  const name = s(b.name, 100);
  const email = s(b.email, 120).toLowerCase(), phone = s(b.phone, 30);
  if (email && !EMAIL.test(email)) return fail("invalid_email");
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return fail("invalid_phone");
  if (b.consent !== true) return fail("consent_required");
  return {
    ok: true, locale,
    data: {
      websiteUrl: url.toString(), name, email, phone, company: s(b.company, 120), sector: s(b.sector, 120),
      instagram: s(b.instagram, 80).replace(/^@/, ""), message: String(b.message ?? "").replace(/\r/g, "").trim().slice(0, 1000),
      source: b.source === "instagram" ? "instagram" : "web", locale,
    },
  };
}

const TR: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
export const slug = (v: string) => String(v).toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => TR[c]).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
export const domainOf = (website: unknown) => normalizeWebsite(String(website || ""))?.hostname.toLowerCase().replace(/^www\./, "") || "";
// Rapor bağlantısı belirteci sorgu belirtecinden türetilir; böylece ham belirteç saklanmadan her sorguda yeniden üretilebilir.
export const reportTokenFor = (pollToken: string) => crypto.createHmac("sha256", pollToken).update("im-public-report").digest("base64url");
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const REPORT_DAYS = 90;
const REUSE_MS = 24 * 3_600_000; // aynı alan adı için 24 saat içindeki tamamlanmış denetim yeniden kullanılır

// Var olan firma kaydına gelen talebi ekler; ekibin girdiği dolu alanların üzerine yazmaz.
export function mergeInbound(cur: Record<string, any> | null, input: PublicAuditInput, domain: string, now = new Date()) {
  const at = now.toISOString();
  const entry = { at, source: input.source, name: input.name, email: input.email || null, phone: input.phone || null, message: input.message || null };
  const base = cur ?? { status: "yeni", source: "gelen", foundAt: at.slice(0, 10) };
  const fill = (k: string, v: string) => (base[k] ? base[k] : v || undefined);
  const next: Record<string, any> = {
    ...base,
    name: base.name || input.company || domain,
    website: base.website || input.websiteUrl,
    email: fill("email", input.email), phone: fill("phone", input.phone), sector: fill("sector", input.sector),
    instagram: fill("instagram", input.instagram), contactName: fill("contactName", input.name),
    inbound: true, inboundSource: input.source, inboundAt: at, inboundMessage: input.message || null, inboundLocale: input.locale,
    inboundHistory: [...(Array.isArray(base.inboundHistory) ? base.inboundHistory : []), entry].slice(-20),
  };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next;
}

@Injectable()
export class PublicAuditService {
  constructor(private readonly prisma: PrismaService, private readonly audits: AuditService) {}

  async findLeadByDomain(domain: string): Promise<{ id: string; lead: Record<string, any> } | null> {
    const leads = await getAll("leads");
    const hit = leads.find((l: any) => domainOf(l.website) === domain);
    if (!hit) return null;
    const { id, ...lead } = hit;
    return { id, lead };
  }

  async submit(input: PublicAuditInput, ip: string, opts: { notify?: boolean; createdBy?: string } = {}) {
    const url = new URL(input.websiteUrl);
    try { await assertPublicUrl(url); } catch { throw new PublicAuditError("unreachable_url", publicMessage("unreachable_url", input.locale)); }
    const domain = domainOf(input.websiteUrl);

    const existing = await this.findLeadByDomain(domain);
    let leadId = existing?.id;
    if (!leadId) {
      leadId = slug(input.company || domain.replace(/\./g, "-")) || "firma";
      if (await getOne("leads", leadId)) leadId = `${leadId.slice(0, 100)}-${crypto.randomBytes(3).toString("hex")}`;
    }
    await put("leads", leadId, mergeInbound(existing?.lead ?? null, input, domain));

    let auditId: string | undefined;
    if (existing) {
      const recent = await this.prisma.growthAudit.findFirst({
        where: { leadId, status: "completed", finishedAt: { gte: new Date(Date.now() - REUSE_MS) } }, orderBy: { finishedAt: "desc" }, select: { id: true },
      });
      auditId = recent?.id;
    }
    if (!auditId) try { auditId = (await this.audits.start(leadId, opts.createdBy || "public-form")).id; }
    catch (error) {
      if (error instanceof AuditConflictError && error.auditId) auditId = error.auditId; // aktif denetim varsa onu kullan
      else throw error;
    }

    const token = crypto.randomBytes(32).toString("base64url"); // 256 bit; yalnızca özeti saklanır
    await this.prisma.publicAuditRequest.create({
      data: { tokenHash: hashToken(token), leadId, auditId, source: input.source, locale: input.locale, ipHash: hashToken(`${process.env.SESSION_SECRET || ""}:${ip}`) },
    });
    // Instagram botu bildirim istemez (ekip Instagram'dan elle yanıtlar).
    if (opts.notify !== false) this.notify(leadId, input, !existing).catch(() => {}); // bildirim hatası isteği bozmaz
    return { token, leadId, auditId, isNew: !existing };
  }

  async notify(leadId: string, input: PublicAuditInput, isNew: boolean) {
    const src = input.source === "instagram" ? "Instagram" : "Web sitesi";
    const lines = [
      `${isNew ? "Yeni" : "Tekrar"} ücretsiz analiz talebi (${src})`,
      `Firma: ${input.company || domainOf(input.websiteUrl)}`, input.name && `Kişi: ${input.name}`,
      input.phone && `Telefon: ${input.phone}`, input.email && `E-posta: ${input.email}`, `Site: ${input.websiteUrl}`,
      input.message && `Not: ${input.message.slice(0, 300)}`,
    ].filter(Boolean).join("\n");
    await addEvent("inbound_audit", { id: leadId, name: input.company || domainOf(input.websiteUrl), text: lines, inReplyTo: undefined, references: undefined }).catch(() => {});
    const to = process.env.LEAD_NOTIFY_EMAIL;
    if (to && mailConfig().configured) await sendMail({ to, subject: `Gelen talep: ${input.company || domainOf(input.websiteUrl)} (${src})`, text: lines, inReplyTo: undefined, references: undefined }).catch(() => {});
  }

  // Oturumsuz sorgu: yalnızca müşteriye gösterilebilir alanlar döner.
  async poll(token: string, baseUrl: string) {
    if (!TOKEN.test(token)) return null;
    const req = await this.prisma.publicAuditRequest.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!req?.auditId) return null;
    const audit = await this.prisma.growthAudit.findUnique({
      where: { id: req.auditId },
      include: { opportunities: { where: { status: { notIn: ["done", "dismissed"] } }, orderBy: { priorityScore: "desc" }, take: 3 } },
    });
    if (!audit) return null;
    const locale = (req.locale === "en" ? "en" : "tr") as Locale;
    if (audit.status === "queued" || audit.status === "running") {
      return { status: "processing", progress: audit.progress ?? 0, stage: audit.stage || (locale === "en" ? "Queued" : "Sırada") };
    }
    if (audit.status === "no_verified_website") {
      return { status: "no_website", progress: 100, stage: null, message: locale === "en" ? "We could not verify this website. Our team will contact you." : "Web sitesi doğrulanamadı. Ekibimiz sizinle iletişime geçecek." };
    }
    if (audit.status !== "completed") {
      return { status: "failed", progress: 100, stage: null, message: locale === "en" ? "The analysis could not be completed. Our team will contact you." : "Analiz tamamlanamadı. Ekibimiz sizinle iletişime geçecek." };
    }

    const reportToken = reportTokenFor(token);
    if (!req.reportId) {
      const link = await this.prisma.auditReport.create({
        data: { auditId: audit.id, leadId: audit.leadId, tokenHash: hashToken(reportToken), tokenHint: reportToken.slice(0, 6), createdBy: "public-form", expiresAt: new Date(Date.now() + REPORT_DAYS * 86_400_000) },
      });
      await this.prisma.publicAuditRequest.update({ where: { id: req.id }, data: { reportId: link.id } });
    }
    const summary = audit.summary as { headline?: string; narrative?: string } | null;
    const names = new Map(CATEGORIES.map((c) => [c.id, c.name]));
    return {
      status: "completed", progress: 100, stage: null,
      result: {
        overallScore: audit.overallScore == null ? null : Math.round(Number(audit.overallScore)),
        grade: gradeOf(audit.overallScore == null ? null : Number(audit.overallScore), locale),
        categories: ((audit.categoryScores as any[]) || []).map((c) => ({ key: c.id, label: locale === "tr" ? categoryPlain(c.id, c.name || names.get(c.id)) : c.name || names.get(c.id) || c.id, score: c.score == null ? null : Math.round(Number(c.score)) })),
        summary: summary?.headline ? [summary.headline, summary.narrative].filter(Boolean).join("\n\n") : null,
        topOpportunities: audit.opportunities.map((o) => {
          const p = locale === "tr" ? opportunityPlain(o) : { title: o.title, why: o.problem };
          return { title: p.title, why: p.why, recommendedService: o.service };
        }),
        reportUrl: reportLink(reportToken, baseUrl),
        ...reportAssets(reportToken, baseUrl),
      },
    };
  }
}
