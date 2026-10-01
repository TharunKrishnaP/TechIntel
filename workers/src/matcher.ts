/**
 * Purpose-based tool finder, comparison matrix, alternatives — a faithful port
 * of backend/services/matcher.py + backend/pipeline/ai_engine.py.
 *
 * The Gemini "refine" branch is intentionally dropped: the hosted Worker uses
 * the same deterministic heuristics the desktop app falls back to when no
 * GEMINI_API_KEY is set, so behavior is identical and requires no LLM keys.
 */
import type {
  Technology,
  ExtractedRequirement,
  ToolRecommendation,
  RecommendationResponse,
  ComparisonResponse,
  ComparisonCriterion,
} from './models';
import type { Backend } from './db';

export function extractRequirementsFromQuery(
  query: string,
  userSkillLevel?: string | null,
  forceFreeOnly?: boolean | null,
): ExtractedRequirement {
  const q = query.toLowerCase();

  let purpose = query;
  let category = 'General';
  let skill = userSkillLevel || 'Any';
  let budget = forceFreeOnly ? 'Free' : 'Any';
  let openSource = false;
  let apiReq = false;
  const keyFeatures: string[] = [];

  if (['presentation', 'slides', 'deck', 'powerpoint', 'keynote'].some((k) => q.includes(k))) {
    purpose = 'Generate and design presentations';
    category = 'AI/ML';
    keyFeatures.push('slide design', 'templates', 'export to pptx/pdf');
  } else if (['code', 'coding', 'developer', 'ide', 'editor', 'autocomplete'].some((k) => q.includes(k))) {
    purpose = 'AI code assistance and editing';
    category = 'DevTools';
    keyFeatures.push('code completions', 'multi-file edits', 'syntax support');
  } else if (['vector', 'embeddings', 'database', 'rag', 'sql', 'postgres'].some((k) => q.includes(k))) {
    purpose = 'Vector search and data storage';
    category = 'Databases';
    keyFeatures.push('vector search', 'indexing', 'fast querying');
  } else if (['website', 'web app', 'frontend', 'ui'].some((k) => q.includes(k))) {
    purpose = 'Web application development';
    category = 'Frontend';
    keyFeatures.push('responsive layout', 'modern frameworks');
  }

  if (forceFreeOnly || ['free', 'no cost', '0$', '$0', 'without paying'].some((k) => q.includes(k))) {
    budget = 'Free';
  }
  if (['open source', 'open-source', 'oss', 'self-host', 'github'].some((k) => q.includes(k))) {
    openSource = true;
  }
  if (['api', 'sdk', 'programmatic', 'endpoint', 'rest'].some((k) => q.includes(k))) {
    apiReq = true;
  }
  if (!userSkillLevel) {
    if (['no coding', 'beginner', 'without knowing code', 'easy', 'non-technical'].some((k) => q.includes(k))) {
      skill = 'Beginner';
    } else if (['advanced', 'expert', 'infrastructure', 'architect'].some((k) => q.includes(k))) {
      skill = 'Advanced';
    }
  }

  return {
    purpose,
    category,
    skill_level: skill,
    budget,
    open_source_preferred: openSource,
    api_required: apiReq,
    key_features: keyFeatures,
  };
}

function generateWhyThisTool(tech: Technology, req: ExtractedRequirement, score: number): string {
  const reasons: string[] = [];

  if (req.budget === 'Free' && tech.has_free_tier) {
    reasons.push(`provides a functional ${tech.pricing_model.toLowerCase()} tier (${tech.pricing_details.split(';')[0]})`);
  } else if (tech.pricing_model === 'Open Source') {
    reasons.push(`is 100% open source under the ${tech.license} license with no vendor lock-in`);
  }

  if (req.open_source_preferred && tech.pricing_model === 'Open Source') {
    reasons.push('is completely open source and self-hostable');
  }

  if (req.api_required && tech.has_api) {
    reasons.push('includes a documented API for developer integration');
  }

  if (tech.strengths.length > 0) {
    reasons.push(`excels at ${tech.strengths[0].toLowerCase()}`);
  }

  if (reasons.length === 0) {
    reasons.push(`is a strong candidate in ${tech.category} rated at ${tech.current_version}`);
  }

  let explanation = `Recommended (${score}% match) because it ` + reasons.join(', and ') + '.';

  if (tech.limitations.length > 0) {
    explanation += ` Note: Consider that it has ${tech.limitations[0].toLowerCase()}.`;
  }

  return explanation;
}

