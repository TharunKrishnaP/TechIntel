from typing import List, Dict, Any, Optional
from ..models import (
    Technology, ToolRecommendation, RecommendationResponse,
    ComparisonResponse, ComparisonCriterion, ExtractedRequirement
)
from ..database import get_all_technologies, get_technology_by_id
from ..pipeline.ai_engine import extract_requirements_from_query, generate_why_this_tool

def evaluate_tool_suitability(
    tech: Technology,
    req: ExtractedRequirement
) -> ToolRecommendation:
    score = 0
    match_reasons = []
    tradeoffs = []
    score_breakdown = {}

    # 1. Category alignment (Up to 30 pts)
    cat_points = 0
    if req.category.lower() in tech.category.lower() or tech.category.lower() in req.category.lower():
        cat_points = 30
        match_reasons.append(f"Direct match in {tech.category} category")
    elif req.category == "General":
        cat_points = 15
    score += cat_points
    score_breakdown["Category Fit"] = cat_points

    # 2. Budget & Pricing alignment (Up to 30 pts)
    budget_points = 0
    if req.budget == "Free":
        if tech.pricing_model == "Open Source" or (tech.has_free_tier and tech.pricing_model == "Free"):
            budget_points = 30
            match_reasons.append("100% Free to use forever")
        elif tech.has_free_tier:
            budget_points = 25
            match_reasons.append(f"Has functional free tier: {tech.pricing_details.split(';')[0]}")
        else:
            budget_points = 0
            tradeoffs.append("No permanent free tier (paid subscription required)")
    else:
        budget_points = 20
        match_reasons.append(f"Flexible pricing model: {tech.pricing_model}")
    score += budget_points
    score_breakdown["Cost & Pricing"] = budget_points

    # 3. Purpose & Keyword Relevance (Up to 25 pts)
    kw_points = 0
    target_text = (tech.name + " " + tech.tagline + " " + " ".join(tech.strengths)).lower()
    matched_features = []
    for feat in req.key_features:
        if feat.lower() in target_text:
            matched_features.append(feat)
            kw_points += 8

    # Also check purpose tokens
    for token in req.purpose.lower().split():
        if len(token) > 3 and token in target_text:
            kw_points += 4

    kw_points = min(25, kw_points)
    if matched_features:
        match_reasons.append(f"Supports key requirements: {', '.join(matched_features[:3])}")
    elif kw_points > 0:
        match_reasons.append("Capabilities align with described purpose")
    score += kw_points
    score_breakdown["Feature Alignment"] = kw_points

    # 4. Open-Source Preference (Up to 15 pts)
    oss_points = 0
    if req.open_source_preferred:
        if "open source" in tech.pricing_model.lower() or "mit" in tech.license.lower() or "apache" in tech.license.lower():
            oss_points = 15
            match_reasons.append(f"Fully open-source codebase under {tech.license}")
        else:
            tradeoffs.append("Proprietary/closed-source software")
    else:
        oss_points = 10 if tech.pricing_model == "Open Source" else 5
    score += oss_points
    score_breakdown["License & Openness"] = oss_points

    # Cap score at 100
    total_score = min(100, max(10, score))

    if tech.limitations:
        tradeoffs.extend(tech.limitations[:2])

    why_this_tool = generate_why_this_tool(tech, req, total_score)

    return ToolRecommendation(
        technology=tech,
        suitability_score=total_score,
        match_reasons=match_reasons,
        why_this_tool=why_this_tool,
        tradeoffs=tradeoffs,
        score_breakdown=score_breakdown
    )

def match_tools_for_purpose(
    query: str,
    user_skill_level: Optional[str] = None,
    force_free_only: Optional[bool] = None
) -> RecommendationResponse:
    requirements = extract_requirements_from_query(
        query=query,
        user_skill_level=user_skill_level,
        force_free_only=force_free_only
    )

    all_tools = get_all_technologies()
    recommendations = []

    for tech in all_tools:
        rec = evaluate_tool_suitability(tech, requirements)
        # Filter out obvious misfits if score is below 35
        if rec.suitability_score >= 35:
            recommendations.append(rec)

    # Sort descending by suitability score
    recommendations.sort(key=lambda r: r.suitability_score, reverse=True)

    return RecommendationResponse(
        query=query,
        requirements=requirements,
        recommendations=recommendations[:6]  # top 6
    )

def generate_comparison_matrix(tool_ids: List[str]) -> ComparisonResponse:
    tools: List[Technology] = []
    for tid in tool_ids:
        t = get_technology_by_id(tid)
        if t:
            tools.append(t)

    if not tools:
        return ComparisonResponse(tools=[], matrix=[], verdict="No valid tools selected.")

    criteria_defs = [
        ("Current Version", lambda t: t.current_version),
        ("Category", lambda t: t.category),
        ("License", lambda t: t.license),
        ("Pricing Model", lambda t: t.pricing_model),
        ("Free Tier Available?", lambda t: "✅ Yes" if t.has_free_tier else "❌ No (Paid / Trial only)"),
        ("Pricing Details", lambda t: t.pricing_details),
        ("API Availability", lambda t: "✅ Documented API" if t.has_api else "❌ No Public API"),
        ("Primary Strength", lambda t: t.strengths[0] if t.strengths else "N/A"),
        ("Primary Limitation", lambda t: t.limitations[0] if t.limitations else "N/A"),
        ("Supported Platforms", lambda t: ", ".join(t.platforms)),
        ("Last Verified", lambda t: t.last_verified_at)
    ]

    matrix: List[ComparisonCriterion] = []
    for name, extractor in criteria_defs:
        vals = {t.name: extractor(t) for t in tools}
        matrix.append(ComparisonCriterion(criterion=name, values=vals))

    # Dynamic verdict
    tool_names = [t.name for t in tools]
    verdict = f"Comparing {', '.join(tool_names)}. "
    free_tools = [t.name for t in tools if t.has_free_tier]
    if free_tools:
        verdict += f"For zero-budget workflows, {' and '.join(free_tools)} offer accessible free tiers. "
    open_source_tools = [t.name for t in tools if "open source" in t.pricing_model.lower()]
    if open_source_tools:
        verdict += f"{' and '.join(open_source_tools)} provide complete data sovereignty with zero vendor lock-in."

    return ComparisonResponse(
        tools=tools,
        matrix=matrix,
        verdict=verdict
    )

def find_alternatives_for_tool(tech_id: str) -> List[Technology]:
    base_tech = get_technology_by_id(tech_id)
    if not base_tech:
        return []

    all_tools = get_all_technologies()
    alternatives = [
        t for t in all_tools
        if t.id != base_tech.id and (t.category == base_tech.category or any(w in t.tagline.lower() for w in base_tech.tagline.lower().split() if len(w) > 4))
    ]
    return alternatives[:4]
