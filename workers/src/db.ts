/**
 * Data layer — a 1:1 port of backend/database.py (+ the /api/timeline query)
 * onto Cloudflare D1's API surface.
 *
 * Everything takes a minimal `D1Like` handle so the exact same code runs inside
 * the Worker (env.DB) and in the Node test harness (an adapter over node:sqlite).
 */
import type { TechEvent, Technology, FeedStats, SeedData } from './models';

export interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Like {
  prepare(query: string): D1Statement;
  batch?(statements: D1Statement[]): Promise<unknown[]>;
}

/** "YYYY-MM-DD HH:MM UTC" — the exact string format Python's datetime.utcnow() produced. */
export function utcStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function daysAgoStamp(days: number, date: Date = new Date()): string {
  return utcStamp(new Date(date.getTime() - days * 86_400_000));
}

function rowToTechnology(row: any): Technology {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    category: row.category,
    developer: row.developer,
    license: row.license,
    pricing_model: row.pricing_model,
    has_free_tier: !!row.has_free_tier,
    pricing_details: row.pricing_details,
    has_api: !!row.has_api,
    current_version: row.current_version,
    strengths: JSON.parse(row.strengths),
    limitations: JSON.parse(row.limitations),
    platforms: JSON.parse(row.platforms),
    official_url: row.official_url,
    docs_url: row.docs_url,
    repo_url: row.repo_url,
    last_verified_at: row.last_verified_at,
  };
}

function rowToEvent(row: any): TechEvent {
  return {
    id: row.id,
    technology_id: row.technology_id,
    technology_name: row.technology_name,
    title: row.title,
    category: row.category,
    event_type: row.event_type,
    importance: row.importance,
    summary_tldr: row.summary_tldr,
    what_changed: JSON.parse(row.what_changed),
    explanation_technical: row.explanation_technical,
    explanation_simple: row.explanation_simple,
    impact_audiences: JSON.parse(row.impact_audiences),
    impact_summary: row.impact_summary,
    primary_source_tier: row.primary_source_tier,
    sources_count: row.sources_count,
    sources: JSON.parse(row.sources),
    verified_at: row.verified_at,
    is_confirmed: !!row.is_confirmed,
  };
}

function extractVersionFromTitle(title: string): string | null {
  const patterns = [
    /\bv?\d+\.\d+\.\d+(?:-[\w.]+)?/i,
    /\bv?\d+\.\d+\b/i,
    /\bv\d+(?!\.\d)/i,
  ];
  for (const p of patterns) {
    const m = title.match(p);
    if (m) return m[0];
  }
  return null;
}

function widenDateBound(value: string, endOfDay: boolean): string {
  if (value.length === 10) return `${value} ${endOfDay ? '23:59' : '00:00'} UTC`;
  return value;
}

const INSERT_TECHNOLOGY = `
  INSERT INTO technologies (
    id, name, tagline, category, developer, license, pricing_model,
    has_free_tier, pricing_details, has_api, current_version,
    strengths, limitations, platforms, official_url, docs_url, repo_url, last_verified_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, tagline=excluded.tagline, category=excluded.category,
    developer=excluded.developer, license=excluded.license, pricing_model=excluded.pricing_model,
    has_free_tier=excluded.has_free_tier, pricing_details=excluded.pricing_details,
    has_api=excluded.has_api, current_version=excluded.current_version,
    strengths=excluded.strengths, limitations=excluded.limitations, platforms=excluded.platforms,
    official_url=excluded.official_url, docs_url=excluded.docs_url, repo_url=excluded.repo_url,
    last_verified_at=excluded.last_verified_at`;

const INSERT_EVENT = `
  INSERT INTO events (
    id, technology_id, technology_name, title, category, event_type, importance,
    summary_tldr, what_changed, explanation_technical, explanation_simple,
    impact_audiences, impact_summary, primary_source_tier, sources_count,
    sources, verified_at, is_confirmed
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, summary_tldr=excluded.summary_tldr,
    what_changed=excluded.what_changed,
    explanation_technical=excluded.explanation_technical,
    explanation_simple=excluded.explanation_simple,
    sources_count=excluded.sources_count, sources=excluded.sources,
    verified_at=excluded.verified_at`;

export function technologyToRow(t: Technology): unknown[] {
  return [
    t.id, t.name, t.tagline, t.category, t.developer, t.license, t.pricing_model,
    t.has_free_tier ? 1 : 0, t.pricing_details, t.has_api ? 1 : 0, t.current_version,
    JSON.stringify(t.strengths), JSON.stringify(t.limitations), JSON.stringify(t.platforms),
    t.official_url, t.docs_url, t.repo_url, t.last_verified_at,
  ];
}

