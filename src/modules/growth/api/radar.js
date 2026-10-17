import { isAuthed } from "../lib/auth.js";
import { getOne, put } from "../lib/redis.js";
import { buildOutreach } from "../lib/outreach.js";

const clean = (v, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const TR = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
const slug = (v) => String(v).toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => TR[c]).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
const first = (...values) => values.map((v) => clean(v, 240)).find(Boolean) || "";
const norm = (v) => String(v || "").toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (c) => TR[c]);
const SELECTORS = [
  [/dis|dental|ortodont|implant/, ['["amenity"="dentist"]']],
  [/hastane|klinik|saglik|poliklinik/, ['["amenity"~"clinic|hospital|doctors"]']],
  [/pastane|firin|bakery/, ['["shop"="bakery"]']],
  [/restoran|restaurant|lokanta|kafe|cafe|kahve|burger|kebap/, ['["amenity"~"restaurant|cafe|fast_food"]']],
  [/kuafor|berber|guzellik|bakim/, ['["shop"~"hairdresser|beauty"]']],
  [/sigorta/, ['["office"="insurance"]']],
  [/emlak|gayrimenkul/, ['["office"="estate_agent"]']],
  [/hukuk|avukat/, ['["office"="lawyer"]']],
  [/muhasebe|mali musavir/, ['["office"="accountant"]']],
  [/mobilya|dekorasyon/, ['["shop"="furniture"]']],
  [/tekstil|giyim|butik|kumas/, ['["shop"~"clothes|fabric|fashion"]']],
  [/otomotiv|oto servis|kaporta|lastik/, ['["shop"~"car_repair|tyres|car"]']],
  [/otel|konaklama|pansiyon/, ['["tourism"~"hotel|guest_house|hostel"]']],
  [/egitim|kurs|okul|anaokul|kres/, ['["amenity"~"school|kindergarten|language_school|training"]']],
  [/spor|fitness|pilates|gym|yoga/, ['["leisure"="fitness_centre"]']],
  [/eczane/, ['["amenity"="pharmacy"]']],
  [/optik|gozluk/, ['["shop"="optician"]']],
  [/cicek/, ['["shop"="florist"]']],
];
const selectorsFor = (sector) => SELECTORS.find(([re]) => re.test(norm(sector)))?.[1] || [];

async function discover(city, sector, limit) {
  const geoParams = new URLSearchParams({ q: `${city}, Türkiye`, format: "jsonv2", addressdetails: "1", countrycodes: "tr", limit: "1" });
  const geo = await fetch(`https://nominatim.openstreetmap.org/search?${geoParams}`, { headers: { Accept: "application/json", "Accept-Language": "tr", "User-Agent": "IMGrowthAudit/1.0 (istanbul.marketing)" }, signal: AbortSignal.timeout(12000) });
  if (!geo.ok) throw new Error("Şehir konumu alınamadı");
  const location = (await geo.json())?.[0];
  if (!location?.boundingbox) throw new Error("Seçilen şehir haritada bulunamadı");
  const [south, north, west, east] = location.boundingbox, bbox = `${south},${west},${north},${east}`;
  const selectors = selectorsFor(sector);
  const parts = selectors.length
    ? selectors.map((selector) => `nwr${selector}(${bbox});`).join("")
    : `nwr["name"~"${clean(sector, 50).replace(/["\\]/g, "")}",i](${bbox});`;
  const query = `[out:json][timeout:20];(${parts});out center tags ${limit};`;
  const overpass = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "IMGrowthAudit/1.0 (istanbul.marketing)" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(25000) });
  if (!overpass.ok) throw new Error(`İşletme arama servisi yanıt vermedi (${overpass.status})`);
  const data = await overpass.json();
  return (data.elements || []).filter((e) => e.tags?.name).slice(0, limit).map((e) => {
    const t = e.tags || {};
    return { osm_id: e.id, osm_type: e.type, name: t.name, lat: e.lat || e.center?.lat, lon: e.lon || e.center?.lon, importance: 0.2,
      type: first(t.amenity, t.shop, t.office, t.tourism, t.leisure),
      extratags: t, address: { city: first(t["addr:city"], city), district: first(t["addr:district"], t["addr:suburb"], t["addr:neighbourhood"]) } };
  });
}

