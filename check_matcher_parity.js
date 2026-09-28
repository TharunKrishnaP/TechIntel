// Verify the JS matcher port matches the Python matcher exactly.
// Run from the repo root: node check_matcher_parity.js
//
// Dumps JSON to stdout; check_matcher_parity.py runs both implementations over
// the same inputs and asserts equality.
const path = require('path');
const fs = require('fs');

const frontend = path.join(__dirname, 'frontend');
const Matcher = require(path.join(frontend, 'pwa', 'matcher.js'));

const tools = JSON.parse(
  fs.readFileSync(path.join(frontend, 'data', 'tools.json'), 'utf8')
);

const QUERIES = [
  'I need a free tool to generate presentations',
  'best open source vector database for rag',
  'something for code autocomplete',
  'modern frontend ui framework',
  'asdfqwerzxcv',
  'free no cost design tool',
  'api sdk for developer integration',
  'beginner friendly easy tool',
  'advanced expert infrastructure',
];

const SKILLS = [null, 'Beginner', 'Intermediate', 'Advanced'];
const FREE = [null, true];

const results = [];
for (const q of QUERIES) {
  for (const s of SKILLS) {
    for (const f of FREE) {
      results.push({
        query: q,
        skill: s,
        free: f,
        out: Matcher.matchToolsForPurpose(q, tools, s, f),
      });
    }
  }
}

// Compare + alternatives sweeps
const ids = tools.map((t) => t.id);
const comparisons = [];
for (let i = 0; i + 1 < ids.length; i++) {
  comparisons.push({
    ids: [ids[i], ids[i + 1]],
    out: Matcher.generateComparisonMatrix([ids[i], ids[i + 1]], tools),
  });
}
const triples = [ids.slice(0, 3), ids.slice(3, 6), ids.slice(6, 9)];
for (const t of triples) {
  comparisons.push({ ids: t, out: Matcher.generateComparisonMatrix(t, tools) });
}
for (const id of ids) {
  comparisons.push({ id, alts: Matcher.findAlternativesForTool(id, tools) });
}

process.stdout.write(JSON.stringify({ results, comparisons }, null, 0));