export function eventToRow(e: TechEvent): unknown[] {
  return [
    e.id, e.technology_id, e.technology_name, e.title, e.category, e.event_type, e.importance,
    e.summary_tldr, JSON.stringify(e.what_changed), e.explanation_technical, e.explanation_simple,
    JSON.stringify(e.impact_audiences), e.impact_summary, e.primary_source_tier, e.sources_count,
    JSON.stringify(e.sources), e.verified_at, e.is_confirmed ? 1 : 0,
  ];
}

export function createBackend(db: D1Like) {
  async function getAllTechnologies(category?: string, search?: string): Promise<Technology[]> {
    let sql = 'SELECT * FROM technologies WHERE 1=1';
    const params: unknown[] = [];
    if (category && category !== 'All') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (name LIKE ? OR tagline LIKE ? OR developer LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    sql += ' ORDER BY name ASC';
    const { results } = await db.prepare(sql).bind(...params).all<any>();
    const techs = (results || []).map(rowToTechnology);
    for (const t of techs) {
      const c = await db.prepare('SELECT COUNT(*) AS n FROM events WHERE technology_id = ?').bind(t.id).first<any>();
      t.recent_events_count = c ? Number(c.n) : 0;
    }
    return techs;
  }

  async function getTechnologyById(techId: string): Promise<Technology | null> {
    const row = await db.prepare('SELECT * FROM technologies WHERE id = ?').bind(techId).first<any>();
    if (!row) return null;
    const tech = rowToTechnology(row);
    const c = await db.prepare('SELECT COUNT(*) AS n FROM events WHERE technology_id = ?').bind(tech.id).first<any>();
    tech.recent_events_count = c ? Number(c.n) : 0;
    return tech;
  }

  async function getAllEvents(opts: {
    category?: string;
    importance?: string;
    event_type?: string;
    search?: string;
    limit?: number;
    offset?: number;
    date_from?: string;
    date_to?: string;
    days?: number;
  } = {}): Promise<TechEvent[]> {
    let { category, importance, event_type, search, limit = 50, offset = 0, date_from, date_to, days } = opts;

    // `days` is the shorthand for "trailing N days". Explicit bounds win.
    if (days && !(date_from || date_to)) {
      date_from = daysAgoStamp(days);
    }
    if (date_from) date_from = widenDateBound(date_from, false);
    if (date_to) date_to = widenDateBound(date_to, true);

    let query = 'SELECT * FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (category && category !== 'All') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (importance && importance !== 'All') {
      query += ' AND importance = ?';
      params.push(importance);
    }
    if (event_type && event_type !== 'All') {
      query += ' AND event_type = ?';
      params.push(event_type);
    }
    if (search) {
      query += ' AND (title LIKE ? OR summary_tldr LIKE ? OR technology_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (date_from) {
      query += ' AND verified_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND verified_at <= ?';
      params.push(date_to);
    }
    query += ' ORDER BY verified_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await db.prepare(query).bind(...params).all<any>();
    return (results || []).map(rowToEvent);
  }

  async function getEventById(eventId: string): Promise<TechEvent | null> {
    const row = await db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<any>();
    return row ? rowToEvent(row) : null;
  }

  async function getEventsForTechnology(
    techId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<TechEvent[]> {
    let query = 'SELECT * FROM events WHERE technology_id = ?';
    const params: unknown[] = [techId];
    if (dateFrom) {
      query += ' AND verified_at >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ' AND verified_at <= ?';
      params.push(dateTo);
    }
    query += ' ORDER BY verified_at DESC';
    const { results } = await db.prepare(query).bind(...params).all<any>();
    return (results || []).map(rowToEvent);
  }

  async function getStats(): Promise<FeedStats> {
    const total = await db.prepare('SELECT COUNT(*) AS n FROM events').first<any>();
    const critSec = await db.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE importance = 'critical' AND (event_type = 'security_patch' OR category = 'Security')",
    ).first<any>();
    const ai = await db.prepare("SELECT COUNT(*) AS n FROM events WHERE category = 'AI/ML'").first<any>();
    const sumRow = await db.prepare('SELECT SUM(sources_count) AS s FROM events').first<any>();

    const totalEvents = total ? Number(total.n) : 0;
    const verifiedSources = sumRow && sumRow.s != null ? Number(sumRow.s) : totalEvents;

    const now = new Date();
    const todayStart = now.toISOString().slice(0, 10) + ' 00:00 UTC';
    const weekStart = daysAgoStamp(7, now);
    const monthStart = daysAgoStamp(30, now);

    const countSince = (cutoff: string) =>
      db.prepare('SELECT COUNT(*) AS n FROM events WHERE verified_at >= ?').bind(cutoff).first<any>();

    const [today, week, month] = await Promise.all([countSince(todayStart), countSince(weekStart), countSince(monthStart)]);

    return {
      total_events: totalEvents,
      new_today: today ? Number(today.n) : 0,
      new_this_week: week ? Number(week.n) : 0,
      new_this_month: month ? Number(month.n) : 0,
      critical_security_count: critSec ? Number(critSec.n) : 0,
      ai_updates_count: ai ? Number(ai.n) : 0,
      verified_sources_count: verifiedSources,
      last_sync: await getLastSync(),
    };
  }

  async function getTimeline(days: number = 30): Promise<{ days: number; series: { date: string; count: number }[]; peak: number }> {
    const cutoff = daysAgoStamp(days, new Date()).slice(0, 10);
    const { results } = await db.prepare(
      `SELECT substr(verified_at, 1, 10) AS day, COUNT(*) AS count
       FROM events WHERE substr(verified_at, 1, 10) >= ?
       GROUP BY day ORDER BY day ASC`,
    ).bind(cutoff).all<any>();
    const rows: Record<string, number> = {};
    for (const r of results || []) rows[r.day] = Number(r.count);

    const series: { date: string; count: number }[] = [];
    const today = new Date();
    for (let offset = days - 1; offset >= 0; offset--) {
      const d = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
      series.push({ date: d, count: rows[d] || 0 });
    }
    const peak = series.reduce((m, p) => Math.max(m, p.count), 0);
    return { days, series, peak };
  }

  async function getTechnologyEvolution(techId: string, days: number = 30): Promise<any> {
    const tech = await getTechnologyById(techId);
    if (!tech) return { error: 'Technology not found' };

    const events = await getEventsForTechnology(techId, daysAgoStamp(days));

    const versionReleases = events.filter((e) => ['major_upgrade', 'new_tool', 'ai_model'].includes(e.event_type));
    const featureUpdates = events.filter((e) => e.event_type === 'feature_update');
    const securityPatches = events.filter((e) => e.event_type === 'security_patch');
    const pricingChanges = events.filter((e) => e.event_type === 'pricing_change');
    const deprecations = events.filter((e) => e.event_type === 'deprecation');

    const versionTimeline = events
      .map((e) => {
        const version = extractVersionFromTitle(e.title);
        if (!version) return null;
        return {
          date: e.verified_at,
          version,
          title: e.title,
          importance: e.importance,
          summary: e.summary_tldr,
          type: e.event_type,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const criticalCount = events.filter((e) => e.importance === 'critical').length;
    const majorCount = events.filter((e) => e.importance === 'major').length;

    return {
      technology: {
        id: tech.id,
        name: tech.name,
        current_version: tech.current_version,
        category: tech.category,
      },
      period_days: days,
      summary: {
        total_events: events.length,
        version_releases: versionReleases.length,
        feature_updates: featureUpdates.length,
        security_patches: securityPatches.length,
        pricing_changes: pricingChanges.length,
        critical_events: criticalCount,
        major_events: majorCount,
      },
      version_timeline: versionTimeline,
      recent_events: events.slice(0, 20).map((e) => ({
        id: e.id,
        date: e.verified_at,
        title: e.title,
        type: e.event_type,
        importance: e.importance,
        summary: e.summary_tldr,
      })),
      event_breakdown: {
        major_upgrade: versionReleases.length,
        feature_update: featureUpdates.length,
        security_patch: securityPatches.length,
        pricing_change: pricingChanges.length,
        deprecation: deprecations.length,
      },
    };
  }

  async function getLastSync(): Promise<string> {
    const r = await db.prepare("SELECT value FROM seed_meta WHERE key = 'last_sync_at'").first<any>();
    return r ? r.value : 'Not synced yet';
  }

  async function setLastSync(timestamp?: string): Promise<void> {
    await db.prepare("INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('last_sync_at', ?)")
      .bind(timestamp || utcStamp()).run();
  }

  async function insertEvent(event: TechEvent): Promise<void> {
    await db.prepare(INSERT_EVENT).bind(...eventToRow(event)).run();
  }

  async function insertTechnology(tech: Technology): Promise<void> {
    await db.prepare(INSERT_TECHNOLOGY).bind(...technologyToRow(tech)).run();
  }

  /** Seed on first warm run: only inserts when the events table is empty. */
  async function ensureSeeded(seed: SeedData): Promise<void> {
    const c = await db.prepare('SELECT COUNT(*) AS n FROM events').first<any>();
    if (c && Number(c.n) > 0) return;
    const stmts: D1Statement[] = [];
    for (const t of seed.technologies) stmts.push(db.prepare(INSERT_TECHNOLOGY).bind(...technologyToRow(t)));
    for (const e of seed.events) stmts.push(db.prepare(INSERT_EVENT).bind(...eventToRow(e)));
    if (db.batch) {
      await db.batch(stmts);
    } else {
      for (const s of stmts) await s.run();
    }
    await setLastSync(seed.generated_at);
  }

  return {
    getAllTechnologies,
    getTechnologyById,
    getAllEvents,
    getEventById,
    getEventsForTechnology,
    getStats,
    getTimeline,
    getTechnologyEvolution,
    getLastSync,
    setLastSync,
    insertEvent,
    insertTechnology,
    ensureSeeded,
  };
}

export type Backend = ReturnType<typeof createBackend>;