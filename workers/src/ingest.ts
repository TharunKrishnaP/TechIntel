/**
 * Live feed ingestion — a port of backend/pipeline/ingestion.py + clustering.py.
 * Runs on the Worker's cron trigger (every 15 minutes) and is also callable
 * from POST /api/refresh-feed, mirroring the desktop app's beat.
 */
import { XMLParser } from 'fast-xml-parser';
import type { TechEvent, SourceCitation, WhatChanged, Technology } from './models';
import type { Backend } from './db';

const FEED_SOURCES = [
  { name: 'Python Software Foundation', url: 'https://www.python.org/dev/peps/peps.rss', tier: 1 },
  { name: 'GitHub Releases - Supabase', url: 'https://github.com/supabase/supabase/releases.atom', tier: 1 },
  { name: 'GitHub Releases - Qdrant', url: 'https://github.com/qdrant/qdrant/releases.atom', tier: 1 },
  { name: 'GitHub Releases - Next.js', url: 'https://github.com/vercel/next.js/releases.atom', tier: 1 },
  { name: 'Hacker News Tech Frontpage', url: 'https://news.ycombinator.com/rss', tier: 3 },
];

const TIER_1_DOMAINS = [
  'github.com', 'python.org', 'anthropic.com', 'openai.com', 'qdrant.tech',
  'supabase.com', 'gamma.app', 'beautiful.ai', 'nextjs.org', 'vercel.com',
  'openssl.org', 'nist.gov', 'docs.', 'changelog', 'blog.google', 'apple.com',
];

const TIER_2_DOMAINS = [
  'techcrunch.com', 'theverge.com', 'theregister.com', 'venturebeat.com',
  'bleepingcomputer.com', 'arstechnica.com', 'wired.com', 'zdnet.com', 'infoworld.com',
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function asText(x: unknown): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (typeof x === 'object') {
    const obj = x as Record<string, unknown>;
    if (obj['#text'] != null) return String(obj['#text']);
    if ('value' in obj && obj.value != null) return String(obj.value);
  }
  return String(x);
}

function pickLink(entry: Record<string, any>): string {
  const link = entry.link;
  if (typeof link === 'string') return link;
  if (link && typeof link === 'object') {
    const href = (link as any)['@_href'] || (link as any).href;
    if (href) return String(href);
  }
  return '';
}

function normalizeDate(value: string): string {
  const v = value.trim();
  if (!v) return utcNow();
  // Atom gives ISO "2026-09-30T18:00:00Z"; RSS gives RFC-ish strings. The
  // desktop app kept whatever feedparser emitted, so we pass through as-is —
  // these strings are display-only citation metadata.
  return v;
}

function utcNow(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function cleanSummary(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export async function fetchFeed(source: { name: string; url: string }): Promise<Array<Record<string, any>>> {
  const items: Array<Record<string, any>> = [];
  try {
    const resp = await fetch(source.url, {
      headers: { 'user-agent': 'TechIntel/1.0 (+https://github.com/TharunKrishnaP/TechIntel)' },
      redirect: 'follow',
    });
    if (!resp.ok) return items;
    const text = await resp.text();
    const root = parser.parse(text);
    let entries: any[] = [];
    if (root.rss && root.rss.channel) {
      const ch = root.rss.channel;
      const list = Array.isArray(ch.item) ? ch.item : ch.item ? [ch.item] : [];
      entries = list;
    } else if (root.feed) {
      const list = Array.isArray(root.feed.entry) ? root.feed.entry : root.feed.entry ? [root.feed.entry] : [];
      entries = list;
    }
    for (const entry of entries.slice(0, 5)) {
      const title = asText(entry.title).trim();
      const link = pickLink(entry).trim();
      if (!title) continue;
      const summaryRaw = asText(entry.description || entry.summary || (entry.content ? asText(entry.content) : ''));
      items.push({
        title,
        url: link,
        summary: cleanSummary(summaryRaw),
        published_at: normalizeDate(asText(entry.published || entry.updated || entry.pubDate)),
      });
    }
  } catch {
    // Feed hiccup: skip this source, keep the rest of the sync moving.
  }
  return items;
}

export function determineSourceTier(url: string, publisher: string): [number, string] {
  let domain = '';
  try {
    domain = new URL(url).hostname.toLowerCase();
  } catch {
    domain = url.toLowerCase();
  }
  for (const t1 of TIER_1_DOMAINS) {
    if (domain.includes(t1) || publisher.toLowerCase().includes(t1)) {
      if (domain.includes('github.com')) return [1, 'Tier 1 - GitHub Release'];
      if (domain.includes('docs')) return [1, 'Tier 1 - Official Docs'];
      if (url.includes('secadv') || url.includes('cve')) return [1, 'Tier 1 - Official Advisory'];
      return [1, 'Tier 1 - Official Source'];
    }
  }
  for (const t2 of TIER_2_DOMAINS) {
    if (domain.includes(t2) || publisher.toLowerCase().includes(t2)) return [2, 'Tier 2 - Technical Press'];
  }
  return [3, 'Tier 3 - Community / Social'];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'and', 'or', 'for', 'with',
  'to', 'at', 'by', 'from', 'is', 'are', 'has', 'have', 'releases',
  'announces', 'launches', 'new', 'update', 'v', 'version',
]);

export function extractKeyTokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-zA-Z0-9_\-\.]+/g) || [];
  const tokens = new Set<string>();
  for (const w of words) {
    if (!STOP_WORDS.has(w) && w.length > 2) tokens.add(w);
  }
  return tokens;
}

function itemsBelongTogether(itemA: Record<string, any>, itemB: Record<string, any>): boolean {
  const a = extractKeyTokens(String(itemA.title));
  const b = extractKeyTokens(String(itemB.title));
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  return overlap >= 2;
}

