from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class SourceCitation(BaseModel):
    url: str
    title: str
    publisher: str
    tier: int = Field(ge=1, le=3, description="1: Official/Changelog, 2: Technical Press, 3: Community")
    tier_label: str
    published_at: str

class WhatChanged(BaseModel):
    previous_state: List[str] = Field(default_factory=list)
    new_state: List[str] = Field(default_factory=list)

class TechEvent(BaseModel):
    id: str
    technology_id: Optional[str] = None
    technology_name: str
    title: str
    category: str  # AI/ML, DevTools, Cloud, Databases, Security, Frontend, OpenSource
    event_type: str  # new_tool, major_upgrade, ai_model, feature_update, security_patch, pricing_change, deprecation
    importance: str  # critical, major, significant, normal
    summary_tldr: str
    what_changed: WhatChanged
    explanation_technical: str
    explanation_simple: str
    impact_audiences: List[str] = Field(default_factory=list)
    impact_summary: str
    primary_source_tier: int = 1
    sources_count: int = 1
    sources: List[SourceCitation] = Field(default_factory=list)
    verified_at: str
    is_confirmed: bool = True

class Technology(BaseModel):
    id: str
    name: str
    tagline: str
    category: str
    developer: str
    license: str
    pricing_model: str  # Free, Freemium, Paid, Open Source
    has_free_tier: bool
    pricing_details: str
    has_api: bool
    current_version: str
    strengths: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    platforms: List[str] = Field(default_factory=list)
    official_url: str
    docs_url: str
    repo_url: Optional[str] = None
    last_verified_at: str
    recent_events_count: int = 0

class ExtractedRequirement(BaseModel):
    purpose: str
    category: str
    skill_level: str = "Any"  # Beginner, Intermediate, Advanced, Any
    budget: str = "Any"  # Free, Freemium, Any
    open_source_preferred: bool = False
    api_required: bool = False
    key_features: List[str] = Field(default_factory=list)

class ToolRecommendation(BaseModel):
    technology: Technology
    suitability_score: int  # 0 to 100
    match_reasons: List[str] = Field(default_factory=list)
    why_this_tool: str
    tradeoffs: List[str] = Field(default_factory=list)
    score_breakdown: Dict[str, int] = Field(default_factory=dict)

class RecommendationRequest(BaseModel):
    query: str
    user_skill_level: Optional[str] = None
    force_free_only: Optional[bool] = None

class RecommendationResponse(BaseModel):
    query: str
    requirements: ExtractedRequirement
    recommendations: List[ToolRecommendation]

class ComparisonRequest(BaseModel):
    tool_ids: List[str]

class ComparisonCriterion(BaseModel):
    criterion: str
    values: Dict[str, str]

class ComparisonResponse(BaseModel):
    tools: List[Technology]
    matrix: List[ComparisonCriterion]
    verdict: str

class FeedStats(BaseModel):
    total_events: int
    new_today: int
    critical_security_count: int
    ai_updates_count: int
    verified_sources_count: int
    last_sync: str
