#!/usr/bin/env node
/**
 * Generates the Worker's seed bundle from the repo's canonical static data:
 *   - workers/src/seed-data.json  -> bundled into the Worker for lazy auto-seed
 *   - workers/seed.sql            -> optional `wrangler d1 execute --file=` path
 *
 * Run from anywhere:  node scripts/generate-seed.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const dataDir = join(repoRoot, 'frontend', 'data');
const outDir = join(here, '..', 'src');

const events = JSON.parse(readFileSync(join(dataDir, 'events.json'), 'utf8'));
const technologies = JSON.parse(readFileSync(join(dataDir, 'tools.json'), 'utf8'));

function utcStamp() {
  const d = new Date();
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
const generatedAt = utcStamp();

const seed = { generated_at: generatedAt, technologies, events };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'seed-data.json'), JSON.stringify(seed, null, 0) + '\n');

/* ----- SQL variant for `wrangler d1 execute` ----- */
const sql = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const techCols = [
  'id', 'name', 'tagline', 'category', 'developer', 'license', 'pricing_model',
  'has_free_tier', 'pricing_details', 'has_api', 'current_version',
  'strengths', 'limitations', 'platforms', 'official_url', 'docs_url', 'repo_url', 'last_verified_at',
];
const eventCols = [
  'id', 'technology_id', 'technology_name', 'title', 'category', 'event_type', 'importance',
  'summary_tldr', 'what_changed', 'explanation_technical', 'explanation_simple',
  'impact_audiences', 'impact_summary', 'primary_source_tier', 'sources_count',
  'sources', 'verified_at', 'is_confirmed',
];

const techInserts = technologies.map((t) =>
  `INSERT OR REPLACE INTO technologies (${techCols.join(', ')}) VALUES (${techCols.map((c) => sql(t[c])).join(', ')});`);
const eventInserts = events.map((e) =>
  `INSERT OR REPLACE INTO events (${eventCols.join(', ')}) VALUES (${eventCols.map((c) => sql(e[c])).join(', ')});`);

const sqlFile = `-- TechIntel canonical seed (${generatedAt}). Regenerate: node scripts/generate-seed.mjs
-- Load into D1:  npx wrangler d1 execute techintel-db --remote --file=seed.sql
BEGIN;
${techInserts.join('\n')}
${eventInserts.join('\n')}
INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('last_sync_at', '${generatedAt}');
COMMIT;
`;
writeFileSync(join(here, '..', 'seed.sql'), sqlFile);

console.log(`seed-data.json: ${join(outDir, 'seed-data.json')} (${events.length} events, ${technologies.length} technologies)`);
console.log(`seed.sql       : ${join(here, '..', 'seed.sql')}`);