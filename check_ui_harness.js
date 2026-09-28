// Headless UI harness: run the real frontend/app.js against a minimal DOM shim.
//
// The parity tests prove the data layer is correct; this proves the UI actually
// consumes it. It loads the real index.html, the real pwa/*.js and the real
// app.js — no app code is stubbed — then inspects the resulting DOM.
//
// Two modes are exercised:
//   live   — fetch() proxies to the running FastAPI server
//   static — fetch() serves files from frontend/, so /api/health 404s and the
//            adapter must fall back to the bundled snapshot
//
// Usage: node check_ui_harness.js <mode>   where mode is live|static
const fs = require('fs');
const path = require('path');

const MODE = process.argv[2] || 'static';
const ORIGIN = 'http://127.0.0.1:8000';
const frontend = path.join(__dirname, 'frontend');

// ---------------------------------------------------------------------------
// DOM shim
// ---------------------------------------------------------------------------
const listeners = new Map();

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._listeners = {};
    // Real object, not a no-op: app.js toggles style.display on modals and reads
    // it back later (e.g. dropping a stale evolution fetch), and a throwaway
    // Proxy breaks that round-trip.
    this.style = {};
    this.dataset = {};
    this.classList = {
      _s: new Set(),
      add: (...c) => c.forEach((x) => this.classList._s.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._s.delete(x)),
      toggle: (c, on) => (on ? this.classList._s.add(c) : this.classList._s.delete(c)),
      contains: (c) => this.classList._s.has(c),
    };
    this._html = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList._s].join(' '); }
  get textContent() {
    if (this._html) return this._html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return this._text || '';
  }
  set textContent(v) { this._text = String(v); this._html = ''; }
  appendChild(c) { this.children.push(c); c.parentNode = this; this._html += c.outerHTML || ''; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  dispatchEvent(e) {
    (this._listeners[e.type] || []).forEach((fn) => fn.call(this, e));
    return true;
  }
  click() { return this.dispatchEvent({ type: 'click', target: this, preventDefault() {} }); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 1200, height: 800, bottom: 800, right: 1200 }; }
  getContext() {
    // Minimal 2D context: the aurora/radar animation is pure decoration, so
    // every call is a no-op that just needs to exist.
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 10 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
      },
      { get: (t, k) => (k in t ? t[k] : noop) }
    );
  }
  get width() { return 1200; }
  set width(_) {}
  get height() { return 800; }
  set height(_) {}
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
}

const byId = new Map();
const doc = {
  _listeners: {},
  body: new El('body'),
  documentElement: new El('html'),
  getElementById: (id) => {
    if (!byId.has(id)) byId.set(id, new El('div', id));
    return byId.get(id);
  },
  createElement: (t) => new El(t),
  addEventListener(t, fn) { (doc._listeners[t] ||= []).push(fn); },
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
};

// Collect every id= present in index.html so the shim returns real elements for
// the ones app.js actually reaches for.
const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
for (const m of html.matchAll(/id="([^"]+)"/g)) {
  byId.set(m[1], new El('div', m[1]));
}

