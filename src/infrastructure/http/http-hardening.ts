import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// HTTP katmanı sağlamlaştırma: istek kimliği + yapılandırılmış erişim günlüğü (gizli değerler maskelenir),
// güvenlik başlıkları, çerez oturumlu yazma isteklerinde Origin denetimi (CSRF), yakalanmayan hatalar için filtre.

// Günlüklere düşmemesi gereken değerler: rapor belirteci, davet/OAuth parametreleri, görsel imzası.
export function redactUrl(url: string): string {
  return url
    .replace(/^\/r\/[A-Za-z0-9_-]+/, "/r/[gizli]")
    .replace(/([?&](?:token|code|state|s|k|key|password)=)[^&]*/gi, "$1[gizli]");
}

// Kullanıcıya gösterilecek hata mesajı: bilinçli (doğrulama) mesajlar aynen, veritabanı/çalışma zamanı hataları genel mesajla.
const INTERNAL = /prisma|invalid `|ECONN|ETIMEDOUT|relation ".*" does not exist|syntax error|duplicate key|violates|TypeError|ReferenceError|Cannot read prop/i;
export function publicMessage(error: unknown, fallback = "İşlem tamamlanamadı"): string {
  const e = error as { message?: string; name?: string; code?: unknown } | undefined;
  const msg = String(e?.message || "");
  if (!msg || INTERNAL.test(msg) || /^Prisma/.test(String(e?.name || "")) || (typeof e?.code === "string" && /^(P\d{4}|\d{5}|E[A-Z]+)$/.test(e.code))) {
    if (msg) log("error", "internal_error", { error: msg.slice(0, 500), name: e?.name, code: e?.code as string | undefined });
    return `${fallback}. Sorun sürerse yöneticinize bildirin.`;
  }
  return msg.slice(0, 300);
}

export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export function requestContext(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const incoming = String(req.headers["x-request-id"] || "");
  req.id = /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (req.path === "/api/health" && res.statusCode < 400) return; // sağlık yoklamaları günlüğü doldurmasın
    log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "http", {
      id: req.id, method: req.method, path: redactUrl(req.originalUrl || req.url), status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n), ip: req.ip,
    });
  });
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (!res.getHeader("X-Frame-Options")) res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

const SESSION_COOKIES = /(?:^|;\s*)(im_session|im_portal)=/;
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Çerezle kimliği doğrulanmış yazma istekleri yalnızca aynı kökenden kabul edilir. Origin yoksa Referer'a bakılır;
// ikisi de yoksa (eski tarayıcı veya sunucudan sunucuya istek) istek geçer, SameSite=Lax çerez koruması devam eder.
export function sameOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (!UNSAFE.has(req.method) || !SESSION_COOKIES.test(req.headers.cookie || "")) return next();
  const source = String(req.headers.origin || req.headers.referer || "");
  if (!source) return next();
  let originHost = "";
  try { originHost = new URL(source).host; } catch { log("warn", "csrf_bad_origin", { origin: String(req.headers.origin || "").slice(0, 60), path: redactUrl(req.originalUrl || req.url) }); return res.status(403).json({ error: "Geçersiz istek kaynağı" }); }
  const hosts = [req.headers["x-forwarded-host"], req.headers.host].flatMap((h) => String(h || "").split(",")).map((h) => h.trim()).filter(Boolean);
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => { try { return new URL(o).host; } catch { return o; } });
  if (hosts.includes(originHost) || allowed.includes(originHost)) return next();
  log("warn", "csrf_blocked", { method: req.method, path: redactUrl(req.originalUrl || req.url), origin: originHost });
  return res.status(403).json({ error: "İstek kaynağı doğrulanamadı" });
}

// Yakalanmayan hatalar: ayrıntı günlüğe, kullanıcıya genel mesaj + istek kimliği.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp(), req = ctx.getRequest<Request & { id?: string }>(), res = ctx.getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) log("error", "http_exception", { id: req.id, path: redactUrl(req.originalUrl || ""), error: exception.message });
      if (!res.headersSent) res.status(status).json({ error: status === 404 ? "Bulunamadı" : exception.message, requestId: req.id });
      return;
    }
    const err = exception as Error;
    log("error", "unhandled", { id: req.id, path: redactUrl(req.originalUrl || ""), error: err?.message, stack: err?.stack?.split("\n").slice(0, 6).join(" | ") });
    if (!res.headersSent) res.status(500).json({ error: "Beklenmeyen bir hata oluştu. Sorun sürerse bu kodu iletin.", requestId: req.id });
  }
}
