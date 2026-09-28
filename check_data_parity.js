// Exercise the real frontend data adapter in static (no-backend) mode.
//
// `fetch` is shimmed to read from the exported frontend/data/ directory, so this
// runs the exact code path an installed PWA takes: probe /api/health (fails),
// fall back to static, filter and sort in JS. check_data_parity.py compares the
// output against the live FastAPI endpoints.
const path = require('path');
const fs = require('fs');

const frontend = path.join(__dirname, 'frontend');
const DATA = path.join(frontend, 'data');

// --- fetch shim: map URL paths to files under data/ -------------------------
let servedApi = false; // flipped by the harness to simulate a live backend
global.fetch = async (url, opts) => {
  const u = new URL(url, 'http://localhost/');
  if (u.pathname.startsWith('/api/')) {
    if (!servedApi) {
      // What a static host (GitHub Pages) does: no such endpoint.
      return { ok: false, status: 404, json: async () => ({}) };
    }
    throw new Error('live mode not exercised here');
  }
  const rel = u.pathname.replace(/^\//, '');
  const file = path.join(frontend, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const body = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

const API = require(path.join(frontend, 'pwa', 'api.js'));
const Matcher = require(path.join(frontend, 'pwa', 'matcher.js'));
global.Matcher = Matcher;

(async () => {
  const mode = await API.init();

  const WINDOWS = [
    { days: 1, limit: 200 },
    { days: 7, limit: 200 },
    { days: 30, limit: 200 },
    { limit: 100 },
    { days: 30, limit: 5, offset: 0 },
    { days: 30, limit: 5, offset: 5 },
    { dateFrom: '2026-09-10', dateTo: '2026-09-20', limit: 200 },
    { dateFrom: '2026-09-15', limit: 200 },
    { dateTo: '2026-09-05', limit: 200 },
    { dateFrom: '2026-09-01', dateTo: '2026-09-01', limit: 200 },
  ];

  const feeds = [];
  for (const w of WINDOWS) feeds.push({ w, out: await API.getFeed(w) });

  const tools = await API.getTools();
  const toolFeeds = [];
  for (const t of tools) {
    toolFeeds.push({ id: t.id, all: await API.getToolEvents(t.id) });
    toolFeeds.push({ id: t.id, w7: await API.getToolEvents(t.id, { days: 7 }) });
  }

  const evolutions = [];
  for (const t of tools) {
    evolutions.push({ id: t.id, out: await API.getEvolution(t.id, 30) });
  }

  const out = {
    mode,
    stats: await API.getStats(),
    timeline: await API.getTimeline(30),
    timeline14: await API.getTimeline(14),
    tools,
    feeds,
    toolFeeds,
    evolutions,
    alts: {},
    recs: [],
    comps: [],
    refreshSupported: API.refreshSupported,
    refresh: await API.refreshFeed(),
  };

  for (const t of tools) {
    out.alts[t.id] = (await API.getAlternatives(t.id)).map((x) => x.id);
  }
  for (const q of [
    'free tool to generate presentations',
    'open source vector database',
    'code editor',
  ]) {
    out.recs.push(await API.recommend({ query: q }));
  }
  for (let i = 0; i + 1 < tools.length; i += 3) {
    out.comps.push(await API.compare({ toolIds: [tools[i].id, tools[i + 1].id] }));
  }

  process.stdout.write(JSON.stringify(out));
})().catch((e) => {
  process.stderr.write('ADAPTER ERROR: ' + e.stack + '\n');
  process.exit(1);
});
