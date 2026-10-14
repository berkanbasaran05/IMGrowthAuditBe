import crypto from "node:crypto";

// Ödeme sağlayıcıları. Kart bilgisi hiçbir zaman bu sisteme gelmez: müşteri sağlayıcının güvenli ödeme
// sayfasında öder. Sonuç, tarayıcıdan gelen veriye güvenilmeden sağlayıcıya sunucudan sorularak alınır ve
// iyzico'nun yanıt imzası doğrulanır.

export interface CheckoutParams {
  conversationId: string;
  amount: number;
  currency: string;
  description: string;
  callbackUrl: string;
  buyer: { id: string; name: string; email: string | null; phone: string | null; ip: string };
}
export interface CheckoutResult { token: string; url: string }
export interface RetrieveResult {
  ok: boolean; status: "success" | "failure"; conversationId: string; paidPrice: number | null; price: number | null;
  currency: string | null; providerPaymentId: string | null; installment: number | null; error: string | null;
}
export interface PaymentProvider { name: "iyzico" | "mock"; test: boolean; init(p: CheckoutParams): Promise<CheckoutResult>; retrieve(token: string): Promise<RetrieveResult> }

const money2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? { name: parts.slice(0, -1).join(" ").slice(0, 60), surname: parts[parts.length - 1].slice(0, 60) } : { name: (parts[0] || "Müşteri").slice(0, 60), surname: "-" };
};

// iyzico yanıt imzası: alanların ":" ile birleştirilmiş hâlinin gizli anahtarla HMAC-SHA256 (hex) özeti.
export function iyzicoSignature(fields: (string | number | null | undefined)[], secret: string) {
  return crypto.createHmac("sha256", secret).update(fields.map((f) => (f == null ? "" : String(f))).join(":")).digest("hex");
}
export function signatureValid(given: unknown, fields: (string | number | null | undefined)[], secret: string) {
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/i.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given.toLowerCase(), "hex"), Buffer.from(iyzicoSignature(fields, secret), "hex"));
}

export function iyzicoRequest(p: CheckoutParams, cfg: { identityNumber: string; installments: number[] }) {
  const { name, surname } = splitName(p.buyer.name);
  const address = { contactName: p.buyer.name.slice(0, 100) || "Müşteri", city: "Istanbul", country: "Turkey", address: "Belirtilmedi" };
  return {
    locale: "tr", conversationId: p.conversationId, price: money2(p.amount), paidPrice: money2(p.amount), currency: p.currency,
    basketId: p.conversationId, paymentGroup: "PRODUCT", callbackUrl: p.callbackUrl, enabledInstallments: cfg.installments,
    buyer: {
      id: p.buyer.id.slice(0, 60), name, surname, gsmNumber: p.buyer.phone || undefined, email: p.buyer.email || "musteri@istanbul.marketing",
      identityNumber: cfg.identityNumber, registrationAddress: "Belirtilmedi", ip: p.buyer.ip || "85.34.78.112", city: "Istanbul", country: "Turkey",
    },
    shippingAddress: address, billingAddress: address,
    basketItems: [{ id: p.conversationId.slice(0, 32), name: p.description.slice(0, 120) || "Hizmet bedeli", category1: "Dijital pazarlama hizmeti", itemType: "VIRTUAL", price: money2(p.amount) }],
  };
}

