import os
import json
import re
from typing import Dict, Any, List, Optional
from ..models import ExtractedRequirement, Technology, WhatChanged

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def get_gemini_client():
    if not GEMINI_API_KEY:
        return None
    try:
        from google import genai
        return genai.Client(api_key=GEMINI_API_KEY)
    except Exception:
        return None

def extract_requirements_from_query(
    query: str,
    user_skill_level: Optional[str] = None,
    force_free_only: Optional[bool] = None
) -> ExtractedRequirement:
    """
    Transforms natural language queries like:
    'I need a free AI tool to generate presentations'
    into structured requirements.
    """
    q_lower = query.lower()

    # Default heuristic analysis
    purpose = query
    category = "General"
    skill = user_skill_level or "Any"
    budget = "Free" if force_free_only else "Any"
    open_source = False
    api_req = False
    key_features = []

    # Detect purpose / category
    if any(k in q_lower for k in ["presentation", "slides", "deck", "powerpoint", "keynote"]):
        purpose = "Generate and design presentations"
        category = "AI/ML"
        key_features.extend(["slide design", "templates", "export to pptx/pdf"])
    elif any(k in q_lower for k in ["code", "coding", "developer", "ide", "editor", "autocomplete"]):
        purpose = "AI code assistance and editing"
        category = "DevTools"
        key_features.extend(["code completions", "multi-file edits", "syntax support"])
    elif any(k in q_lower for k in ["vector", "embeddings", "database", "rag", "sql", "postgres"]):
        purpose = "Vector search and data storage"
        category = "Databases"
        key_features.extend(["vector search", "indexing", "fast querying"])
    elif any(k in q_lower for k in ["website", "web app", "frontend", "ui"]):
        purpose = "Web application development"
        category = "Frontend"
        key_features.extend(["responsive layout", "modern frameworks"])

    # Detect budget
    if force_free_only or any(k in q_lower for k in ["free", "no cost", "0$", "$0", "without paying"]):
        budget = "Free"

    # Detect open source
    if any(k in q_lower for k in ["open source", "open-source", "oss", "self-host", "github"]):
        open_source = True

    # Detect API
    if any(k in q_lower for k in ["api", "sdk", "programmatic", "endpoint", "rest"]):
        api_req = True

    # Detect skill level
    if not user_skill_level:
        if any(k in q_lower for k in ["no coding", "beginner", "without knowing code", "easy", "non-technical"]):
            skill = "Beginner"
        elif any(k in q_lower for k in ["advanced", "expert", "infrastructure", "architect"]):
            skill = "Advanced"

    # If Gemini is available, refine further
    client = get_gemini_client()
    if client:
        try:
            prompt = f"""
            Analyze the following user query for technology tools:
            "{query}"
            Return a valid JSON object matching this schema:
            {{
                "purpose": "short summary of purpose",
                "category": "AI/ML" | "DevTools" | "Databases" | "Frontend" | "Cloud" | "Security",
                "skill_level": "Beginner" | "Intermediate" | "Advanced" | "Any",
                "budget": "Free" | "Freemium" | "Any",
                "open_source_preferred": true | false,
                "api_required": true | false,
                "key_features": ["feature1", "feature2"]
            }}
            Return ONLY the raw JSON string with no backticks.
            """
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            )
            raw = response.text.strip().removeprefix("```json").removesuffix("```").strip()
            data = json.loads(raw)
            return ExtractedRequirement(**data)
        except Exception:
            pass  # Fall back to heuristic

    return ExtractedRequirement(
        purpose=purpose,
        category=category,
        skill_level=skill,
        budget=budget,
        open_source_preferred=open_source,
        api_required=api_req,
        key_features=key_features
    )

def generate_why_this_tool(tech: Technology, req: ExtractedRequirement, score: int) -> str:
    """
    Transparently explains to the user WHY this specific tool matches their requirement.
    """
    reasons = []

    if req.budget == "Free" and tech.has_free_tier:
        reasons.append(f"provides a functional {tech.pricing_model.lower()} tier ({tech.pricing_details.split(';')[0]})")
    elif tech.pricing_model == "Open Source":
        reasons.append(f"is 100% open source under the {tech.license} license with no vendor lock-in")

    if req.open_source_preferred and "Open Source" in tech.pricing_model:
        reasons.append("is completely open source and self-hostable")

    if req.api_required and tech.has_api:
        reasons.append("includes a documented API for developer integration")

    if tech.strengths:
        reasons.append(f"excels at {tech.strengths[0].lower()}")

    if not reasons:
        reasons.append(f"is a strong candidate in {tech.category} rated at {tech.current_version}")

    explanation = f"Recommended ({score}% match) because it " + ", and ".join(reasons) + "."

    if tech.limitations:
        explanation += f" Note: Consider that it has {tech.limitations[0].lower()}."

    return explanation
