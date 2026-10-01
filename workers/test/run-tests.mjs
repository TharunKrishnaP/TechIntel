#!/usr/bin/env node
/**
 * Headless test of the ported backend against a REAL SQLite database
 * (node:sqlite) via a D1-compatible adapter. This validates the exact query
 * and matcher code the Worker runs, without needing a Cloudflare account.
 *
 * Run:  npm test   (or)  node test/run-tests.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');
const seedData = JSON.parse(readFileSync(join(root, 'src', 'seed-data.json'), 'utf8'));

const { createBackend } = await import('../dist/db.js');
const { matchToolsForPurpose, generateComparisonMatrix, findAlternativesForTool, extractRequirementsFromQuery } = await import('../dist/matcher.js');
const { classifyEventTypeAndImportance, determineSourceTier, extractKeyTokens } = await import('../dist/ingest.js');

function makeD1(sqlite) {
  const prepare = (sql) => {
    let stmt;
    try { stmt = sqlite.prepare(sql); } catch (e) {
      throw new Error(`SQL prepare failed: ${sql}\n  => ${e.message}`);
    }
    const statement = (values) => ({
      all: async () => ({ results: stmt.all(...values) }),
      first: async () => { const r = stmt.get(...values); return r === undefined ? null : r; },
      run: async () => { const m = stmt.run(...values); return { meta: { changes: m.changes } }; },
      bind: (...v) => statement(v),
    });
    return statement([]);
  };
  return { prepare };
}

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const db = new DatabaseSync(':memory:');
db.exec(schema);
const backend = createBackend(makeD1(db));

// ---- Seeding ----
await backend.ensureSeeded(seedData);
console.log('seeded events =', seedData.events.length, '| techs =', seedData.technologies.length);
ok(seedData.events.length === 82, 'seed data has 82 events');
ok(seedData.technologies.length === 10, 'seed data has 10 technologies');
await backend.ensureSeeded(seedData); // second call must be a no-op
const countAfter = await backend.getStats();
ok(countAfter.total_events === 82, 'second seed call did not duplicate events (still 82)');

// ---- Feed ----
const all = await backend.getAllEvents({ limit: 200 });
ok(all.length === 82, 'feed returns all 82 events (limit 200)');
const def = await backend.getAllEvents();
ok(def.length === 50, 'default feed limit is 50 (matches FastAPI)');
const sorted = all.every((e, i) => i === 0 || all[i - 1].verified_at >= e.verified_at);
ok(sorted, 'feed is ordered by verified_at DESC');
const lim = await backend.getAllEvents({ limit: 20, offset: 10 });
ok(lim.length === 20, 'limit/offset respected');

const sec = await backend.getAllEvents({ category: 'Security' });
ok(sec.length >= 1 && sec.every((e) => e.category === 'Security'), 'category filter works');
const ai = await backend.getAllEvents({ category: 'AI/ML' });
ok(ai.length === 33, 'AI/ML category count is 33 (matches canonical)');
const imp = await backend.getAllEvents({ importance: 'critical' });
ok(imp.length >= 1 && imp.every((e) => e.importance === 'critical'), 'importance filter works');
const searched = await backend.getAllEvents({ search: 'OpenSSL' });
ok(searched.length >= 1 && searched.some((e) => /openssl/i.test(e.title + e.summary_tldr)), 'search filter works');

// ---- Stats ----
const stats = await backend.getStats();
ok(stats.total_events === 82, 'stats.total_events = 82');
ok(stats.critical_security_count === 1, 'stats.critical_security_count = 1');
ok(stats.ai_updates_count === 33, 'stats.ai_updates_count = 33');
ok(stats.verified_sources_count >= 82, 'verified_sources_count >= total');
ok(typeof stats.last_sync === 'string' && stats.last_sync.length > 0, 'last_sync present');

// ---- Timeline ----
const tl = await backend.getTimeline(30);
ok(tl.series.length === 30, 'timeline has 30 days');
ok(tl.days === 30 && tl.peak >= 1, 'timeline day/peak sane');
const tl7 = await backend.getTimeline(7);
ok(tl7.series.length === 7, 'timeline 7-day window');
ok(tl7.series.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date)), 'timeline dates formatted');

// ---- Events / Technologies by id ----
const evt = await backend.getEventById(all[0].id);
ok(evt && evt.id === all[0].id, 'getEventById round-trips');
ok(await backend.getEventById('does-not-exist') === null, 'getEventById 404 null');
const py = await backend.getTechnologyById('python');
ok(py && py.name === 'Python', 'getTechnologyById python');
ok(py.recent_events_count >= 1, 'recent_events_count populated');
ok(await backend.getTechnologyById('nope') === null, 'getTechnologyById 404 null');
ok(Array.isArray(py.strengths) && Array.isArray(py.limitations), 'json columns parsed');

// ---- Evolution ----
const evo = await backend.getTechnologyEvolution('python', 30);
ok(!('error' in evo), 'python evolution exists');
ok(evo.technology.name === 'Python' && evo.technology.current_version === py.current_version, 'evolution head');
ok(evo.event_breakdown.major_upgrade === 3 && evo.event_breakdown.security_patch === 3, 'python breakdown 3/3 (+3) matches canonical');
ok(evo.version_timeline.length >= 8, 'python version trail populated');
const trailVersions = evo.version_timeline.map((v) => v.version);
ok(trailVersions[0].includes('3.13.0-rc1') || trailVersions[trailVersions.length - 1].includes('3.10.0'), 'trail edges plausible');
const asc = evo.version_timeline.every((v, i) => i === 0 || evo.version_timeline[i - 1].date <= v.date);
ok(asc, 'version timeline sorted oldest->newest');
ok(evo.recent_events.length >= 1, 'recent_events populated');
ok(await backend.getTechnologyEvolution('nope', 30).then((r) => r.error === 'Technology not found'), 'evolution 404 shape');

const evoQ = await backend.getTechnologyEvolution('qdrant', 30);
ok(evoQ.event_breakdown.major_upgrade >= 3 && evoQ.event_breakdown.feature_update >= 3, 'qdrant evolution breakdown sane');

// ---- Recommend ----
const req = extractRequirementsFromQuery('I need a free AI tool to generate presentations');
ok(req.category === 'AI/ML' && req.budget === 'Free', 'requirements extraction');
const rec = await matchToolsForPurpose(backend, 'I need a free AI tool to generate presentations');
ok(rec.recommendations.length === 6, 'recommend -> top 6');
ok(rec.recommendations[0].technology.name === 'Gamma App', 'top pick is Gamma App');
ok(rec.recommendations[0].suitability_score === 80, 'Gamma App scores 80');
ok(rec.recommendations[0].why_this_tool.includes('Recommended (80% match)'), 'why_this_tool text');
ok(rec.requirements.purpose && rec.requirements.key_features.length > 0, 'requirements carried through');
const sortedRecs = rec.recommendations.every((r, i) => i === 0 || rec.recommendations[i - 1].suitability_score >= r.suitability_score);
ok(sortedRecs, 'recommendations sorted desc');

// ---- Compare ----
const cmp = await generateComparisonMatrix(backend, ['gamma-app', 'beautiful-ai', 'slidesai']);
ok(cmp.tools.length === 3, 'compare resolves 3 tools');
ok(cmp.matrix.length === 11, 'compare matrix has 11 criteria');
ok(cmp.matrix[0].criterion === 'Current Version' && cmp.matrix[0].values['Gamma App'] === 'v2.8', 'matrix criterion/vals');
ok(cmp.verdict.includes('Gamma App') && cmp.verdict.includes('SlidesAI'), 'verdict cites tools');
ok(cmp.matrix.some((c) => c.criterion === 'Free Tier Available?' && c.values['Beautiful.ai'] === '❌ No (Paid / Trial only)'), 'boolean column emoji');
const emptyCmp = await generateComparisonMatrix(backend, []);
ok(emptyCmp.verdict === 'No valid tools selected.', 'empty compare verdict');

// ---- Alternatives ----
const alts = await findAlternativesForTool(backend, 'gamma-app');
ok(alts.some((t) => t.id === 'beautiful-ai'), 'alternatives includes beautiful-ai');
ok(alts.every((t) => t.id !== 'gamma-app'), 'alternatives excludes self');
ok((await findAlternativesForTool(backend, 'nope')).length === 0, 'alternatives unknown -> []');

// ---- Ingest pure functions (no network) ----
ok(JSON.stringify(classifyEventTypeAndImportance('CVE-2026-0000 buffer overflow', 'security advisory'))
  === JSON.stringify(['security_patch', 'critical', 'Security']), 'classify security');
ok(JSON.stringify(classifyEventTypeAndImportance('Anthropic ships Claude Sonnet 4.6', 'frontier model'))
  === JSON.stringify(['ai_model', 'major', 'AI/ML']), 'classify ai_model');
ok(JSON.stringify(classifyEventTypeAndImportance('Qdrant 1.12 adds vector storage', 'database'))
  === JSON.stringify(['feature_update', 'significant', 'Databases']), 'classify database');
ok(classifyEventTypeAndImportance('Some random update', 'misc') [0] === 'feature_update', 'classify fallback');
const [t1, l1] = determineSourceTier('https://github.com/vercel/next.js/releases/tag/v15.0.1', 'GitHub Releases - Next.js');
ok(t1 === 1 && l1 === 'Tier 1 - GitHub Release', 'github tier 1');
const t2 = determineSourceTier('https://news.ycombinator.com/item?id=1', 'Hacker News');
ok(t2[0] === 3, 'hn tier 3');
ok(extractKeyTokens('Python 3.13 free-threaded release').has('python'), 'token extraction');

console.log(`\nALL WORKER BACKEND TESTS PASSED (${passed} assertions + structural checks)`);