export function iyzicoProvider(env = process.env): PaymentProvider {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Iyzipay = require("iyzipay");
  const secret = env.IYZICO_SECRET_KEY!;
  const client = new Iyzipay({ apiKey: env.IYZICO_API_KEY, secretKey: secret, uri: env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com" });
  const call = <T>(fn: (cb: (err: unknown, res: T) => void) => void) => new Promise<T>((ok, no) => fn((err, res) => (err ? no(err) : ok(res))));
  const cfg = {
    identityNumber: env.IYZICO_DEFAULT_IDENTITY || "11111111111",
    installments: (env.IYZICO_INSTALLMENTS || "1,2,3,6").split(",").map(Number).filter((n) => [1, 2, 3, 6, 9, 12].includes(n)),
  };
  return {
    name: "iyzico", test: /sandbox/.test(env.IYZICO_BASE_URL || "sandbox"),
    async init(p) {
      const res: any = await call((cb) => client.checkoutFormInitialize.create(iyzicoRequest(p, cfg), cb));
      if (res?.status !== "success" || !res.token || !res.paymentPageUrl) throw new Error(`Ödeme sayfası açılamadı: ${res?.errorMessage || "bilinmeyen hata"}`);
      if (res.signature && !signatureValid(res.signature, [res.conversationId, res.token], secret)) throw new Error("iyzico yanıt imzası doğrulanamadı");
      return { token: res.token, url: res.paymentPageUrl };
    },
    async retrieve(token) {
      const res: any = await call((cb) => client.checkoutForm.retrieve({ locale: "tr", token }, cb));
      if (res?.status !== "success") return { ok: false, status: "failure", conversationId: res?.conversationId || "", paidPrice: null, price: null, currency: null, providerPaymentId: null, installment: null, error: res?.errorMessage || "Ödeme sonucu alınamadı" };
      const fields = [res.paymentStatus, res.paymentId, res.currency, res.basketId, res.conversationId, res.paidPrice, res.price, res.token];
      if (!signatureValid(res.signature, fields, secret)) return { ok: false, status: "failure", conversationId: res.conversationId || "", paidPrice: null, price: null, currency: null, providerPaymentId: null, installment: null, error: "iyzico yanıt imzası doğrulanamadı" };
      const success = res.paymentStatus === "SUCCESS";
      return {
        ok: true, status: success ? "success" : "failure", conversationId: res.conversationId, paidPrice: Number(res.paidPrice) || null, price: Number(res.price) || null,
        currency: res.currency || null, providerPaymentId: res.paymentId ? String(res.paymentId) : null, installment: Number(res.installment) || null,
        error: success ? null : res.errorMessage || "Ödeme tamamlanmadı",
      };
    },
  };
}

// Yerel test sağlayıcısı: gerçek para hareketi yoktur, üretimde kullanılamaz (yapılandırma doğrulaması engeller).
const mockStore = new Map<string, { conversationId: string; amount: number; currency: string; result?: "success" | "failure" }>();
export function mockProvider(): PaymentProvider {
  return {
    name: "mock", test: true,
    async init(p) {
      const token = crypto.randomBytes(16).toString("hex");
      mockStore.set(token, { conversationId: p.conversationId, amount: p.amount, currency: p.currency });
      return { token, url: `/api/payments/mock/${token}` };
    },
    async retrieve(token) {
      const m = mockStore.get(token);
      if (!m?.result) return { ok: false, status: "failure", conversationId: m?.conversationId || "", paidPrice: null, price: null, currency: null, providerPaymentId: null, installment: null, error: "Test ödemesi bulunamadı" };
      return { ok: true, status: m.result, conversationId: m.conversationId, paidPrice: m.result === "success" ? m.amount : null, price: m.amount, currency: m.currency, providerPaymentId: m.result === "success" ? `TEST-${token.slice(0, 8)}` : null, installment: 1, error: m.result === "success" ? null : "Test: kart reddedildi" };
    },
  };
}
export const mockDecide = (token: string, result: "success" | "failure") => { const m = mockStore.get(token); if (!m) return null; m.result = result; return m; };

export function paymentProvider(env = process.env): PaymentProvider | null {
  const kind = env.PAYMENT_PROVIDER || (env.IYZICO_API_KEY && env.IYZICO_SECRET_KEY ? "iyzico" : "");
  if (kind === "iyzico" && env.IYZICO_API_KEY && env.IYZICO_SECRET_KEY) return iyzicoProvider(env);
  if (kind === "mock" && env.NODE_ENV !== "production") return mockProvider();
  return null;
}
