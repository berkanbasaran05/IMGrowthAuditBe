import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

// Yapılandırılmış (JSON şemalı) Claude çağrısı. Tüm AI özellikleri (denetim analisti, e-posta taslağı,
// arama brifi) bu yardımcıyı kullanır: şema kısıtı + zod doğrulaması, ret/kesilme yönetimi, maliyet kaydı.

export const AI_MODEL = process.env.AUDIT_AI_MODEL || "claude-opus-5-5";
const PRICE = { input: Number(process.env.AUDIT_AI_PRICE_IN || 4), output: Number(process.env.AUDIT_AI_PRICE_OUT || 20) }; // USD / 1M token

export const aiConfigured = () => process.env.AUDIT_AI_DISABLED !== "1" && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export interface AiUsage { inputTokens: number; outputTokens: number; costUsd: number; model: string }
// Proje strict modda derlenmediği için ayrışık birleşim (discriminated union) daralmaz; tek arayüz kullanılır.
export interface AiResult<T> { ok: boolean; data?: T; reason?: string; code?: string; usage: AiUsage | null }

export class RetryableAiError extends Error { readonly retryable = true; }

export async function structuredCall<T>(req: {
  system: string; user: string; schema: Record<string, unknown>; validator: z.ZodType<T>;
  effort?: "low" | "medium" | "high"; maxTokens?: number; signal?: AbortSignal;
}): Promise<AiResult<T>> {
  const client = new Anthropic({ timeout: 180_000, maxRetries: 2 });
  try {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: req.maxTokens ?? 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: req.schema } },
      messages: [{ role: "user", content: req.user }],
    }, { signal: req.signal });
    const usage: AiUsage = {
      inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model,
      costUsd: Math.round(((response.usage.input_tokens * PRICE.input + response.usage.output_tokens * PRICE.output) / 1_000_000) * 10_000) / 10_000,
    };
    if (response.stop_reason === "refusal") return { ok: false, code: "refusal", reason: "AI isteği reddetti", usage };
    if (response.stop_reason === "max_tokens") return { ok: false, code: "max_tokens", reason: "AI yanıtı yarıda kesildi", usage };
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { ok: false, code: "json", reason: "AI çıktısı geçerli JSON değil", usage }; }
    const parsed = req.validator.safeParse(json);
    if (!parsed.success) return { ok: false, code: "schema", reason: "AI çıktısı şema doğrulamasından geçmedi", usage };
    return { ok: true, data: parsed.data, usage };
  } catch (error: any) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, code: "auth", reason: "AI anahtarı geçersiz", usage: null };
    if (error instanceof Anthropic.RateLimitError) throw new RetryableAiError("AI hız sınırına takıldı");
    if (error instanceof Anthropic.APIConnectionError || (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500)) throw new RetryableAiError("AI servisine ulaşılamadı");
    throw error;
  }
}

// Satış metinlerinde kullanılmayacak doğrulanamaz veya agresif iddialar.
export const BANNED_CLAIMS: RegExp[] = [
  /garanti/i, /%\s?100/, /yüzde ?yüz/i, /kesin(likle)? (sonuç|artış|satış)/i, /\b\d+ ?(kat|x) (artış|büyüme)/i,
  /(gelir|ciro|müşteri|para) kaybediyorsunuz/i, /kaybettiğiniz (gelir|ciro|müşteri)/i, /sektör ortalaması/i, /rakipleriniz(in)? (sizi|önünde)/i,
  /1 numara/i, /lider/i, /acil(en)?!/i, /son fırsat/i, /kaçırmayın/i, /hemen şimdi/i,
];
export const findBannedClaim = (text: string) => BANNED_CLAIMS.map((re) => text.match(re)?.[0]).find(Boolean) || null;
