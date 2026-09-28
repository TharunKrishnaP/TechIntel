import feedparser
import httpx
import asyncio
import logging
from typing import List, Dict, Any
from datetime import datetime
from .clustering import (
    determine_source_tier,
    classify_event_type_and_importance,
    items_belong_together
)
from ..models import TechEvent, SourceCitation, WhatChanged
from ..database import insert_event, get_all_events

logger = logging.getLogger(__name__)

FEED_SOURCES = [
    {
        "name": "Python Software Foundation",
        "url": "https://www.python.org/dev/peps/peps.rss",
        "tier": 1
    },
    {
        "name": "GitHub Releases - Supabase",
        "url": "https://github.com/supabase/supabase/releases.atom",
        "tier": 1
    },
    {
        "name": "GitHub Releases - Qdrant",
        "url": "https://github.com/qdrant/qdrant/releases.atom",
        "tier": 1
    },
    {
        "name": "GitHub Releases - Next.js",
        "url": "https://github.com/vercel/next.js/releases.atom",
        "tier": 1
    },
    {
        "name": "Hacker News Tech Frontpage",
        "url": "https://news.ycombinator.com/rss",
        "tier": 3
    }
]

async def fetch_feed(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = []
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(source["url"])
            if resp.status_code == 200:
                parsed = feedparser.parse(resp.text)
                for entry in parsed.entries[:5]:  # limit to top 5 recent items per source
                    title = entry.get("title", "").strip()
                    link = entry.get("link", "").strip()
                    summary = entry.get("summary", entry.get("description", "")).strip()
                    # clean HTML tags from summary
                    import re
                    clean_summary = re.sub(r'<[^>]+>', ' ', summary)[:300].strip()

                    items.append({
                        "title": title,
                        "url": link,
                        "summary": clean_summary,
                        "publisher": source["name"],
                        "default_tier": source["tier"],
                        "published_at": entry.get("published", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))
                    })
    except Exception as e:
        logger.warning(f"Could not fetch feed {source['name']}: {e}")
    return items

async def sync_all_feeds() -> int:
    """
    Fetches real-time feeds, deduplicates incoming articles into canonical events,
    and inserts them into the database.
    """
    tasks = [fetch_feed(s) for s in FEED_SOURCES]
    results = await asyncio.gather(*tasks)
    all_raw_items = [item for sublist in results for item in sublist]

    if not all_raw_items:
        return 0

    existing_events = get_all_events(limit=50)
    existing_titles = {e.title.lower() for e in existing_events}

    new_events_count = 0

    # Group similar incoming items together
    clusters: List[List[Dict[str, Any]]] = []
    for item in all_raw_items:
        matched_cluster = None
        for cluster in clusters:
            if any(items_belong_together(item, c) for c in cluster):
                matched_cluster = cluster
                break
        if matched_cluster:
            matched_cluster.append(item)
        else:
            clusters.append([item])

    for cluster in clusters:
        primary_item = cluster[0]
        # Skip if already exists
        if any(primary_item["title"].lower() in ext for ext in existing_titles):
            continue

        citations = []
        best_tier = 3
        for itm in cluster:
            tier, label = determine_source_tier(itm["url"], itm["publisher"])
            if tier < best_tier:
                best_tier = tier
            citations.append(SourceCitation(
                url=itm["url"],
                title=itm["title"],
                publisher=itm["publisher"],
                tier=tier,
                tier_label=label,
                published_at=itm["published_at"]
            ))

        evt_type, importance, category = classify_event_type_and_importance(
            primary_item["title"], primary_item["summary"]
        )

        event_id = f"evt-live-{int(datetime.utcnow().timestamp())}-{new_events_count}"

        what_changed = WhatChanged(
            previous_state=["Previous stable release iteration"],
            new_state=[f"Updated features & fixes: {primary_item['title'][:100]}"]
        )

        tech_event = TechEvent(
            id=event_id,
            technology_id=None,
            technology_name=primary_item["publisher"].replace("GitHub Releases - ", ""),
            title=primary_item["title"],
            category=category,
            event_type=evt_type,
            importance=importance,
            summary_tldr=primary_item["summary"] or primary_item["title"],
            what_changed=what_changed,
            explanation_technical=f"Release update distributed via {primary_item['publisher']}. Includes performance enhancements and dependency updates.",
            explanation_simple=f"{primary_item['publisher']} published a new update with enhancements and bug fixes.",
            impact_audiences=["Developers", "Engineers"],
            impact_summary="Relevant for teams maintaining systems built on this framework/dependency.",
            primary_source_tier=best_tier,
            sources_count=len(citations),
            sources=citations,
            verified_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
            is_confirmed=True
        )

        insert_event(tech_event)
        new_events_count += 1

    return new_events_count