export function classifyEventTypeAndImportance(
  title: string,
  summary: string,
): [string, string, string] {
  const content = (title + ' ' + summary).toLowerCase();
  if (['cve-', 'vulnerability', 'denial of service', 'security advisory', 'exploit', 'patch'].some((k) => content.includes(k))) {
    return ['security_patch', 'critical', 'Security'];
  }
  if (['llm', 'frontier model', 'sonnet', 'gpt-', 'gemini', 'ai model', 'reasoning model'].some((k) => content.includes(k))) {
    return ['ai_model', 'major', 'AI/ML'];
  }
  if (['free-threaded', 'no-gil', 'major release', '1.0', 'v15', 'v3.13', 'overhaul'].some((k) => content.includes(k))) {
    return ['major_upgrade', 'major', 'DevTools'];
  }
  if (['pricing', 'free tier', 'paid plan', 'subscription'].some((k) => content.includes(k))) {
    return ['pricing_change', 'significant', 'AI/ML'];
  }
  if (['deprecated', 'discontinued', 'sunset'].some((k) => content.includes(k))) {
    return ['deprecation', 'significant', 'DevTools'];
  }
  if (['vector', 'database', 'pgvector', 'storage', 'sql'].some((k) => content.includes(k))) {
    return ['feature_update', 'significant', 'Databases'];
  }
  return ['feature_update', 'normal', 'DevTools'];
}

function matchKnownTechnology(
  title: string,
  summary: string,
  allTechs: Technology[],
): Technology | null {
  const haystack = `${title} ${summary}`.toLowerCase();
  let best: Technology | null = null;
  let bestLen = 0;
  for (const tech of allTechs) {
    const name = tech.name.toLowerCase();
    const core = name.split('(')[0].trim();
    const candidates = new Set([name, core, tech.id.toLowerCase().replace('-', ' ')]);
    for (const candidate of candidates) {
      if (candidate.length < 3) continue;
      if (haystack.includes(candidate)) {
        if (best === null || candidate.length > bestLen) {
          best = tech;
          bestLen = candidate.length;
        }
        break;
      }
    }
  }
  return best;
}

/**
 * Fetch all configured feeds, cluster duplicates, and upsert canonical events.
 * Returns the number of newly ingested events (0 when nothing new).
 */
export async function syncAllFeeds(backend: Backend): Promise<number> {
  const results = await Promise.all(FEED_SOURCES.map((s) => fetchFeed(s)));
  const allRaw = results.flat();
  if (allRaw.length === 0) return 0;

  const existingEvents = await backend.getAllEvents({ limit: 200 });
  const existingTitles = existingEvents.map((e) => e.title.toLowerCase());

  const clusters: Array<Array<Record<string, any>>> = [];
  for (const item of allRaw) {
    let matched: Array<Record<string, any>> | null = null;
    for (const cluster of clusters) {
      if (cluster.some((c) => itemsBelongTogether(item, c))) {
        matched = cluster;
        break;
      }
    }
    if (matched) matched.push(item);
    else clusters.push([item]);
  }

  const allTechs = await backend.getAllTechnologies();
  let newCount = 0;

  for (const cluster of clusters) {
    const primary = cluster[0];
    const primaryTitle = String(primary.title).toLowerCase();
    if (existingTitles.some((et) => et.includes(primaryTitle))) continue;

    const knownTech = matchKnownTechnology(primary.title, primary.summary, allTechs);

    const citations: SourceCitation[] = [];
    let bestTier = 3;
    for (const itm of cluster) {
      const [tier, label] = determineSourceTier(itm.url, itm.publisher || '');
      if (tier < bestTier) bestTier = tier;
      citations.push({
        url: itm.url,
        title: String(itm.title),
        publisher: String(itm.publisher || ''),
        tier,
        tier_label: label,
        published_at: itm.published_at,
      });
    }

    const [evtType, importance, category] = classifyEventTypeAndImportance(primary.title, primary.summary);

    const eventId = `evt-live-${Math.floor(Date.now() / 1000)}-${newCount}`;

    const whatChanged: WhatChanged = {
      previous_state: ['Previous stable release iteration'],
      new_state: [`Updated features & fixes: ${String(primary.title).slice(0, 100)}`],
    };

    let techName: string;
    let techId: string | null;
    if (knownTech) {
      techName = knownTech.name;
      techId = knownTech.id;
    } else {
      techName = String(primary.publisher || 'Unknown').replace(/^GitHub Releases - /, '');
      techId = null;
    }

    const evt: TechEvent = {
      id: eventId,
      technology_id: techId,
      technology_name: techName,
      title: String(primary.title),
      category,
      event_type: evtType,
      importance,
      summary_tldr: primary.summary || String(primary.title),
      what_changed: whatChanged,
      explanation_technical: `Release update distributed via ${primary.publisher || techName}. Includes performance enhancements and dependency updates.`,
      explanation_simple: `${techName} published a new update with enhancements and bug fixes.`,
      impact_audiences: ['Developers', 'Engineers'],
      impact_summary: 'Relevant for teams maintaining systems built on this framework/dependency.',
      primary_source_tier: bestTier,
      sources_count: citations.length,
      sources: citations,
      verified_at: utcNow(),
      is_confirmed: true,
    };

    await backend.insertEvent(evt);
    existingTitles.push(String(evt.title).toLowerCase());
    newCount += 1;
  }

  return newCount;
}

let syncLock: Promise<number> | null = null;

/** Module-level lock so the cron beat and a manual refresh-feed can't race. */
export function syncAllFeedsSafely(backend: Backend): Promise<number> {
  if (!syncLock) {
    syncLock = syncAllFeeds(backend).finally(() => {
      syncLock = null;
    });
  }
  return syncLock;
}