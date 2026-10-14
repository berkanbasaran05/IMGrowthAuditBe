// Basit bellek içi hız sınırı (anahtar başına kayan pencere). Tek sunucu için yeterlidir;
// çok sunuculu kurulumda ağ geçidinde (ör. Nginx, Cloudflare) uygulanmalıdır.
const hits = new Map<string, number[]>();

export function rateLimited(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now(), list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now); hits.set(key, list);
  if (hits.size > 5_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return list.length > limit;
}

// İstemci IP'si Express'in "trust proxy" ayarıyla hesaplanan req.ip'tir; X-Forwarded-For doğrudan okunmaz
// (istemci bu başlığı kendisi gönderip hız sınırını atlatabilirdi).
export const clientIp = (req: { ip?: string; socket?: { remoteAddress?: string } }) => String(req.ip || req.socket?.remoteAddress || "bilinmiyor");
