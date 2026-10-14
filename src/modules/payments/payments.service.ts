import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { log } from "../../infrastructure/http/http-hardening.js";
import { paymentProvider, PaymentProvider } from "./providers.js";

export class PayNotFound extends Error {}
export class PayConflict extends Error {}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const PAYABLE = ["planned", "invoiced"];

export function bankInfo(env = process.env) {
  return env.BANK_IBAN ? { bank: env.BANK_NAME || null, accountName: env.BANK_ACCOUNT_NAME || null, iban: env.BANK_IBAN } : null;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  provider(): PaymentProvider | null { return paymentProvider(); }
  config() { const p = this.provider(); return { configured: !!p, provider: p?.name ?? null, test: p?.test ?? false, bank: bankInfo() }; }

  private async payment(paymentId: string) {
    if (!UUID.test(paymentId)) throw new PayNotFound("Ödeme bulunamadı");
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { customer: true, contract: { select: { title: true } } } });
    if (!p) throw new PayNotFound("Ödeme bulunamadı");
    return p;
  }

  // ---------- Ödeme linkleri (yönetim paneli) ----------
  async createLink(paymentId: string, days: number, createdBy: string | null) {
    const p = await this.payment(paymentId);
    if (!PAYABLE.includes(p.status)) throw new PayConflict("Yalnızca planlanan veya faturalanan ödemeler için link oluşturulur");
    const token = crypto.randomBytes(32).toString("base64url");
    const link = await this.prisma.paymentLink.create({ data: { paymentId, tokenHash: sha256(token), tokenHint: token.slice(0, 6), createdBy, expiresAt: new Date(Date.now() + Math.max(1, Math.min(60, Math.round(days) || 14)) * 86_400_000) } });
    await this.activity(p.customerId, `${this.amountText(p)} için ödeme linki oluşturuldu (…${link.tokenHint})`);
    return { id: link.id, token, expiresAt: link.expiresAt };
  }

  async links(paymentId: string) {
    await this.payment(paymentId);
    const now = Date.now();
    return (await this.prisma.paymentLink.findMany({ where: { paymentId }, orderBy: { createdAt: "desc" } }))
      .map(({ tokenHash, ...l }) => ({ ...l, state: l.revokedAt ? "revoked" : l.expiresAt.getTime() <= now ? "expired" : "active" }));
  }

  async revoke(linkId: string) {
    const r = await this.prisma.paymentLink.updateMany({ where: { id: linkId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new PayNotFound("Link bulunamadı");
    return { ok: true };
  }

  // Müşteriye açık link: geçersiz/süresi dolmuş/iptal edilmiş linkler ayırt edilmeden aynı yanıtı alır.
  async linkInfo(token: string) {
    if (!TOKEN.test(token)) return null;
    const link = await this.prisma.paymentLink.findUnique({ where: { tokenHash: sha256(token) }, include: { payment: { include: { customer: true, contract: { select: { title: true } } } } } });
    if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return null;
    return link;
  }

  async startFromLink(token: string, ip: string, callbackBase: string) {
    const link = await this.linkInfo(token);
    if (!link) throw new PayNotFound("Ödeme linki geçersiz veya süresi dolmuş");
    if (link.payment.status === "paid") throw new PayConflict("Bu ödeme zaten yapılmış. Teşekkür ederiz.");
    if (!PAYABLE.includes(link.payment.status)) throw new PayConflict("Bu ödeme artık geçerli değil");
    await this.prisma.paymentLink.update({ where: { id: link.id }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date() } });
    return this.checkout(link.payment, "link", ip, callbackBase);
  }

  // ---------- Portal ----------
  async billing(customerId: string | null) {
    if (!customerId) return { linked: false, payments: [], contracts: [], ...this.config() };
    const [payments, contracts] = await Promise.all([
      this.prisma.payment.findMany({ where: { customerId, status: { not: "cancelled" } }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], include: { contract: { select: { title: true } } } }),
      this.prisma.contract.findMany({ where: { customerId, status: { in: ["signed", "active", "completed"] } }, orderBy: { createdAt: "desc" } }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return {
      linked: true, ...this.config(),
      payments: payments.map((p) => ({ id: p.id, amount: Number(p.amount), currency: p.currency, status: p.status, dueDate: p.dueDate, paidAt: p.paidAt, invoiceNo: p.invoiceNo, contract: p.contract?.title ?? null,
        overdue: PAYABLE.includes(p.status) && !!p.dueDate && p.dueDate.toISOString().slice(0, 10) < today })),
      contracts: contracts.map((c) => ({ id: c.id, title: c.title, services: c.services, value: Number(c.value), monthlyValue: Number(c.monthlyValue), currency: c.currency, billing: c.billing, status: c.status, startDate: c.startDate, endDate: c.endDate, signedAt: c.signedAt })),
    };
  }

  async startFromPortal(customerId: string | null, paymentId: string, ip: string, callbackBase: string) {
    const p = await this.payment(paymentId);
    if (!customerId || p.customerId !== customerId) throw new PayNotFound("Ödeme bulunamadı"); // kiracı yalıtımı
    if (p.status === "paid") throw new PayConflict("Bu ödeme zaten yapılmış");
    if (!PAYABLE.includes(p.status)) throw new PayConflict("Bu ödeme artık geçerli değil");
    return this.checkout(p, "portal", ip, callbackBase);
  }

  // ---------- Ödeme akışı ----------
  private async checkout(p: any, source: "link" | "portal", ip: string, callbackBase: string) {
    const provider = this.provider();
    if (!provider) throw new PayConflict("Kartla ödeme şu an kullanılamıyor; lütfen havale/EFT ile ödeyin");
    const conversationId = crypto.randomUUID();
    const amount = Number(p.amount);
    const tx = await this.prisma.paymentTransaction.create({ data: { paymentId: p.id, provider: provider.name, conversationId, source, amount, currency: p.currency } });
    try {
      const r = await provider.init({
        conversationId, amount, currency: p.currency, callbackUrl: `${callbackBase}/api/payments/callback`,
        description: p.contract?.title ? `${p.contract.title}${p.invoiceNo ? ` · Fatura ${p.invoiceNo}` : ""}` : `Istanbul Marketing hizmet bedeli${p.invoiceNo ? ` · Fatura ${p.invoiceNo}` : ""}`,
        buyer: { id: p.customer.id, name: p.customer.contactName || p.customer.name, email: p.customer.email, phone: p.customer.phone, ip },
      });
      await this.prisma.paymentTransaction.update({ where: { id: tx.id }, data: { checkoutToken: r.token, updatedAt: new Date() } });
      return { url: r.url, test: provider.test };
    } catch (e: any) {
      await this.prisma.paymentTransaction.update({ where: { id: tx.id }, data: { status: "failure", error: String(e.message).slice(0, 500), updatedAt: new Date() } });
      throw e;
    }
  }

  // Sağlayıcı dönüşü: yalnızca belirteç kabul edilir; sonuç sağlayıcıdan sorulur, tutar ve para birimi karşılaştırılır.
  // Aynı dönüş birden çok kez gelirse (yenileme, çift tıklama) sonuç bir kez işlenir.
  async complete(token: string) {
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(token)) throw new PayNotFound("Geçersiz ödeme dönüşü");
    const tx = await this.prisma.paymentTransaction.findUnique({ where: { checkoutToken: token }, include: { payment: true } });
    if (!tx) throw new PayNotFound("Ödeme işlemi bulunamadı");
    const result = { source: tx.source as "link" | "portal", paymentId: tx.paymentId, status: tx.status };
    if (tx.status !== "initialized") return result;
    const provider = this.provider();
    if (!provider || provider.name !== tx.provider) throw new PayConflict("Ödeme sağlayıcısı yapılandırması değişti");
    const r = await provider.retrieve(token);
    const amountOk = r.paidPrice != null && r.paidPrice + 0.001 >= Number(tx.amount) && (!r.currency || r.currency === tx.currency) && r.conversationId === tx.conversationId;
    const success = r.ok && r.status === "success" && amountOk;
    if (r.ok && r.status === "success" && !amountOk) log("error", "payment_mismatch", { tx: tx.id, paid: r.paidPrice, expected: Number(tx.amount), currency: r.currency });
    const updated = await this.prisma.paymentTransaction.updateMany({
      where: { id: tx.id, status: "initialized" },
      data: { status: success ? "success" : "failure", paidPrice: r.paidPrice, installment: r.installment, providerPaymentId: r.providerPaymentId, error: success ? null : (r.error || "Tutar doğrulanamadı").slice(0, 500), updatedAt: new Date() },
    });
    if (updated.count && success) {
      await this.prisma.payment.update({ where: { id: tx.paymentId }, data: { status: "paid", paidAt: new Date(), updatedAt: new Date() } });
      await this.activity(tx.payment.customerId, `${Number(tx.amount).toLocaleString("tr-TR")} ${tx.currency} kartla ödendi (${provider.name}${provider.test ? " TEST" : ""}, işlem ${r.providerPaymentId}${r.installment && r.installment > 1 ? `, ${r.installment} taksit` : ""})`);
    }
    return { ...result, status: success ? "success" : "failure" };
  }

  private amountText(p: { amount: unknown; currency: string }) { return `${Number(p.amount).toLocaleString("tr-TR")} ${p.currency}`; }
  private async activity(customerId: string, summary: string) {
    await this.prisma.activity.create({ data: { customerId, type: "payment", summary, createdBy: "sistem" } }).catch(() => {});
  }
}
