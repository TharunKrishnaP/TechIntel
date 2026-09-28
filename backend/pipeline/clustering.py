import re
from typing import List, Dict, Any, Tuple
from urllib.parse import urlparse
from ..models import SourceCitation, TechEvent, WhatChanged

TIER_1_DOMAINS = [
    "github.com", "python.org", "anthropic.com", "openai.com", "qdrant.tech",
    "supabase.com", "gamma.app", "beautiful.ai", "nextjs.org", "vercel.com",
    "openssl.org", "nist.gov", "docs.", "changelog", "blog.google", "apple.com"
]

TIER_2_DOMAINS = [
    "techcrunch.com", "theverge.com", "theregister.com", "venturebeat.com",
    "bleepingcomputer.com", "arstechnica.com", "wired.com", "zdnet.com", "infoworld.com"
]

def determine_source_tier(url: str, publisher: str) -> Tuple[int, str]:
    domain = urlparse(url).netloc.lower()
    for t1 in TIER_1_DOMAINS:
        if t1 in domain or t1 in publisher.lower():
            if "github.com" in domain:
                return 1, "Tier 1 - GitHub Release"
            if "docs" in domain:
                return 1, "Tier 1 - Official Docs"
            if "secadv" in url or "cve" in url:
                return 1, "Tier 1 - Official Advisory"
            return 1, "Tier 1 - Official Source"

    for t2 in TIER_2_DOMAINS:
        if t2 in domain or t2 in publisher.lower():
            return 2, "Tier 2 - Technical Press"

    return 3, "Tier 3 - Community / Social"

def extract_key_tokens(text: str) -> set:
    words = re.findall(r'[a-zA-Z0-9_\-\.]+', text.lower())
    stop_words = {
        "the", "a", "an", "in", "on", "of", "and", "or", "for", "with",
        "to", "at", "by", "from", "is", "are", "has", "have", "releases",
        "announces", "launches", "new", "update", "v", "version"
    }
    return {w for w in words if w not in stop_words and len(w) > 2}

def items_belong_together(item_a: Dict[str, Any], item_b: Dict[str, Any]) -> bool:
    tokens_a = extract_key_tokens(item_a["title"])
    tokens_b = extract_key_tokens(item_b["title"])
    overlap = tokens_a.intersection(tokens_b)

    # If both share distinct tech identifiers (e.g. python + 3.13, or openssl + cve)
    if len(overlap) >= 2:
        return True
    return False

def classify_event_type_and_importance(title: str, summary: str) -> Tuple[str, str, str]:
    content = (title + " " + summary).lower()

    if any(k in content for k in ["cve-", "vulnerability", "denial of service", "security advisory", "exploit", "patch"]):
        return "security_patch", "critical", "Security"
    elif any(k in content for k in ["llm", "frontier model", "sonnet", "gpt-", "gemini", "ai model", "reasoning model"]):
        return "ai_model", "major", "AI/ML"
    elif any(k in content for k in ["free-threaded", "no-gil", "major release", "1.0", "v15", "v3.13", "overhaul"]):
        return "major_upgrade", "major", "DevTools"
    elif any(k in content for k in ["pricing", "free tier", "paid plan", "subscription"]):
        return "pricing_change", "significant", "AI/ML"
    elif any(k in content for k in ["deprecated", "discontinued", "sunset"]):
        return "deprecation", "significant", "DevTools"
    elif any(k in content for k in ["vector", "database", "pgvector", "storage", "sql"]):
        return "feature_update", "significant", "Databases"
    else:
        return "feature_update", "normal", "DevTools"
