/**
 * TechIntel hosted API — Cloudflare Worker entrypoint.
 *
 * Serves the exact same /api/* surface as the desktop FastAPI backend, so the
 * desktop EXE, the PWA, and the Android APK can all go live against it from
 * anywhere. Seeding is automatic (bundled snapshot, only when empty), and the
 * cron trigger keeps the feed live every 15 minutes.
 */
import type { TechEvent } from './models';
import { createBackend, type D1Like, type Backend } from './db';
import {
  matchToolsForPurpose,
  generateComparisonMatrix,
  findAlternativesForTool,
} from './matcher';
import { syncAllFeedsSafely } from './ingest';
import seedData from './seed-data.json';

export interface Env {
  DB: D1Database;
}

// Lazy seed: only the first isolate to see an empty DB does the work.
let seedPromise: Promise<void> | null = null;
function ensureSeeded(db: D1Like): Promise<void> {
  if (!seedPromise) {
    seedPromise = createBackend(db).ensureSeeded(seedData).catch((err) => {
      seedPromise = null; // retry on the next request
      throw err;
    });
  }
  return seedPromise;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

function detail(status: number, message: string): Response {
  return json({ detail: message }, status);
}

function readInt(search: URLSearchParams, key: string, fallback: number): number {
  const v = search.get(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readStr(search: URLSearchParams, key: string): string | null {
  const v = search.get(key);
  return v === null || v === '' ? null : v;
}

async function handleApi(backend: Backend, path: string, method: string, request: Request): Promise<Response> {
  const segs = path.split('/').filter(Boolean); // [api, tools, <id>, evolution]
  if (segs.length < 2 || segs[0] !== 'api') return detail(404, 'Not Found');
  const resource = segs[1];

  switch (resource) {
    case 'health':
      return json({ status: 'healthy', service: 'TechIntel Platform' });

    case 'stats':
      return json(await backend.getStats());

    case 'timeline': {
      const u = new URL(request.url);
      const days = Math.min(365, Math.max(1, readInt(u.searchParams, 'days', 30)));
      return json(await backend.getTimeline(days));
    }

    case 'feed': {
      const u = new URL(request.url);
      const sp = u.searchParams;
      if (segs.length === 3) {
        const evt = await backend.getEventById(decodeURIComponent(segs[2]));
        return evt ? json(evt) : detail(404, 'Event not found');
      }
      const limit = Math.min(200, Math.max(1, readInt(sp, 'limit', 50)));
      const offset = Math.max(0, readInt(sp, 'offset', 0));
      const daysRaw = sp.has('days') ? readInt(sp, 'days', 0) : null;
      const events = await backend.getAllEvents({
        category: readStr(sp, 'category') || 'All',
        importance: readStr(sp, 'importance') || 'All',
        event_type: readStr(sp, 'event_type') || 'All',
        search: readStr(sp, 'search') ?? undefined,
        days: daysRaw !== null ? Math.min(365, Math.max(1, daysRaw)) : undefined,
        date_from: readStr(sp, 'date_from') ?? undefined,
        date_to: readStr(sp, 'date_to') ?? undefined,
        limit,
        offset,
      });
      return json(events as unknown as TechEvent[]);
    }

    case 'tools': {
      const u = new URL(request.url);
      const sp = u.searchParams;
      if (segs.length === 2) {
        return json(await backend.getAllTechnologies(readStr(sp, 'category') || 'All', readStr(sp, 'search') ?? undefined));
      }
      const toolId = decodeURIComponent(segs[2]);
      const sub = segs[3];
      if (!sub) {
        const t = await backend.getTechnologyById(toolId);
        return t ? json(t) : detail(404, 'Technology not found');
      }
      if (sub === 'events') {
        const daysRaw = sp.has('days') ? readInt(sp, 'days', 0) : null;
        let dateFrom = readStr(sp, 'date_from') ?? undefined;
        let dateTo = readStr(sp, 'date_to') ?? undefined;
        if (daysRaw && !(dateFrom || dateTo)) {
          dateFrom = daysAgoString(daysRaw);
        }
        if (dateFrom && dateFrom.length === 10) dateFrom = `${dateFrom} 00:00 UTC`;
        if (dateTo && dateTo.length === 10) dateTo = `${dateTo} 23:59 UTC`;
        return json(await backend.getEventsForTechnology(toolId, dateFrom, dateTo));
      }
      if (sub === 'evolution') {
        const days = Math.min(365, Math.max(1, readInt(sp, 'days', 30)));
        const result = await backend.getTechnologyEvolution(toolId, days);
        return 'error' in result ? detail(404, result.error) : json(result);
      }
      if (sub === 'alternatives') {
        return json(await findAlternativesForTool(backend, toolId));
      }
      return detail(404, 'Not Found');
    }

    case 'recommend': {
      if (method !== 'POST') return detail(405, 'Method Not Allowed');
      const body = await request.json().catch(() => null) as Record<string, any> | null;
      const query = typeof body?.query === 'string' ? body.query : '';
      if (!query.trim()) return detail(400, 'Query cannot be empty');
      return json(await matchToolsForPurpose(backend, query, body?.user_skill_level ?? null, body?.force_free_only ?? null));
    }

    case 'compare': {
      if (method !== 'POST') return detail(405, 'Method Not Allowed');
      const body = await request.json().catch(() => null) as Record<string, any> | null;
      const toolIds = Array.isArray(body?.tool_ids) ? body.tool_ids.filter((x: unknown) => typeof x === 'string') : [];
      if (toolIds.length === 0) return detail(400, 'tool_ids list cannot be empty');
      return json(await generateComparisonMatrix(backend, toolIds));
    }

    case 'refresh-feed': {
      if (method !== 'POST') return detail(405, 'Method Not Allowed');
      const newCount = await syncAllFeedsSafely(backend);
      await backend.setLastSync();
      return json({ status: 'success', new_events_ingested: newCount });
    }

    default:
      return detail(404, 'Not Found');
  }
}

function daysAgoString(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      await ensureSeeded(env.DB as D1Like);
      const backend = createBackend(env.DB as D1Like);
      return await handleApi(backend, url.pathname, request.method, request);
    } catch (err) {
      console.error('techintel-api error', err);
      return detail(500, 'Internal Server Error');
    }
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    // Cron beat (every 15 min): keep the stored feed current.
    const backend = createBackend(env.DB as D1Like);
    try {
      const newCount = await syncAllFeedsSafely(backend);
      await backend.setLastSync();
      console.log(`cron sync ingested ${newCount} new event(s)`);
    } catch (err) {
      console.error('cron sync failed', err);
    }
  },
};