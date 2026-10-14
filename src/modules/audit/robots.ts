// robots.txt ayrıştırıcı (RFC 9309): kendi ajan grubumuz yoksa "*" grubu uygulanır, en uzun eşleşen kural kazanır,
// eşit uzunlukta Allow önceliklidir. "*" ve "$" desenleri desteklenir.

export interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
  sitemaps: string[];
  crawlDelay: number | null;
}

export function parseRobots(text: string, agent: string): RobotsRules {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[]; delay: number | null }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { if (value) sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], delay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") { if (value || key === "allow") current.rules.push({ allow: key === "allow", pattern: value }); }
    else if (key === "crawl-delay" && Number.isFinite(Number(value))) current.delay = Number(value);
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((g) => g.rules), sitemaps, crawlDelay: chosen.find((g) => g.delay != null)?.delay ?? null };
}

const toRegex = (pattern: string) => new RegExp("^" + pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$"));

export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules.rules) {
    if (!rule.pattern) continue;
    if (!toRegex(rule.pattern).test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}
