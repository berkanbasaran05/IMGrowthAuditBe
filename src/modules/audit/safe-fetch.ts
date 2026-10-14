import { lookup } from "node:dns/promises";
import net from "node:net";

// Taranan web siteleri dış ve güvenilmeyen kaynaktır. Bu modül SSRF'e karşı:
//  - yalnızca http/https ve 80/443 portlarına izin verir,
//  - DNS çözümlemesini yapıp özel/yerel/ayrılmış adresleri reddeder,
//  - yönlendirmeleri elle izler ve her adımda aynı kontrolü tekrarlar,
//  - yanıt boyutunu ve süresini sınırlar.
// Not: DNS çözümü ile bağlantı arasında küçük bir yeniden bağlama (DNS rebinding) penceresi kalır; üretimde çıkış
// trafiği ayrıca ağ katmanında (egress firewall, bulut meta veri servisine erişimin kapatılması) kısıtlanmalıdır.

export const USER_AGENT = "IMGrowthAuditBot/1.0 (+https://istanbul.marketing; denetim botu)";
export const ROBOTS_AGENT = "imgrowthauditbot";

export class FetchBlockedError extends Error {}

// Engellenen adres aralıkları. net.BlockList IPv6'nın tüm yazımlarını (ör. ::ffff:7f00:1) normalize eder.
// IPv4 gömülü IPv6 biçimleri (eşlenmiş, uyumlu, NAT64, 6to4, Teredo) tümüyle engellenir: içlerindeki IPv4
// adresi özel ağı gösterebilir ve meşru web siteleri bu biçimleri DNS'te kullanmaz.
// İki ayrı liste: tek listede IPv4 adresleri IPv6 kurallarıyla (::/96) da eşleşip yanlışlıkla engellenirdi.
const BLOCKED_V4 = new net.BlockList(), BLOCKED_V6 = new net.BlockList();
for (const [base, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_V4.addSubnet(base, bits, "ipv4");
for (const [base, bits] of [
  ["::", 96], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(base, bits, "ipv6");

export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(addr)) return BLOCKED_V4.check(addr, "ipv4");
  if (net.isIPv6(addr)) return BLOCKED_V6.check(addr, "ipv6");
  return true;
}

export function normalizeWebsite(raw: string | undefined | null): URL | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) throw new FetchBlockedError("Yalnızca http/https adresleri taranır");
  if (url.username || url.password) throw new FetchBlockedError("Kimlik bilgisi içeren adresler taranmaz");
  if (url.port && !["80", "443"].includes(url.port)) throw new FetchBlockedError("Standart dışı port taranmaz");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new FetchBlockedError("Yerel adresler taranmaz");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) throw new FetchBlockedError("Özel veya ayrılmış ağ adresine izin verilmez");
}

export interface SafeResponse {
  url: string; // son (yönlendirme sonrası) adres
  status: number;
  headers: Headers;
  body: string;
  buffer: Buffer; // ham gövde (görsel gibi ikili içerik için)
  bytes: number;
  truncated: boolean;
  ms: number;
  redirects: string[];
}

export async function safeFetch(input: string | URL, opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: string; signal?: AbortSignal } = {}): Promise<SafeResponse> {
  const { timeoutMs = 15_000, maxBytes = 1_500_000, maxRedirects = 5, accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } = opts;
  let url = new URL(String(input));
  const redirects: string[] = [];
  const started = Date.now();
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])]);
    const res = await fetch(url, { redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "tr,en;q=0.7" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new Error("Çok fazla yönlendirme");
      url = new URL(res.headers.get("location")!, url);
      redirects.push(url.toString());
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0, truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
        chunks.push(value);
      }
    }
    const buffer = Buffer.concat(chunks);
    return { url: url.toString(), status: res.status, headers: res.headers, body: buffer.toString("utf8"), buffer, bytes, truncated, ms: Date.now() - started, redirects };
  }
}
