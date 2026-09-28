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
from ..database import insert_event, get_all_events, get_all_technologies

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

def _match_known_technology(title: str, summary: str):
    """
    Try to link an incoming feed item to a technology already in the directory.

    Linking matters beyond labelling: events with a ``technology_id`` are the ones
    that surface in that tool's evolution timeline, so a live release for a tracked
    tool lands in the right history instead of as an orphan row.
    """
    haystack = f"{title} {summary}".lower()
    best = None
    for tech in get_all_technologies():
        name = tech.name.lower()
        # Strip version/parens noise, e.g. "Marp (Markdown Presentation)" -> "marp"
        core = name.split("(")[0].strip()
        for candidate in {name, core, tech.id.lower().replace("-", " ")}:
            if len(candidate) < 3:
                continue
            if candidate in haystack:
                # Prefer the most specific (longest) name match.
                if best is None or len(candidate) > len(best[1]):
                    best = (tech, candidate)
                break
    return best[0] if best else None


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

    # Widen the dedupe window: with a month of history in the DB, checking only the
    # newest 50 rows would let a re-published release create a duplicate.
    existing_events = get_all_events(limit=200)
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

        known_tech = _match_known_technology(primary_item["title"], primary_item["summary"])

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

        # Prefer the directory's canonical name/category when we could identify
        # the tool, so live releases slot into the same history as seeded ones.
        if known_tech:
            tech_name = known_tech.name
            tech_id = known_tech.id
        else:
            tech_name = primary_item["publisher"].replace("GitHub Releases - ", "")
            tech_id = None

        tech_event = TechEvent(
            id=event_id,
            technology_id=tech_id,
            technology_name=tech_name,
            title=primary_item["title"],
            category=category,
            event_type=evt_type,
            importance=importance,
            summary_tldr=primary_item["summary"] or primary_item["title"],
            what_changed=what_changed,
            explanation_technical=f"Release update distributed via {primary_item['publisher']}. Includes performance enhancements and dependency updates.",
            explanation_simple=f"{tech_name} published a new update with enhancements and bug fixes.",
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