function leadFromPlace(place, query) {
  const x = place.extratags || {}, a = place.address || {}, names = place.namedetails || {};
  const name = first(place.name, names.name, String(place.display_name || "").split(",")[0]);
  // Seçilen şehir kanonik değerdir; harita kayıtlarındaki farklı yazımlar filtreyi bozmamalı.
  const city = query.city;
  const district = first(a.district, a.suburb, a.borough, a.municipality, a.village);
  const website = first(x.website, x["contact:website"]);
  const phone = first(x.phone, x["contact:phone"], x.mobile, x["contact:mobile"]);
  const email = first(x.email, x["contact:email"]).toLowerCase();
  const instagram = first(x.instagram, x["contact:instagram"]);
  const score = Math.min(98, 54 + (phone ? 10 : 0) + (website ? 10 : 0) + (email ? 8 : 0) + (instagram ? 6 : 0) + (district ? 4 : 0) + (place.importance ? Math.min(6, Math.round(place.importance * 12)) : 0));
  const issues = [!website && "Web sitesi bulunamadı", !email && "E-posta bilgisi bulunamadı", !instagram && "Instagram hesabı bulunamadı"].filter(Boolean);
  const lead = {
    name, sector: query.sector || clean(place.type || place.category || "Diğer"), city, district,
    phone, email, instagram, website, websiteStatus: website ? "iyi" : "yok", ads: "",
    services: query.service ? [query.service] : [], score, issues,
    capacity: `${city}${district ? `, ${district}` : ""} bölgesinde faaliyet gösteren işletme. Harita kaynağından Radar ile bulundu.`,
    mapsUrl: `https://www.openstreetmap.org/${place.osm_type === "node" ? "node" : place.osm_type === "way" ? "way" : "relation"}/${place.osm_id}`,
    location: { lat: Number(place.lat), lon: Number(place.lon) }, source: "radar-osm",
    foundAt: new Date().toISOString().slice(0, 10), status: "yeni",
  };
  const id = slug(`${name}-${district || city}-${place.osm_id}`) || `firma-${place.osm_id}`;
  lead.outreach = buildOutreach({ id, ...lead });
  return { id, ...lead };
}

export default async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
  if (req.method !== "POST") return res.status(405).end();
  const city = clean(req.body?.city, 60), sector = clean(req.body?.sector || req.body?.query, 100), service = clean(req.body?.service, 60);
  if (!city) return res.status(400).json({ error: "Radar araması için şehir seçin." });
  if (!sector) return res.status(400).json({ error: "Aranacak firma türünü veya sektörü yazın." });
  const limit = Math.max(5, Math.min(40, Number(req.body?.limit) || 25));
  try {
    const places = await discover(city, sector, limit);
    const unique = new Map();
    for (const place of Array.isArray(places) ? places : []) {
      const lead = leadFromPlace(place, { city, sector, service });
      if (lead.name && !unique.has(`${lead.name.toLocaleLowerCase("tr")}|${lead.district}`)) unique.set(`${lead.name.toLocaleLowerCase("tr")}|${lead.district}`, lead);
    }
    let added = 0, updated = 0;
    for (const lead of unique.values()) {
      const { id, ...data } = lead, current = await getOne("leads", id);
      if (current) {
        await put("leads", id, { ...data, ...Object.fromEntries(["status","statusAt","notes","seq","works","work","callList","targetList","targetSector","contactName","contactTitle","contactLine","contactSource","contactConf"].filter((k) => current[k] !== undefined).map((k) => [k, current[k]])) });
        updated++;
      } else { await put("leads", id, data); added++; }
    }
    const date = new Date().toISOString();
    await put("runs", `radar-${Date.now()}`, { date, city, sectors: [sector], source: "radar", found: unique.size, added, updated });
    return res.status(200).json({ ok: true, found: unique.size, added, updated, leads: [...unique.values()] });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "Arama servisi zaman aşımına uğradı. Tekrar deneyin." : error.message;
    return res.status(502).json({ error: message || "Radar araması yapılamadı." });
  }
}
