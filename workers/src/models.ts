/**
 * TechIntel API types — a 1:1 port of backend/models.py.
 * The hosted Cloudflare Worker returns exactly these shapes so the same
 * frontend (desktop EXE, PWA, Android APK) works against either backend.
 */

export interface SourceCitation {
  url: string;
  title: string;
  publisher: string;
  /** 1: Official/Changelog, 2: Technical Press, 3: Community */
  tier: number;
  tier_label: string;
  published_at: string;
}

export interface WhatChanged {
  previous_state: string[];
  new_state: string[];
}

export interface TechEvent {
  id: string;
  technology_id: string | null;
  technology_name: string;
  title: string;
  /** AI/ML, DevTools, Cloud, Databases, Security, Frontend, OpenSource */
  category: string;
  /** new_tool, major_upgrade, ai_model, feature_update, security_patch, pricing_change, deprecation */
  event_type: string;
  /** critical, major, significant, normal */
  importance: string;
  summary_tldr: string;
  what_changed: WhatChanged;
  explanation_technical: string;
  explanation_simple: string;
  impact_audiences: string[];
  impact_summary: string;
  primary_source_tier: number;
  sources_count: number;
  sources: SourceCitation[];
  verified_at: string;
  is_confirmed: boolean;
}

export interface Technology {
  id: string;
  name: string;
  tagline: string;
  category: string;
  developer: string;
  license: string;
  /** Free, Freemium, Paid, Open Source */
  pricing_model: string;
  has_free_tier: boolean;
  pricing_details: string;
  has_api: boolean;
  current_version: string;
  strengths: string[];
  limitations: string[];
  platforms: string[];
  official_url: string;
  docs_url: string;
  repo_url: string | null;
  last_verified_at: string;
  recent_events_count?: number;
}

export interface ExtractedRequirement {
  purpose: string;
  category: string;
  skill_level: string;
  budget: string;
  open_source_preferred: boolean;
  api_required: boolean;
  key_features: string[];
}

export interface ToolRecommendation {
  technology: Technology;
  suitability_score: number;
  match_reasons: string[];
  why_this_tool: string;
  tradeoffs: string[];
  score_breakdown: Record<string, number>;
}

export interface RecommendationResponse {
  query: string;
  requirements: ExtractedRequirement;
  recommendations: ToolRecommendation[];
}

export interface ComparisonCriterion {
  criterion: string;
  values: Record<string, string>;
}

export interface ComparisonResponse {
  tools: Technology[];
  matrix: ComparisonCriterion[];
  verdict: string;
}

export interface FeedStats {
  total_events: number;
  new_today: number;
  new_this_week: number;
  new_this_month: number;
  critical_security_count: number;
  ai_updates_count: number;
  verified_sources_count: number;
  last_sync: string;
}

/** Snapshot bundle generated from the repo's canonical data by scripts/generate-seed.mjs. */
export interface SeedData {
  generated_at: string;
  technologies: Technology[];
  events: TechEvent[];
}