function evaluateToolSuitability(tech: Technology, req: ExtractedRequirement): ToolRecommendation {
  let score = 0;
  const matchReasons: string[] = [];
  const tradeoffs: string[] = [];
  const scoreBreakdown: Record<string, number> = {};

  // 1. Category alignment (up to 30 pts)
  let catPoints = 0;
  const techCat = tech.category.toLowerCase();
  const reqCat = req.category.toLowerCase();
  if (techCat.includes(reqCat) || reqCat.includes(techCat)) {
    catPoints = 30;
    matchReasons.push(`Direct match in ${tech.category} category`);
  } else if (req.category === 'General') {
    catPoints = 15;
  }
  score += catPoints;
  scoreBreakdown['Category Fit'] = catPoints;

  // 2. Budget & pricing alignment (up to 30 pts)
  let budgetPoints = 0;
  if (req.budget === 'Free') {
    if (tech.pricing_model === 'Open Source' || (tech.has_free_tier && tech.pricing_model === 'Free')) {
      budgetPoints = 30;
      matchReasons.push('100% Free to use forever');
    } else if (tech.has_free_tier) {
      budgetPoints = 25;
      matchReasons.push(`Has functional free tier: ${tech.pricing_details.split(';')[0]}`);
    } else {
      budgetPoints = 0;
      tradeoffs.push('No permanent free tier (paid subscription required)');
    }
  } else {
    budgetPoints = 20;
    matchReasons.push(`Flexible pricing model: ${tech.pricing_model}`);
  }
  score += budgetPoints;
  scoreBreakdown['Cost & Pricing'] = budgetPoints;

  // 3. Purpose & keyword relevance (up to 25 pts)
  let kwPoints = 0;
  const targetText = (tech.name + ' ' + tech.tagline + ' ' + tech.strengths.join(' ')).toLowerCase();
  const matchedFeatures: string[] = [];
  for (const feat of req.key_features) {
    if (targetText.includes(feat.toLowerCase())) {
      matchedFeatures.push(feat);
      kwPoints += 8;
    }
  }
  for (const token of req.purpose.toLowerCase().split(' ')) {
    if (token.length > 3 && targetText.includes(token)) kwPoints += 4;
  }
  kwPoints = Math.min(25, kwPoints);
  if (matchedFeatures.length > 0) {
    matchReasons.push(`Supports key requirements: ${matchedFeatures.slice(0, 3).join(', ')}`);
  } else if (kwPoints > 0) {
    matchReasons.push('Capabilities align with described purpose');
  }
  score += kwPoints;
  scoreBreakdown['Feature Alignment'] = kwPoints;

  // 4. Open-source preference (up to 15 pts)
  let ossPoints = 0;
  if (req.open_source_preferred) {
    if (tech.pricing_model.toLowerCase().includes('open source') || tech.license.toLowerCase().includes('mit') || tech.license.toLowerCase().includes('apache')) {
      ossPoints = 15;
      matchReasons.push(`Fully open-source codebase under ${tech.license}`);
    } else {
      tradeoffs.push('Proprietary/closed-source software');
    }
  } else {
    ossPoints = tech.pricing_model === 'Open Source' ? 10 : 5;
  }
  score += ossPoints;
  scoreBreakdown['License & Openness'] = ossPoints;

  const totalScore = Math.min(100, Math.max(10, score));

  if (tech.limitations.length > 0) tradeoffs.push(...tech.limitations.slice(0, 2));

  return {
    technology: tech,
    suitability_score: totalScore,
    match_reasons: matchReasons,
    why_this_tool: generateWhyThisTool(tech, req, totalScore),
    tradeoffs: tradeoffs,
    score_breakdown: scoreBreakdown,
  };
}

