/**
 * TechIntel — Data Adapter
 * ========================
 * One interface, two sources:
 *
 *   live    — the FastAPI backend (`/api/*`). Used when served by uvicorn, and
 *             when a user points the app at a hosted server.
 *   static  — JSON snapshots baked into `data/` at build time by
 *             `python -m backend.export_static`. This is what makes the
 *             installable PWA work with no server at all.
 *
 * Both modes return the *same shapes*, because the exporter drives the real
 * FastAPI app and dumps its responses verbatim. Anything that needs a server
 * only (live feed sync) reports `supported: false` in static mode so the UI can
 * explain itself instead of silently failing.
 */

const API = (() => {
  'use strict';

  const DATA_BASE = 'data/';
  const PROBE_TIMEOUT_MS = 1500;
  // Where the app remembers an explicit backend to talk to ("server URL").
  // Set via the 🌐 Server dialog or a `?server=` deep link; cleared to revert
  // to the bundled offline snapshot.
  const SERVER_STORAGE_KEY = 'techintel_server';

  // Hosted public backend URL — set this after deploying the Cloudflare Worker
  // (e.g. 'https://techintel-api.<your-subdomain>.workers.dev'). When non-empty:
  //   * the app offers a one-tap "Use cloud backend" option in the 🌐 dialog, and
  //   * probe() falls back to it after same-origin, so the Android APK goes live
  //     from anywhere with zero configuration.
  // Leave empty until the Worker is actually deployed.
  const PUBLIC_SERVER = ''; // e.g. 'https://techintel-api.your-subdomain.workers.dev'

  const state = {
    mode: 'static',        // 'live' | 'static'
    checked: false,
    baseUrl: '',           // populated in live mode
    attempted: '',         // server URL the user configured (if probe failed)
    base: {},              // static datasets, loaded once
    evoCache: new Map(),
  };

  /** Wait for `url` to answer GET /api/health. Used by the Server dialog's
   *  Test button and the Scan-LAN helper. */
  async function probeServer(rawUrl, timeoutMs = 2500) {
    const base = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!base) return { ok: false, error: 'empty' };
    const url = /^https?:\/\//i.test(base) ? base : `http://${base}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, status: res.status };
      const j = await res.json().catch(() => null);
      // The backend answers `{ "status": "healthy" }` here; accept that and the
      // conventional `ok` so this probe works against both the desktop/gateway
      // FastAPI build and the hosted Cloudflare Worker.
      const s = j && j.status;
      return { ok: s === 'healthy' || s === 'ok', status: res.status };
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      return { ok: false, error: aborted ? 'timeout' : 'unreachable' };
    }
  }

  /** URL of a backend the user explicitly configured, if any (query wins). */
  function configuredServerUrl() {
    let chosen = '';
    try {
      const fromQuery = (new URLSearchParams(window.location.search).get('server') || '').trim();
      if (fromQuery) {
        localStorage.setItem(SERVER_STORAGE_KEY, fromQuery);
        chosen = fromQuery;
      } else {
        chosen = (localStorage.getItem(SERVER_STORAGE_KEY) || '').trim();
      }
    } catch (_) { /* localStorage unavailable — live same-origin still works */ }
    return chosen;
  }

  /** Clear any configured server (back to the bundled snapshot). */
  function clearConfiguredServer() {
    try { localStorage.removeItem(SERVER_STORAGE_KEY); } catch (_) { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /** `verified_at` is "YYYY-MM-DD HH:MM UTC" — comparable as a plain string. */
  function toStamp(dateStr) {
    if (!dateStr) return null;
    if (dateStr.length === 10) return `${dateStr} 00:00 UTC`;
    return dateStr;
  }

  function stampForDaysAgo(n) {
    const d = new Date(Date.now() - n * 86400000);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
      d.getUTCHours()
    )}:${p(d.getUTCMinutes())} UTC`;
  }

  function stampEndOfDay(dateStr) {
    return dateStr && dateStr.length === 10 ? `${dateStr} 23:59 UTC` : dateStr;
  }

  /**
   * Recompute stats over the static event list. Mirrors `get_stats()`'s windows
   * and predicates so the header numbers stay truthful even though nothing is
   * re-syncing. Keep the predicates identical to the SQL — a subtly different
   * condition here would make the installed app quietly disagree with the live
   * one about the same data.
   */
  function computeStats(events) {
    const dayStart = stampForDaysAgo(0).slice(0, 10) + ' 00:00 UTC';
    const week = stampForDaysAgo(7);
    const month = stampForDaysAgo(30);
    let today = 0, weekN = 0, monthN = 0, security = 0, ai = 0, sources = 0;
    for (const e of events) {
      const v = e.verified_at;
      if (v >= dayStart) today++;
      if (v >= week) weekN++;
      if (v >= month) monthN++;
      // SQL: importance = 'critical' AND (event_type = 'security_patch' OR category = 'Security')
      if (e.importance === 'critical' && (e.event_type === 'security_patch' || e.category === 'Security')) {
        security++;
      }
      if (e.category === 'AI/ML') ai++;
      sources += e.sources_count || 0;
    }
    return {
      total_events: events.length,
      new_today: today,
      new_this_week: weekN,
      new_this_month: monthN,
      critical_security_count: security,
      ai_updates_count: ai,
      // SQL uses COALESCE-like fallback: a NULL SUM falls back to the total.
      verified_sources_count: sources || events.length,
      last_sync: 'Offline snapshot',
    };
  }

  // -------------------------------------------------------------------------
  // Mode detection
  // -------------------------------------------------------------------------

  async function probe() {
    // Candidates, most specific first: an explicitly configured server URL
    // (entered in the 🌐 Server dialog or ?server= deep link), then same-origin.
    const candidates = [];
    const configured = configuredServerUrl();
    if (configured) {
      state.attempted = configured.replace(/\/+$/, '');
      candidates.push(state.attempted);
    }
    candidates.push(''); // same-origin
    // Hosted backend last, so local/desktop installs keep preferring their own
    // backend while the Android APK (which has no same-origin server) gets a
    // public live source automatically once one is configured.
    if (PUBLIC_SERVER) {
      const hosted = PUBLIC_SERVER.trim().replace(/\/+$/, '');
      if (hosted) candidates.push(hosted);
    }

    for (const base of candidates) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          state.mode = 'live';
          state.baseUrl = base;
          state.checked = true;
          return 'live';
        }
      } catch (_) {
        /* no server reachable — fall through to static */
      }
    }

    state.mode = 'static';
    state.checked = true;
    return 'static';
  }

  /** Build a (up-to) 30-day activity series from the event list. */
  function buildHeatmapFromEvents(events) {
    if (!events || !events.length) return { days: 0, series: [], peak: 0 };
    const counts = {};
    for (const e of events) {
      const day = (e.verified_at || '').slice(0, 10);
      if (day.length !== 10) continue;
      counts[day] = (counts[day] || 0) + 1;
    }
    const days = Object.keys(counts).sort();
    const first = days[0];
    const last = days[days.length - 1];
    const series = [];
    const cursor = new Date(first + 'T00:00:00Z');
    const lastTime = new Date(last + 'T00:00:00Z');
    while (cursor <= lastTime && series.length <= 30) {
      const key = cursor.toISOString().slice(0, 10);
      series.push({ date: key, count: counts[key] || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return { days: series.length, series, peak: series.reduce((m, p) => Math.max(m, p.count), 0) };
  }

  async function loadStatic() {
    const get = async (file) => {
      const res = await fetch(DATA_BASE + file);
      if (!res.ok) throw new Error(`missing data/${file}`);
      return res.json();
    };
    // Resilient loading: only tools.json is baked into the SW precache list as
    // essential, but the app should *never* show a blank screen just because one
    // optional snapshot file is missing on a device — derive what we can.
    let events = [], tools = [], stats = null, timeline = null, build = null;
    try { events = await get('events.json'); } catch (_) { events = []; }
    try { tools = await get('tools.json'); } catch (_) { tools = []; }
    try { build = await get('build.json'); } catch (_) { build = null; }
    try { timeline = await get('timeline.json'); } catch (_) { timeline = null; }
    try { stats = await get('stats.json'); } catch (_) { stats = null; }
    state.base = {
      events,
      tools,
      stats: stats || computeStats(events),
      timeline: timeline || buildHeatmapFromEvents(events),
      build,
    };
    return state.base;
  }

  // -------------------------------------------------------------------------
  // Public API — mirrors the FastAPI routes
  // -------------------------------------------------------------------------

  const api = {
    get mode() { return state.mode; },
    get isLive() { return state.mode === 'live'; },
    get buildInfo() { return state.base.build; },
    // For the 🌐 Server dialog: the URL the user configured (if any) and the
    // URL live mode actually talks to. `server` is '' when running same-origin
    // (e.g. desktop EXE); `configured`/`attempted` stay '' when using the
    // bundled snapshot with no explicit server.
    get configured() { return configuredServerUrl(); },
    get server() { return state.baseUrl || ''; },
    get attempted() { return state.attempted; },
    testServer: probeServer,
    clearServer() { clearConfiguredServer(); },

    async init() {
      const mode = await probe();
      if (mode === 'static') await loadStatic();
      return mode;
    },

    async health() {
      return { status: 'ok', mode: state.mode };
    },

    async getStats() {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/stats`);
        return r.json();
      }
      // Recompute rather than trusting the snapshot, so the windows stay
      // correct as time passes on a device that sat idle.
      return computeStats(state.base.events || []);
    },

    async getFeed({ days, dateFrom, dateTo, limit = 100, offset = 0 } = {}) {
      if (api.isLive) {
        const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (days) p.set('days', String(days));
        if (dateFrom) p.set('date_from', dateFrom);
        if (dateTo) p.set('date_to', dateTo);
        const r = await fetch(`${state.baseUrl}/api/feed?${p}`);
        return r.json();
      }

      let from = toStamp(dateFrom);
      let to = stampEndOfDay(dateTo);
      if (days && !from && !to) from = stampForDaysAgo(days);

      let rows = state.base.events || [];
      // Aging-snapshot guard: time-based windows are computed against "now",
      // so a snapshot that is older than the requested window would otherwise
      // render as an empty feed. If the whole bundle predates the window, widen
      // the window to the bundle's oldest event instead of showing nothing.
      if (from && rows.length) {
        const oldest = rows.reduce((m, e) => (e.verified_at < m ? e.verified_at : m), rows[0].verified_at);
        if (from > oldest) from = oldest;
      }
      if (from) rows = rows.filter((e) => e.verified_at >= from);
      if (to) rows = rows.filter((e) => e.verified_at <= to);
      rows = rows.slice().sort((a, b) => (a.verified_at < b.verified_at ? 1 : a.verified_at > b.verified_at ? -1 : 0));
      return rows.slice(offset, offset + limit);
    },

    async getTimeline(days = 30) {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/timeline?days=${days}`);
        return r.json();
      }
      const tl = state.base.timeline;
      if (!tl || !Array.isArray(tl.series)) return null;
      // The export ships one 30-day window. A shorter request is satisfied by
      // trimming the tail of the series and recomputing the peak — otherwise a
      // caller asking for 14 days would silently get a 30-day chart back.
      if (!days || days >= (tl.days || tl.series.length)) return tl;
      const series = tl.series.slice(-days);
      return {
        days: series.length,
        series,
        peak: series.reduce((m, p) => Math.max(m, p.count), 0),
      };
    },

    async getTools() {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/tools`);
        return r.json();
      }
      return state.base.tools || [];
    },

    async getToolEvents(toolId, { days, dateFrom, dateTo } = {}) {
      if (api.isLive) {
        const p = new URLSearchParams();
        if (days) p.set('days', String(days));
        if (dateFrom) p.set('date_from', dateFrom);
        if (dateTo) p.set('date_to', dateTo);
        const r = await fetch(`${state.baseUrl}/api/tools/${toolId}/events?${p}`);
        return r.json();
      }
      let from = toStamp(dateFrom);
      let to = stampEndOfDay(dateTo);
      if (days && !from && !to) from = stampForDaysAgo(days);
      const rows = (state.base.events || [])
        .filter((e) => e.technology_id === toolId);
      const oldest = rows.length
        ? rows.reduce((m, e) => (e.verified_at < m ? e.verified_at : m), rows[0].verified_at)
        : null;
      if (from && oldest && from > oldest) from = oldest;
      return rows
        .filter((e) => (!from || e.verified_at >= from) && (!to || e.verified_at <= to));
    },

    async getEvolution(toolId, days = 30) {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/tools/${toolId}/evolution?days=${days}`);
        if (!r.ok) throw new Error('evolution request failed');
        return r.json();
      }
      if (state.evoCache.has(toolId)) return state.evoCache.get(toolId);
      const res = await fetch(`${DATA_BASE}evolution/${toolId}.json`);
      if (!res.ok) throw new Error(`no evolution data for ${toolId}`);
      const evo = await res.json();
      state.evoCache.set(toolId, evo);
      return evo;
    },

    async getAlternatives(toolId) {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/tools/${toolId}/alternatives`);
        return r.json();
      }
      const tools = state.base.tools || [];
      if (typeof Matcher === 'undefined') return [];
      return Matcher.findAlternativesForTool(toolId, tools);
    },

    /** Purpose-based recommendations. Falls back to the client-side matcher. */
    async recommend({ query, userSkillLevel = null, forceFreeOnly = null } = {}) {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/recommend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            user_skill_level: userSkillLevel,
            force_free_only: forceFreeOnly,
          }),
        });
        return r.json();
      }
      if (typeof Matcher === 'undefined') {
        return { query, requirements: null, recommendations: [] };
      }
      return Matcher.matchToolsForPurpose(
        query,
        state.base.tools || [],
        userSkillLevel,
        forceFreeOnly
      );
    },

    /** Comparison matrix. Falls back to the client-side matcher. */
    async compare({ toolIds } = {}) {
      if (api.isLive) {
        const r = await fetch(`${state.baseUrl}/api/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_ids: toolIds }),
        });
        return r.json();
      }
      if (typeof Matcher === 'undefined') return { tools: [], matrix: [], verdict: '' };
      return Matcher.generateComparisonMatrix(toolIds, state.base.tools || []);
    },

    /**
     * Live feed sync. Genuinely impossible without a server, so we report that
     * rather than pretending. The UI uses `refreshSupported` to grey the button.
     */
    get refreshSupported() {
      return api.isLive;
    },

    /**
     * The hosted public backend URL baked into this build ('' before deploy).
     * The UI surfaces a one-tap "Use cloud backend" button when it's set.
     */
    get publicServer() {
      return PUBLIC_SERVER.trim();
    },

    async refreshFeed() {
      if (!api.refreshSupported) {
        return { status: 'unsupported', mode: 'static', new_events_ingested: 0 };
      }
      const r = await fetch(`${state.baseUrl}/api/refresh-feed`, { method: 'POST' });
      return r.json();
    },
  };

  if (typeof window !== 'undefined') window.API = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

if (typeof window !== 'undefined') window.API = API;
