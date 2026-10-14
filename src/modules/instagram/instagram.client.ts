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
      throw new Error(`${what} başarısız (${res.status}${b?.error?.code ? `, kod ${b.error.code}` : ""})`);
    }
    return res.json().catch(() => ({}));
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

  // typing_on / typing_off / mark_seen. En iyi çaba: hata yutulur.
  async action(igsid: string, action: "typing_on" | "typing_off" | "mark_seen") {
    try { await this.post(this.msgPath(), { recipient: { id: igsid }, sender_action: action }, "Gönderen eylemi"); return true; }
    catch { return false; }
  }

  // Buzkıranlar (ice breakers): /me/messenger_profile, platform=instagram. En fazla 4 soru.
  setIceBreakers(items: { question: string; payload: string }[]) {
    return this.post("me/messenger_profile", { platform: "instagram", ice_breakers: [{ call_to_actions: items.slice(0, 4) }] }, "Buzkıran ayarı");
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
