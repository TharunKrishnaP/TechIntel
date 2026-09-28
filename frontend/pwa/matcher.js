/**
 * TechIntel — Client-side Matcher (PWA port)
 * ===========================================
 * A faithful JavaScript port of `backend/services/matcher.py` plus the heuristic
 * fallback in `backend/pipeline/ai_engine.py`.
 *
 * Why this exists: the installed PWA has no backend, but the Find-a-Tool and
 * Compare tabs must still work. The scoring is pure and deterministic — it is
 * just arithmetic over the static `tools.json` — so running it in the browser
 * produces the same answers the API would.
 *
 * Parity is enforced by `backend/test_api.py`, which runs the Python and JS
 * implementations over the same tool data and asserts the scores match.
 */

const Matcher = (() => {
  'use strict';

  const lower = (s) => String(s == null ? '' : s).toLowerCase();

  // -------------------------------------------------------------------------
  // Requirement extraction — port of extract_requirements_from_query()'s
  // heuristic path. The Gemini refinement has no browser equivalent, so this is
  // the only branch available offline; the live API may return richer results.
  // -------------------------------------------------------------------------
  function extractRequirements(query, userSkillLevel = null, forceFreeOnly = null) {
    const q = lower(query);

    let purpose = query;
    let category = 'General';
    let skill = userSkillLevel || 'Any';
    let budget = forceFreeOnly ? 'Free' : 'Any';
    let openSource = false;
    let apiRequired = false;
    const keyFeatures = [];

    const has = (list) => list.some((k) => q.includes(k));

    if (has(['presentation', 'slides', 'deck', 'powerpoint', 'keynote'])) {
      purpose = 'Generate and design presentations';
      category = 'AI/ML';
      keyFeatures.push('slide design', 'templates', 'export to pptx/pdf');
    } else if (has(['code', 'coding', 'developer', 'ide', 'editor', 'autocomplete'])) {
      purpose = 'AI code assistance and editing';
      category = 'DevTools';
      keyFeatures.push('code completions', 'multi-file edits', 'syntax support');
    } else if (has(['vector', 'embeddings', 'database', 'rag', 'sql', 'postgres'])) {
      purpose = 'Vector search and data storage';
      category = 'Databases';
      keyFeatures.push('vector search', 'indexing', 'fast querying');
    } else if (has(['website', 'web app', 'frontend', 'ui'])) {
      purpose = 'Web application development';
      category = 'Frontend';
      keyFeatures.push('responsive layout', 'modern frameworks');
    }

    if (forceFreeOnly || has(['free', 'no cost', '0$', '$0', 'without paying'])) {
      budget = 'Free';
    }
    if (has(['open source', 'open-source', 'oss', 'self-host', 'github'])) {
      openSource = true;
    }
    if (has(['api', 'sdk', 'programmatic', 'endpoint', 'rest'])) {
      apiRequired = true;
    }
    if (!userSkillLevel) {
      if (has(['no coding', 'beginner', 'without knowing code', 'easy', 'non-technical'])) {
        skill = 'Beginner';
      } else if (has(['advanced', 'expert', 'infrastructure', 'architect'])) {
        skill = 'Advanced';
      }
    }

    return {
      purpose,
      category,
      skill_level: skill,
      budget,
      open_source_preferred: openSource,
      api_required: apiRequired,
      key_features: keyFeatures,
    };
  }

  // -------------------------------------------------------------------------
  // Port of generate_why_this_tool()
  // -------------------------------------------------------------------------
  function generateWhyThisTool(tech, req, score) {
    const reasons = [];

    if (req.budget === 'Free' && tech.has_free_tier) {
      const detail = String(tech.pricing_details || '').split(';')[0];
      reasons.push(`provides a functional ${lower(tech.pricing_model)} tier (${detail})`);
    } else if (tech.pricing_model === 'Open Source') {
      reasons.push(`is 100% open source under the ${tech.license} license with no vendor lock-in`);
    }
    if (req.open_source_preferred && tech.pricing_model === 'Open Source') {
      reasons.push('is completely open source and self-hostable');
    }
    if (req.api_required && tech.has_api) {
      reasons.push('includes a documented API for developer integration');
    }
    if (tech.strengths && tech.strengths.length) {
      reasons.push(`excels at ${lower(tech.strengths[0])}`);
    }
    if (!reasons.length) {
      reasons.push(`is a strong candidate in ${tech.category} rated at ${tech.current_version}`);
    }

    let explanation = `Recommended (${score}% match) because it ` + reasons.join(', and ') + '.';
    if (tech.limitations && tech.limitations.length) {
      explanation += ` Note: Consider that it has ${lower(tech.limitations[0])}.`;
    }
    return explanation;
  }

  // -------------------------------------------------------------------------
  // Port of evaluate_tool_suitability()
  // -------------------------------------------------------------------------
  function evaluateToolSuitability(tech, req) {
    let score = 0;
    const matchReasons = [];
    const tradeoffs = [];
    const scoreBreakdown = {};

    // 1. Category alignment (up to 30 pts)
    let catPoints = 0;
    const reqCat = lower(req.category);
    const techCat = lower(tech.category);
    if (reqCat.includes(techCat) || techCat.includes(reqCat)) {
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
        matchReasons.push(`Has functional free tier: ${String(tech.pricing_details || '').split(';')[0]}`);
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
    const targetText = lower([tech.name, tech.tagline, ...(tech.strengths || [])].join(' '));
    const matchedFeatures = [];
    for (const feat of req.key_features || []) {
      if (targetText.includes(lower(feat))) {
        matchedFeatures.push(feat);
        kwPoints += 8;
      }
    }
    for (const token of lower(req.purpose).split(/\s+/)) {
      if (token.length > 3 && targetText.includes(token)) kwPoints += 4;
    }
    kwPoints = Math.min(25, kwPoints);
    if (matchedFeatures.length) {
      matchReasons.push(`Supports key requirements: ${matchedFeatures.slice(0, 3).join(', ')}`);
    } else if (kwPoints > 0) {
      matchReasons.push('Capabilities align with described purpose');
    }
    score += kwPoints;
    scoreBreakdown['Feature Alignment'] = kwPoints;

    // 4. Open-source preference (up to 15 pts)
    let ossPoints = 0;
    const pm = lower(tech.pricing_model);
    const lic = lower(tech.license);
    if (req.open_source_preferred) {
      if (pm.includes('open source') || lic.includes('mit') || lic.includes('apache')) {
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
    if (tech.limitations && tech.limitations.length) {
      tradeoffs.push(...tech.limitations.slice(0, 2));
    }

    return {
      technology: tech,
      suitability_score: totalScore,
      match_reasons: matchReasons,
      why_this_tool: generateWhyThisTool(tech, req, totalScore),
      tradeoffs,
      score_breakdown: scoreBreakdown,
    };
  }

  // -------------------------------------------------------------------------
  // Port of match_tools_for_purpose()
  // -------------------------------------------------------------------------
  function matchToolsForPurpose(query, allTools, userSkillLevel = null, forceFreeOnly = null) {
    const requirements = extractRequirements(query, userSkillLevel, forceFreeOnly);
    const recommendations = [];
    for (const tech of allTools) {
      const rec = evaluateToolSuitability(tech, requirements);
      if (rec.suitability_score >= 35) recommendations.push(rec);
    }
    // Stable sort: equal scores keep directory order, matching Python's sort.
    recommendations.forEach((r, i) => (r._i = i));
    recommendations.sort((a, b) => b.suitability_score - a.suitability_score || a._i - b._i);
    recommendations.forEach((r) => delete r._i);
    return { query, requirements, recommendations: recommendations.slice(0, 6) };
  }

  // -------------------------------------------------------------------------
  // Port of generate_comparison_matrix()
  // -------------------------------------------------------------------------
  function generateComparisonMatrix(toolIds, allTools) {
    const byId = new Map(allTools.map((t) => [t.id, t]));
    const tools = toolIds.map((id) => byId.get(id)).filter(Boolean);

    if (!tools.length) return { tools: [], matrix: [], verdict: 'No valid tools selected.' };

    const criteriaDefs = [
      ['Current Version', (t) => t.current_version],
      ['Category', (t) => t.category],
      ['License', (t) => t.license],
      ['Pricing Model', (t) => t.pricing_model],
      ['Free Tier Available?', (t) => (t.has_free_tier ? '✅ Yes' : '❌ No (Paid / Trial only)')],
      ['Pricing Details', (t) => t.pricing_details],
      ['API Availability', (t) => (t.has_api ? '✅ Documented API' : '❌ No Public API')],
      ['Primary Strength', (t) => (t.strengths && t.strengths.length ? t.strengths[0] : 'N/A')],
      ['Primary Limitation', (t) => (t.limitations && t.limitations.length ? t.limitations[0] : 'N/A')],
      ['Supported Platforms', (t) => (t.platforms || []).join(', ')],
      ['Last Verified', (t) => t.last_verified_at],
    ];

    const matrix = criteriaDefs.map(([criterion, extract]) => {
      const values = {};
      for (const t of tools) values[t.name] = String(extract(t) ?? '');
      return { criterion, values };
    });

    const toolNames = tools.map((t) => t.name);
    let verdict = `Comparing ${toolNames.join(', ')}. `;
    const freeTools = tools.filter((t) => t.has_free_tier).map((t) => t.name);
    if (freeTools.length) {
      verdict += `For zero-budget workflows, ${freeTools.join(' and ')} offer accessible free tiers. `;
    }
    const ossTools = tools.filter((t) => lower(t.pricing_model).includes('open source')).map((t) => t.name);
    if (ossTools.length) {
      verdict += `${ossTools.join(' and ')} provide complete data sovereignty with zero vendor lock-in.`;
    }

    return { tools, matrix, verdict };
  }

  // -------------------------------------------------------------------------
  // Port of find_alternatives_for_tool()
  // -------------------------------------------------------------------------
  function findAlternativesForTool(techId, allTools) {
    const base = allTools.find((t) => t.id === techId);
    if (!base) return [];
    const baseWords = lower(base.tagline).split(/\s+/).filter((w) => w.length > 4);
    return allTools
      .filter(
        (t) =>
          t.id !== base.id &&
          (t.category === base.category || baseWords.some((w) => lower(t.tagline).includes(w)))
      )
      .slice(0, 4);
  }

  return {
    extractRequirements,
    evaluateToolSuitability,
    matchToolsForPurpose,
    generateComparisonMatrix,
    findAlternativesForTool,
  };
})();

// Expose for the PWA runtime and for the parity test harness.
if (typeof window !== 'undefined') window.Matcher = Matcher;
if (typeof module !== 'undefined' && module.exports) module.exports = Matcher;