// A real <select> reports the value of its first <option> (or the selected one).
// The shim defaults value to '', which would make category filters match nothing
// and hide a real bug behind a fake one — so mirror the browser's behaviour.
for (const m of html.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  const [, id, inner] = m;
  const el = byId.get(id);
  if (!el) continue;
  const opts = [...inner.matchAll(/<option([^>]*)>/g)];
  let v = '';
  for (const [, attrs] of opts) {
    if (/\bselected\b/.test(attrs)) {
      v = (attrs.match(/value="([^"]*)"/) || [, ''])[1];
      break;
    }
    if (v === '') v = (attrs.match(/value="([^"]*)"/) || [, ''])[1];
  }
  el.value = v;
  el._options = opts.map(([, a]) => (a.match(/value="([^"]*)"/) || [, ''])[1]);
}

// ---------------------------------------------------------------------------
// fetch: live -> real server, static -> files under frontend/
// ---------------------------------------------------------------------------
let fetchLog = [];
const nodeFetch = global.fetch;

if (MODE === 'live') {
  global.fetch = async (url, opts) => {
    fetchLog.push(String(url));
    const abs = url.startsWith('http') ? url : new URL(url, ORIGIN + '/').href;
    return nodeFetch(abs, opts);
  };
} else {
  global.fetch = async (url) => {
    const u = new URL(String(url), 'http://localhost/');
    fetchLog.push(String(url));
    if (u.pathname.startsWith('/api/')) return { ok: false, status: 404, json: async () => ({}) };
    const file = path.join(frontend, u.pathname.replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    const body = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
}

// ---------------------------------------------------------------------------
// window / navigator / localStorage shims
// ---------------------------------------------------------------------------
const store = new Map();
let installed = false;
const swCalls = [];

global.window = {
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  // Real browsers expose navigator on window; app.js relies on that.
  // Assigned properly once `navigator` is defined below.
  navigator: null,
  addEventListener(t, fn) { (this._l ||= {}); (this._l[t] ||= []).push(fn); },
  removeEventListener() {},
  matchMedia: (q) => ({ matches: /standalone/.test(q) ? false : true, addListener() {}, removeListener() {} }),
  location: { href: 'http://127.0.0.1:8000/', origin: ORIGIN, hash: '' },
  isSecureContext: true,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
  cancelAnimationFrame: () => {},
  scrollTo() {},
};

global.document = doc;
global.localStorage = global.window.localStorage;
global.getComputedStyle = global.window.getComputedStyle;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;

// Node >= 21 exposes a read-only `navigator` global, so a plain assignment is
// silently dropped and app.js's `'serviceWorker' in navigator` check fails.
// defineProperty is required to actually install the stub.
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'node-harness',
    onLine: true,
    serviceWorker: {
      register: async (url) => {
        swCalls.push(url);
        return {
          installing: null,
          addEventListener() {},
          update() {},
        };
      },
      controller: null,
      ready: Promise.resolve(),
    },
  },
  configurable: true,
  writable: true,
});
global.window.navigator = global.navigator;
// Node ships a real AbortController/AbortSignal; the adapter's 1.5s probe uses
// them, so leave the native implementation in place rather than stubbing it.
global.HTMLElement = El;
global.Node = class {};
global.Event = class { constructor(t) { this.type = t; } preventDefault() {} stopPropagation() {} };
global.CSS = { supports: () => false };

