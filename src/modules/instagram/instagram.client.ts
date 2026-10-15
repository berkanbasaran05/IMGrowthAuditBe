import { igConfig, type IgConfig } from "./instagram.logic.js";

// graph.instagram.com istemcisi (Instagram API with Instagram Login). Belirteç Authorization başlığında gönderilir,
// asla günlüğe yazılmaz. fetch testlerde değiştirilebilir.

export type Fetcher = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export interface TokenStore { get(): Promise<string | null>; set(token: string, expiresInSec: number): Promise<void> }

export class IgClient {
  constructor(readonly cfg: IgConfig, private readonly tokens: TokenStore | null = null, private readonly fetcher: Fetcher = fetch as any) {}

  static fromEnv(tokens: TokenStore | null = null, fetcher?: Fetcher) {
    const cfg = igConfig();
    return cfg ? new IgClient(cfg, tokens, fetcher) : null;
  }

  private base() { return `https://graph.instagram.com/${this.cfg.version}`; }
  async token() { return (await this.tokens?.get().catch(() => null)) || this.cfg.accessToken; }

  private async post(path: string, body: object, what: string) {
    const res = await this.fetcher(`${this.base()}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(`${what} başarısız (${res.status}${errDetail(b)})`);
    }
    return res.json().catch(() => ({}));
  }
  private async get(path: string, what: string) {
    const res = await this.fetcher(`${this.base()}/${path}`, { headers: { Authorization: `Bearer ${await this.token()}` }, signal: AbortSignal.timeout(15_000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${what} başarısız (${res.status}${errDetail(j)})`);
    return j;
  }
  private msgPath() { return `${encodeURIComponent(this.cfg.accountId)}/messages`; }

  // Herhangi bir mesaj nesnesi (metin, şablon). Hızlı yanıtlar message.quick_replies içinde.
  sendMessage(igsid: string, message: object) {
    return this.post(this.msgPath(), { recipient: { id: igsid }, message }, "Instagram gönderimi");
  }

  send(igsid: string, text: string, quickReplies?: object[]) {
    const message: any = { text };
    if (quickReplies?.length) message.quick_replies = quickReplies;
    return this.sendMessage(igsid, message);
  }

  // Yorumdan özel yanıt (private reply): alıcı comment_id. Kullanıcı yanıtlayana kadar yalnızca 1 mesaj; yorumdan itibaren 7 gün.
  // Belgede yalnızca message.text tanımlı; hızlı yanıt/şablon desteklenmediği için düz metin gönderilir.
  privateReply(commentId: string, text: string) {
    return this.post(this.msgPath(), { recipient: { comment_id: commentId }, message: { text } }, "Yorum özel yanıtı");
  }
  // Yorumun altına herkese açık yanıt.
  replyComment(commentId: string, message: string) {
    return this.post(`${encodeURIComponent(commentId)}/replies`, { message }, "Yorum yanıtı");
  }

  // typing_on / typing_off / mark_seen. En iyi çaba: hata yutulur.
  async action(igsid: string, action: "typing_on" | "typing_off" | "mark_seen") {
    try { await this.post(this.msgPath(), { recipient: { id: igsid }, sender_action: action }, "Gönderen eylemi"); return true; }
    catch { return false; }
  }

  // Buzkıranlar (ice breakers): /me/messenger_profile, platform=instagram. En fazla 4 soru.
  setIceBreakers(items: { question: string; payload: string }[]) {
    return this.post("me/messenger_profile", { platform: "instagram", ice_breakers: [{ call_to_actions: items.slice(0, 4), locale: "default" }] }, "Buzkıran ayarı");
  }
  async getIceBreakers(): Promise<any> {
    const res = await this.fetcher(`${this.base()}/me/messenger_profile?fields=ice_breakers&platform=instagram`, { headers: { Authorization: `Bearer ${await this.token()}` }, signal: AbortSignal.timeout(15_000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Buzkıranlar okunamadı (${res.status}${j?.error?.code ? `, kod ${j.error.code}` : ""})`);
    return j;
  }

  // En iyi çaba: kullanıcı adı alınamazsa null.
  async profile(igsid: string): Promise<{ username?: string; name?: string } | null> {
    try {
      const res = await this.fetcher(`${this.base()}/${encodeURIComponent(igsid)}?fields=username,name`, { headers: { Authorization: `Bearer ${await this.token()}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const j = await res.json();
      return { username: typeof j?.username === "string" ? j.username.slice(0, 80) : undefined, name: typeof j?.name === "string" ? j.name.slice(0, 100) : undefined };
    } catch { return null; }
  }

  // İçerik yayınlama (izin: instagram_business_content_publish). Hikâye: önce kapsayıcı (media_type=STORIES, image_url
  // herkese açık JPEG olmalı; Meta adresi kendisi indirir), durum FINISHED olunca media_publish.
  async createStoryContainer(imageUrl: string): Promise<string> {
    const j = await this.post(`${encodeURIComponent(this.cfg.accountId)}/media`, { image_url: imageUrl, media_type: "STORIES" }, "Hikâye kapsayıcısı");
    if (typeof j?.id !== "string" && typeof j?.id !== "number") throw new Error("Hikâye kapsayıcısı kimliği dönmedi");
    return String(j.id);
  }
  // EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED
  async containerStatus(containerId: string): Promise<{ code: string; status?: string }> {
    const j = await this.get(`${encodeURIComponent(containerId)}?fields=status_code,status`, "Kapsayıcı durumu");
    return { code: String(j?.status_code || ""), status: typeof j?.status === "string" ? j.status.slice(0, 200) : undefined };
  }
  async publishMedia(creationId: string): Promise<string> {
    const j = await this.post(`${encodeURIComponent(this.cfg.accountId)}/media_publish`, { creation_id: creationId }, "Yayınlama");
    if (typeof j?.id !== "string" && typeof j?.id !== "number") throw new Error("Yayınlanan medya kimliği dönmedi");
    return String(j.id);
  }

  // Uzun ömürlü belirteci yeniler (en az 24 saatlik ve süresi dolmamış olmalı). Yeni belirteç depoya yazılır.
  async refresh(): Promise<number> {
    const current = await this.token();
    const res = await this.fetcher(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`, { signal: AbortSignal.timeout(15_000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || typeof j?.access_token !== "string") throw new Error(`Belirteç yenilenemedi (${res.status})`);
    const expires = Number(j.expires_in) || 60 * 86_400;
    if (this.tokens) await this.tokens.set(j.access_token, expires);
    return expires;
  }
}

// Meta hata ayrıntısı: kod, alt kod ve kısa mesaj (belirteç içermez; yine de token benzeri değerler ayıklanır).
function errDetail(b: any) {
  const e = b?.error;
  if (!e) return "";
  const msg = typeof (e.error_user_msg || e.message) === "string" ? String(e.error_user_msg || e.message).replace(/[A-Za-z0-9_-]{40,}/g, "***").slice(0, 160) : "";
  return `${e.code ? `, kod ${e.code}` : ""}${e.error_subcode ? `/${e.error_subcode}` : ""}${msg ? `: ${msg}` : ""}`;
}