export async function matchToolsForPurpose(
  backend: Backend,
  query: string,
  userSkillLevel?: string | null,
  forceFreeOnly?: boolean | null,
): Promise<RecommendationResponse> {
  const requirements = extractRequirementsFromQuery(query, userSkillLevel, forceFreeOnly);
  const allTools = await backend.getAllTechnologies();

  const recommendations: ToolRecommendation[] = [];
  for (const tech of allTools) {
    const rec = evaluateToolSuitability(tech, requirements);
    if (rec.suitability_score >= 35) recommendations.push(rec);
  }
  recommendations.sort((a, b) => b.suitability_score - a.suitability_score);

  return {
    query,
    requirements,
    recommendations: recommendations.slice(0, 6),
  };
}

export async function generateComparisonMatrix(backend: Backend, toolIds: string[]): Promise<ComparisonResponse> {
  const tools: Technology[] = [];
  for (const tid of toolIds) {
    const t = await backend.getTechnologyById(tid);
    if (t) tools.push(t);
  }
  if (tools.length === 0) {
    return { tools: [], matrix: [], verdict: 'No valid tools selected.' };
  }

  const yes = '✅ Yes';
  const no = '❌ No (Paid / Trial only)';
  const apiYes = '✅ Documented API';
  const apiNo = '❌ No Public API';
  const criteriaDefs: Array<[string, (t: Technology) => string]> = [
    ['Current Version', (t) => t.current_version],
    ['Category', (t) => t.category],
    ['License', (t) => t.license],
    ['Pricing Model', (t) => t.pricing_model],
    ['Free Tier Available?', (t) => (t.has_free_tier ? yes : no)],
    ['Pricing Details', (t) => t.pricing_details],
    ['API Availability', (t) => (t.has_api ? apiYes : apiNo)],
    ['Primary Strength', (t) => (t.strengths[0] || 'N/A')],
    ['Primary Limitation', (t) => (t.limitations[0] || 'N/A')],
    ['Supported Platforms', (t) => t.platforms.join(', ')],
    ['Last Verified', (t) => t.last_verified_at],
  ];

  const matrix: ComparisonCriterion[] = [];
  for (const [name, extractor] of criteriaDefs) {
    const values: Record<string, string> = {};
    for (const t of tools) values[t.name] = extractor(t);
    matrix.push({ criterion: name, values });
  }

  const toolNames = tools.map((t) => t.name);
  let verdict = `Comparing ${toolNames.join(', ')}. `;
  const freeTools = tools.filter((t) => t.has_free_tier).map((t) => t.name);
  if (freeTools.length > 0) {
    verdict += `For zero-budget workflows, ${freeTools.join(' and ')} offer accessible free tiers. `;
  }
  const openSourceTools = tools.filter((t) => t.pricing_model.toLowerCase().includes('open source')).map((t) => t.name);
  if (openSourceTools.length > 0) {
    verdict += `${openSourceTools.join(' and ')} provide complete data sovereignty with zero vendor lock-in.`;
  }

  return { tools, matrix, verdict };
}

export async function findAlternativesForTool(backend: Backend, techId: string): Promise<Technology[]> {
  const base = await backend.getTechnologyById(techId);
  if (!base) return [];
  const allTools = await backend.getAllTechnologies();
  const baseWords = base.tagline.toLowerCase().split(' ').filter((w) => w.length > 4);
  return allTools
    .filter((t) => t.id !== base.id && (t.category === base.category || baseWords.some((w) => t.tagline.toLowerCase().includes(w))))
    .slice(0, 4);
}