// ---------------------------------------------------------------------------
// Load the real scripts in the same order index.html does
// ---------------------------------------------------------------------------
const vm = require('vm');
const ctx = vm.createContext(global);
for (const f of ['pwa/matcher.js', 'pwa/api.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(frontend, f), 'utf8'), ctx, { filename: f });
}

// Fire DOMContentLoaded, then let the boot promises settle.
function finish(out) {
  // The radar animation keeps scheduling timers, so exit explicitly rather than
  // waiting for the event loop to drain.
  process.stdout.write(JSON.stringify(out, null, 1));
  process.exit(0);
}

function fail(where, e) {
  process.stdout.write(
    JSON.stringify({ harnessError: where, message: String(e && e.message), stack: String(e && e.stack).split('\n').slice(0, 6) }, null, 1)
  );
  process.exit(1);
}

process.on('uncaughtException', (e) => fail('uncaught', e));

try {
  doc._listeners['DOMContentLoaded']?.forEach((fn) => fn({ type: 'DOMContentLoaded' }));
  // registerServiceWorker() defers to window 'load', as browsers require.
  global.window._l?.load?.forEach((fn) => fn({ type: 'load' }));
} catch (e) {
  fail('DOMContentLoaded', e);
}

setTimeout(() => {
  let out;
  try {
    const t = (id) => byId.get(id);
    const text = (id) => (t(id) ? t(id).textContent : '');
    const htmlOf = (id) => (t(id) ? t(id).innerHTML : '');

    out = {
      mode: global.API?.mode,
      isLive: global.API?.isLive,
      refreshSupported: global.API?.refreshSupported,
      buildGeneratedAt: global.API?.buildInfo?.generated_at,
      modeChipHidden: t('modeChip')?.hidden,
      modeChipTitle: t('modeChip')?.title,
      swRegistered: swCalls,
      swRegisteredAny: swCalls.length > 0,
      hasServiceWorkerApi: 'serviceWorker' in global.navigator,
      isSecureContext: global.window.isSecureContext,
      loadListeners: (global.window._l?.load || []).length,
      installBtnHidden: t('btnInstall')?.hidden,
      stats: {
        total: text('statTotalEvents'),
        newToday: text('statNewToday'),
        newWeek: text('statNewWeek'),
        newMonth: text('statNewMonth'),
        sec: text('statSecEvents'),
        ai: text('statAiEvents'),
        badge: text('newCountBadge'),
      },
      feedSummary: text('feedSummaryText'),
      eventCards: (htmlOf('eventsContainer').match(/class="event-card/g) || []).length,
      feedHistoryButtons: (htmlOf('eventsContainer').match(/evolution-trigger/g) || []).length,
      ageBadges: (htmlOf('eventsContainer').match(/age-badge/g) || []).length,
      heatCells: (htmlOf('activityHeatmap').match(/heat-bar-cell/g) || []).length,
      heatLegend: (htmlOf('heatmapLegend') || '').length,
      apiCalls: [...new Set(fetchLog.map((u) => u.split('?')[0]))],
    };

    // Exercise Find-a-Tool: POST /api/recommend in live, client matcher in static.
    const finder = t('toolFinderInput');
    finder.value = 'free tool to generate presentations';
    t('btnFindTools').click();
  } catch (e) {
    return fail('inspect', e);
  }

  setTimeout(() => {
    try {
      const htmlOf = (id) => byId.get(id)?.innerHTML || '';
      out.recommendHtml = htmlOf('recommendationsContainer').length;
      out.recommendMentionsTools = /Gamma|Beautiful|SlidesAI|rec/i.test(htmlOf('recommendationsContainer'));
      // Switch to the directory tab so its render path runs too.
      try { global.switchTab?.('directory'); } catch (_) {}
      out.dirCards = (htmlOf('directoryContainer').match(/class="dir-card/g) || []).length;
      out.dirHistoryButtons = (htmlOf('directoryContainer').match(/btn-evolution/g) || []).length;
      out.compareCheckboxes = (htmlOf('compareCheckboxGroup').match(/type="checkbox"/g) || []).length;

      // Open the evolution modal for a known tool (the Timeline/History feature).
      // app.js registers these on window; call them the way the DOM does.
      try {
        global.window.openEvolutionModal?.('python');
      } catch (e) {
        out.evolutionError = String(e.message);
      }
    } catch (e) {
      return fail('post-inspect', e);
    }

    // renderEvolutionContent is async (evolution data resolves), so wait for it
    // before inspecting the modal.
    setTimeout(() => {
      try {
        const h = (id) => byId.get(id)?.innerHTML || '';
        out.evolution = {
          title: byId.get('evolutionTitle')?.textContent || '',
          badge: byId.get('evolutionBadge')?.textContent || '',
          summary: (h('evolutionSummary').match(/evo-stat/g) || []).length,
          versionTrailEntries: (h('versionTrail').match(/trail-step/g) || []).length,
          breakdownBars: (h('evolutionBreakdown').match(/bd-fill/g) || []).length,
          breakdownRows: (h('evolutionBreakdown').match(/bd-row/g) || []).length,
          timelineItems: (h('evolutionTimeline').match(/evo-event-row/g) || []).length,
          mentionsVersions: /3\.13|3\.12|3\.11/.test(h('versionTrail')),
          contentVisible: byId.get('evolutionContent')?.hidden === false &&
            (byId.get('evolutionContent')?.style?.display || '') !== 'none',
          body: (h('evolutionSummary') + h('versionTrail')).slice(0, 120),
        };
        finish(out);
      } catch (e) {
        fail('evolution-inspect', e);
      }
    }, 900);
  }, 1500);
}, 2000);

