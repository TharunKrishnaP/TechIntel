import sqlite3
import json
import os
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from .models import TechEvent, Technology, SourceCitation, WhatChanged, FeedStats
from .app_paths import get_db_path

# Resolved lazily through app_paths so the desktop EXE (frozen) gets a writable
# user-data location instead of the read-only extraction dir.
DB_PATH = get_db_path()

def get_connection():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS technologies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL,
        category TEXT NOT NULL,
        developer TEXT NOT NULL,
        license TEXT NOT NULL,
        pricing_model TEXT NOT NULL,
        has_free_tier INTEGER NOT NULL,
        pricing_details TEXT NOT NULL,
        has_api INTEGER NOT NULL,
        current_version TEXT NOT NULL,
        strengths TEXT NOT NULL,
        limitations TEXT NOT NULL,
        platforms TEXT NOT NULL,
        official_url TEXT NOT NULL,
        docs_url TEXT NOT NULL,
        repo_url TEXT,
        last_verified_at TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        technology_id TEXT,
        technology_name TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        event_type TEXT NOT NULL,
        importance TEXT NOT NULL,
        summary_tldr TEXT NOT NULL,
        what_changed TEXT NOT NULL,
        explanation_technical TEXT NOT NULL,
        explanation_simple TEXT NOT NULL,
        impact_audiences TEXT NOT NULL,
        impact_summary TEXT NOT NULL,
        primary_source_tier INTEGER NOT NULL,
        sources_count INTEGER NOT NULL,
        sources TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        is_confirmed INTEGER NOT NULL,
        FOREIGN KEY (technology_id) REFERENCES technologies(id)
    )
    """)

    # Small key/value store so the seeder can remember which day it anchored its
    # generated history to. Without this, re-seeding would append a fresh random
    # month of events on every boot and inflate the counts.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS seed_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)

    conn.commit()
    conn.close()

def get_seed_meta(key: str) -> Optional[str]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM seed_meta WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else None

def set_seed_meta(key: str, value: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO seed_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value)
    )
    conn.commit()
    conn.close()

def get_last_sync() -> str:
    """Human-readable timestamp of the last successful feed sync (or seed)."""
    return get_seed_meta("last_sync_at") or "Not synced yet"


def set_last_sync(timestamp: Optional[str] = None):
    """Record a successful feed sync (or the seed time) for /api/stats."""
    set_seed_meta(
        "last_sync_at",
        timestamp or datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )


def delete_generated_history() -> int:
    """Remove previously auto-generated history rows, leaving curated events alone."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM events WHERE id LIKE 'evt-hist-%'")
    removed = cursor.rowcount or 0
    conn.commit()
    conn.close()
    return removed

def count_generated_history() -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM events WHERE id LIKE 'evt-hist-%'")
    count = cursor.fetchone()[0]
    conn.close()
    return count

def row_to_technology(row: sqlite3.Row) -> Technology:
    return Technology(
        id=row["id"],
        name=row["name"],
        tagline=row["tagline"],
        category=row["category"],
        developer=row["developer"],
        license=row["license"],
        pricing_model=row["pricing_model"],
        has_free_tier=bool(row["has_free_tier"]),
        pricing_details=row["pricing_details"],
        has_api=bool(row["has_api"]),
        current_version=row["current_version"],
        strengths=json.loads(row["strengths"]),
        limitations=json.loads(row["limitations"]),
        platforms=json.loads(row["platforms"]),
        official_url=row["official_url"],
        docs_url=row["docs_url"],
        repo_url=row["repo_url"],
        last_verified_at=row["last_verified_at"]
    )

def row_to_event(row: sqlite3.Row) -> TechEvent:
    sources_data = json.loads(row["sources"])
    citations = [SourceCitation(**s) for s in sources_data]
    what_changed_data = json.loads(row["what_changed"])

    return TechEvent(
        id=row["id"],
        technology_id=row["technology_id"],
        technology_name=row["technology_name"],
        title=row["title"],
        category=row["category"],
        event_type=row["event_type"],
        importance=row["importance"],
        summary_tldr=row["summary_tldr"],
        what_changed=WhatChanged(**what_changed_data),
        explanation_technical=row["explanation_technical"],
        explanation_simple=row["explanation_simple"],
        impact_audiences=json.loads(row["impact_audiences"]),
        impact_summary=row["impact_summary"],
        primary_source_tier=row["primary_source_tier"],
        sources_count=row["sources_count"],
        sources=citations,
        verified_at=row["verified_at"],
        is_confirmed=bool(row["is_confirmed"])
    )

def get_all_technologies(category: Optional[str] = None, search: Optional[str] = None) -> List[Technology]:
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM technologies WHERE 1=1"
    params = []

    if category and category != "All":
        query += " AND category = ?"
        params.append(category)

    if search:
        query += " AND (name LIKE ? OR tagline LIKE ? OR developer LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s])

    query += " ORDER BY name ASC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    technologies = [row_to_technology(r) for r in rows]

    for tech in technologies:
        cursor.execute("SELECT COUNT(*) FROM events WHERE technology_id = ?", (tech.id,))
        tech.recent_events_count = cursor.fetchone()[0]

    conn.close()
    return technologies

def get_technology_by_id(tech_id: str) -> Optional[Technology]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM technologies WHERE id = ?", (tech_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    tech = row_to_technology(row)
    cursor.execute("SELECT COUNT(*) FROM events WHERE technology_id = ?", (tech.id,))
    tech.recent_events_count = cursor.fetchone()[0]
    conn.close()
    return tech

def get_all_events(
    category: Optional[str] = None,
    importance: Optional[str] = None,
    event_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    days: Optional[int] = None
) -> List[TechEvent]:
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM events WHERE 1=1"
    params = []

    # `days` is the shorthand for "trailing N days". Explicit bounds win, so a
    # caller can pass both without the shorthand silently widening the window.
    if days and not (date_from or date_to):
        date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M UTC")

    # Accept bare YYYY-MM-DD from callers (e.g. API query params) and widen the
    # upper bound so a single-day range is inclusive of that whole day.
    if date_from and len(date_from) == 10:
        date_from = f"{date_from} 00:00 UTC"
    if date_to and len(date_to) == 10:
        date_to = f"{date_to} 23:59 UTC"

    if category and category != "All":
        query += " AND category = ?"
        params.append(category)

    if importance and importance != "All":
        query += " AND importance = ?"
        params.append(importance)

    if event_type and event_type != "All":
        query += " AND event_type = ?"
        params.append(event_type)

    if search:
        query += " AND (title LIKE ? OR summary_tldr LIKE ? OR technology_name LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s])

    if date_from:
        query += " AND verified_at >= ?"
        params.append(date_from)

    if date_to:
        query += " AND verified_at <= ?"
        params.append(date_to)

    query += " ORDER BY verified_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor.execute(query, params)
    rows = cursor.fetchall()
    events = [row_to_event(r) for r in rows]
    conn.close()
    return events

def get_event_by_id(event_id: str) -> Optional[TechEvent]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_event(row) if row else None

def get_events_for_technology(tech_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[TechEvent]:
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM events WHERE technology_id = ?"
    params = [tech_id]

    if date_from:
        query += " AND verified_at >= ?"
        params.append(date_from)

    if date_to:
        query += " AND verified_at <= ?"
        params.append(date_to)

    query += " ORDER BY verified_at DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [row_to_event(r) for r in rows]

def get_technology_evolution(tech_id: str, days: int = 30) -> Dict[str, Any]:
    """
    Get a comprehensive evolution timeline for a technology.
    Returns version history, major milestones, and trend analysis.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Get technology info
    cursor.execute("SELECT * FROM technologies WHERE id = ?", (tech_id,))
    tech_row = cursor.fetchone()
    if not tech_row:
        conn.close()
        return {"error": "Technology not found"}

    tech = row_to_technology(tech_row)

    # Get all events for this technology in the past N days
    date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M UTC")
    events = get_events_for_technology(tech_id, date_from=date_from)

    # Group events by type and importance
    version_releases = [e for e in events if e.event_type in ['major_upgrade', 'new_tool', 'ai_model']]
    feature_updates = [e for e in events if e.event_type == 'feature_update']
    security_patches = [e for e in events if e.event_type == 'security_patch']
    pricing_changes = [e for e in events if e.event_type == 'pricing_change']
    deprecations = [e for e in events if e.event_type == 'deprecation']

    # Build the version trail from every event that actually names a version, not
    # just the major releases. A patch release is still a point on the upgrade
    # path, and including it is what makes the trail feel continuous. Events with
    # no version in the title are skipped rather than shown as "N/A".
    version_timeline = []
    for evt in events:
        version = _extract_version_from_title(evt.title)
        if not version:
            continue
        version_timeline.append({
            "date": evt.verified_at,
            "version": version,
            "title": evt.title,
            "importance": evt.importance,
            "summary": evt.summary_tldr,
            "type": evt.event_type
        })

    # Oldest -> newest, matching the order the UI stepper renders.
    version_timeline.sort(key=lambda x: x["date"])

    # Calculate trends
    total_events = len(events)
    critical_count = len([e for e in events if e.importance == 'critical'])
    major_count = len([e for e in events if e.importance == 'major'])

    conn.close()

    return {
        "technology": {
            "id": tech.id,
            "name": tech.name,
            "current_version": tech.current_version,
            "category": tech.category
        },
        "period_days": days,
        "summary": {
            "total_events": total_events,
            "version_releases": len(version_releases),
            "feature_updates": len(feature_updates),
            "security_patches": len(security_patches),
            "pricing_changes": len(pricing_changes),
            "critical_events": critical_count,
            "major_events": major_count
        },
        "version_timeline": version_timeline,
        "recent_events": [
            {
                "id": e.id,
                "date": e.verified_at,
                "title": e.title,
                "type": e.event_type,
                "importance": e.importance,
                "summary": e.summary_tldr
            }
            for e in events[:20]
        ],
        "event_breakdown": {
            "major_upgrade": len(version_releases),
            "feature_update": len(feature_updates),
            "security_patch": len(security_patches),
            "pricing_change": len(pricing_changes),
            "deprecation": len(deprecations)
        }
    }

def _extract_version_from_title(title: str) -> Optional[str]:
    """
    Pull a version number out of an event title.

    Returns ``None`` when the title doesn't name a version, so callers can decide
    whether to include the event. The seeded history embeds versions like
    "v1.12.1" or "3.13.0" in the title; curated news headlines often don't.
    """
    import re
    # Ordered most-specific first: 1.2.3 before 1.2 before 1.
    version_patterns = [
        r'\bv?\d+\.\d+\.\d+(?:-[\w.]+)?',
        r'\bv?\d+\.\d+\b',
        r'\bv\d+(?!\.\d)',
    ]
    for pattern in version_patterns:
        match = re.search(pattern, title, re.IGNORECASE)
        if match:
            return match.group(0)
    return None

def insert_or_update_technology(tech: Technology):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO technologies (
        id, name, tagline, category, developer, license, pricing_model,
        has_free_tier, pricing_details, has_api, current_version,
        strengths, limitations, platforms, official_url, docs_url, repo_url, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        tagline=excluded.tagline,
        category=excluded.category,
        developer=excluded.developer,
        license=excluded.license,
        pricing_model=excluded.pricing_model,
        has_free_tier=excluded.has_free_tier,
        pricing_details=excluded.pricing_details,
        has_api=excluded.has_api,
        current_version=excluded.current_version,
        strengths=excluded.strengths,
        limitations=excluded.limitations,
        platforms=excluded.platforms,
        official_url=excluded.official_url,
        docs_url=excluded.docs_url,
        repo_url=excluded.repo_url,
        last_verified_at=excluded.last_verified_at
    """, (
        tech.id, tech.name, tech.tagline, tech.category, tech.developer, tech.license, tech.pricing_model,
        1 if tech.has_free_tier else 0, tech.pricing_details, 1 if tech.has_api else 0, tech.current_version,
        json.dumps(tech.strengths), json.dumps(tech.limitations), json.dumps(tech.platforms),
        tech.official_url, tech.docs_url, tech.repo_url, tech.last_verified_at
    ))
    conn.commit()
    conn.close()

def insert_event(event: TechEvent):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO events (
        id, technology_id, technology_name, title, category, event_type, importance,
        summary_tldr, what_changed, explanation_technical, explanation_simple,
        impact_audiences, impact_summary, primary_source_tier, sources_count,
        sources, verified_at, is_confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        summary_tldr=excluded.summary_tldr,
        what_changed=excluded.what_changed,
        explanation_technical=excluded.explanation_technical,
        explanation_simple=excluded.explanation_simple,
        sources_count=excluded.sources_count,
        sources=excluded.sources,
        verified_at=excluded.verified_at
    """, (
        event.id, event.technology_id, event.technology_name, event.title, event.category, event.event_type, event.importance,
        event.summary_tldr, json.dumps(event.what_changed.model_dump()), event.explanation_technical, event.explanation_simple,
        json.dumps(event.impact_audiences), event.impact_summary, event.primary_source_tier, event.sources_count,
        json.dumps([s.model_dump() for s in event.sources]), event.verified_at, 1 if event.is_confirmed else 0
    ))
    conn.commit()
    conn.close()

def get_stats() -> FeedStats:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM events")
    total_events = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM events WHERE importance = 'critical' AND (event_type = 'security_patch' OR category = 'Security')")
    critical_security = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM events WHERE category = 'AI/ML'")
    ai_updates = cursor.fetchone()[0]

    cursor.execute("SELECT SUM(sources_count) FROM events")
    res = cursor.fetchone()[0]
    verified_sources = res if res else total_events

    # Time-based counts
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M UTC")
    week_start = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M UTC")
    month_start = (now - timedelta(days=30)).strftime("%Y-%m-%d %H:%M UTC")

    cursor.execute("SELECT COUNT(*) FROM events WHERE verified_at >= ?", (today_start,))
    new_today = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM events WHERE verified_at >= ?", (week_start,))
    new_this_week = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM events WHERE verified_at >= ?", (month_start,))
    new_this_month = cursor.fetchone()[0]

    conn.close()
    return FeedStats(
        total_events=total_events,
        new_today=new_today,
        new_this_week=new_this_week,
        new_this_month=new_this_month,
        critical_security_count=critical_security,
        ai_updates_count=ai_updates,
        verified_sources_count=verified_sources,
        last_sync=get_last_sync()
    )

def seed_database():
    init_db()

    # 1. Seed Technologies
    sample_technologies = [
        Technology(
            id="gamma-app",
            name="Gamma App",
            tagline="AI-powered presentations, slides, and websites generated in seconds.",
            category="AI/ML",
            developer="Gamma Tech",
            license="Proprietary",
            pricing_model="Freemium",
            has_free_tier=True,
            pricing_details="Free tier with 400 initial AI credits; Plus plan at $10/mo, Pro at $20/mo",
            has_api=False,
            current_version="v2.8",
            strengths=["Exceptional automated slide design and layout polish", "Instant interactive widgets, cards, and embeds", "One-click export to PDF and PPTX", "Generates cohesive theme palettes"],
            limitations=["Limited granular pixel-level shape editing", "AI credits get consumed quickly on free plan", "No public REST API for automated generation"],
            platforms=["Web", "Mobile Web"],
            official_url="https://gamma.app",
            docs_url="https://help.gamma.app",
            repo_url=None,
            last_verified_at="2026-09-28 14:30 UTC"
        ),
        Technology(
            id="beautiful-ai",
            name="Beautiful.ai",
            tagline="Smart presentation maker that designs slides with automated typography rules.",
            category="AI/ML",
            developer="Beautiful.ai Inc.",
            license="Proprietary",
            pricing_model="Paid",
            has_free_tier=False,
            pricing_details="14-day free trial; Individual plan at $12/mo billed annually ($144/yr); Team at $40/user/mo",
            has_api=True,
            current_version="v4.2",
            strengths=["Strict corporate design consistency enforcement", "Smart slides automatically adapt as content expands", "Team collaboration and brand asset library management", "PowerPoint import and export fidelity"],
            limitations=["No permanent free tier (trial requires credit card)", "Strict layout constraints prevent free-form drawing", "Can feel rigid for casual, creative visual styling"],
            platforms=["Web", "Mac App", "Windows App"],
            official_url="https://www.beautiful.ai",
            docs_url="https://support.beautiful.ai",
            repo_url=None,
            last_verified_at="2026-09-28 14:15 UTC"
        ),
        Technology(
            id="slidesai",
            name="SlidesAI",
            tagline="AI Google Slides extension that converts raw text into organized slide decks.",
            category="AI/ML",
            developer="SlidesAI.io",
            license="Proprietary",
            pricing_model="Freemium",
            has_free_tier=True,
            pricing_details="Free basic tier (3 presentations/mo up to 2500 characters input); Pro at $10/mo",
            has_api=False,
            current_version="v3.1",
            strengths=["Runs directly inside Google Slides as an add-on", "Great for academic summaries and rapid bullet point formatting", "Generates topic-relevant Unsplash images automatically", "Multilingual text input support (100+ languages)"],
            limitations=["Designs are relatively standard and basic", "Short character limits on free tier", "Dependent on Google Workspace ecosystem"],
            platforms=["Google Slides Add-on", "Web"],
            official_url="https://www.slidesai.io",
            docs_url="https://docs.slidesai.io",
            repo_url=None,
            last_verified_at="2026-09-28 14:00 UTC"
        ),
        Technology(
            id="marp",
            name="Marp (Markdown Presentation)",
            tagline="The open-source Markdown presentation ecosystem for developers.",
            category="DevTools",
            developer="Marp Community",
            license="MIT (Open Source)",
            pricing_model="Open Source",
            has_free_tier=True,
            pricing_details="100% Free and Open Source forever",
            has_api=True,
            current_version="v3.8.0",
            strengths=["Write presentations entirely in Markdown with zero lock-in", "Version control presentations in Git like code", "Exports to PDF, PPTX, and HTML", "VS Code extension with instant live preview"],
            limitations=["No automated AI graphic/text generation out of the box", "Requires Markdown and basic CSS knowledge for custom themes", "Not suited for non-technical users"],
            platforms=["VS Code", "CLI", "Web"],
            official_url="https://marp.app",
            docs_url="https://marpit.marp.app",
            repo_url="https://github.com/marp-team/marp",
            last_verified_at="2026-09-28 13:45 UTC"
        ),
        Technology(
            id="claude-3-5-sonnet",
            name="Claude 3.5 Sonnet",
            tagline="Frontier multimodal AI model renowned for coding benchmarks and reasoning.",
            category="AI/ML",
            developer="Anthropic",
            license="Proprietary",
            pricing_model="Pay-as-you-go",
            has_free_tier=True,
            pricing_details="Free access on claude.ai with daily message caps; API: $3/M input, $15/M output tokens",
            has_api=True,
            current_version="Claude 3.5 Sonnet (Latest)",
            strengths=["State-of-the-art coding and agentic reasoning benchmarks", "Fast inference speed compared to Opus class", "Artifacts interactive live execution canvas", "Exceptional nuance in instruction following"],
            limitations=["Rate limits on free tier during peak hours", "No image generation output (input/vision only)"],
            platforms=["Web", "API", "iOS", "Android"],
            official_url="https://www.anthropic.com/claude",
            docs_url="https://docs.anthropic.com",
            repo_url=None,
            last_verified_at="2026-09-28 15:00 UTC"
        ),
        Technology(
            id="cursor",
            name="Cursor",
            tagline="The AI-native code editor built on VS Code with codebase indexing.",
            category="DevTools",
            developer="Anysphere",
            license="Proprietary",
            pricing_model="Freemium",
            has_free_tier=True,
            pricing_details="Free tier includes 2000 completions and 50 slow premium requests; Pro at $20/mo",
            has_api=False,
            current_version="v0.41",
            strengths=["Full codebase vector indexing for multi-file context", "Composer multi-file autonomous editing", "Cursor Tab instant predictive multi-line edits", "Seamless 1-click import of all VS Code extensions"],
            limitations=["Proprietary backend closed-source telemetry", "Pro subscription can be expensive for hobbyists", "High CPU/RAM footprint with large repositories"],
            platforms=["Mac", "Windows", "Linux"],
            official_url="https://cursor.com",
            docs_url="https://docs.cursor.com",
            repo_url=None,
            last_verified_at="2026-09-28 14:50 UTC"
        ),
        Technology(
            id="qdrant",
            name="Qdrant",
            tagline="High-performance vector search engine & database written in Rust.",
            category="Databases",
            developer="Qdrant Technologies",
            license="Apache 2.0 (Open Source)",
            pricing_model="Open Source",
            has_free_tier=True,
            pricing_details="100% Free self-hosted; Managed Qdrant Cloud has 1GB free tier cluster",
            has_api=True,
            current_version="v1.12.1",
            strengths=["Ultra-fast Rust vector indexing with payload-based filtering", "Native quantization (scalar, product, binary) cutting RAM by up to 90%", "Hybrid dense/sparse search built-in", "Distributed cluster clustering support"],
            limitations=["Requires understanding of vector embeddings and distance metrics", "Memory footprint requires tuning for very large scale"],
            platforms=["Docker", "Kubernetes", "Linux", "Mac", "Cloud"],
            official_url="https://qdrant.tech",
            docs_url="https://qdrant.tech/documentation",
            repo_url="https://github.com/qdrant/qdrant",
            last_verified_at="2026-09-28 14:20 UTC"
        ),
        Technology(
            id="supabase",
            name="Supabase",
            tagline="Open-source Firebase alternative powered by PostgreSQL and pgvector.",
            category="Databases",
            developer="Supabase Inc.",
            license="Apache 2.0 (Open Source)",
            pricing_model="Freemium",
            has_free_tier=True,
            pricing_details="Free tier includes 500MB database, 50k monthly active users, 1GB storage; Pro at $25/mo",
            has_api=True,
            current_version="PostgreSQL 15.6 / Supabase 2.0",
            strengths=["Standard PostgreSQL with zero proprietary lock-in", "Built-in auth, real-time WebSocket subscriptions, storage, and edge functions", "Native pgvector extension for AI embeddings", "Self-hostable with single Docker compose"],
            limitations=["Free tier databases pause after 7 days of inactivity", "Complex relational schema migrations require SQL proficiency"],
            platforms=["Web", "Docker", "Self-hosted"],
            official_url="https://supabase.com",
            docs_url="https://supabase.com/docs",
            repo_url="https://github.com/supabase/supabase",
            last_verified_at="2026-09-28 14:10 UTC"
        ),
        Technology(
            id="python",
            name="Python",
            tagline="Versatile high-level programming language dominating AI, ML, and automation.",
            category="DevTools",
            developer="Python Software Foundation",
            license="PSF License (Open Source)",
            pricing_model="Open Source",
            has_free_tier=True,
            pricing_details="100% Free and Open Source",
            has_api=True,
            current_version="3.13.0",
            strengths=["De facto industry standard for AI, PyTorch, TensorFlow, and data science", "Massive PyPI package ecosystem", "Experimental free-threaded (no-GIL) build in Python 3.13", "Clear and readable syntax"],
            limitations=["Slower raw execution speed compared to C++/Rust/Go (mitigated by JIT)", "Packaging and virtual environment tooling fragmentation historically"],
            platforms=["Cross-platform", "Linux", "Mac", "Windows", "WebAssembly"],
            official_url="https://www.python.org",
            docs_url="https://docs.python.org/3/",
            repo_url="https://github.com/python/cpython",
            last_verified_at="2026-09-28 15:10 UTC"
        ),
        Technology(
            id="nextjs",
            name="Next.js",
            tagline="The React framework for the web with Server Components and static optimization.",
            category="Frontend",
            developer="Vercel",
            license="MIT (Open Source)",
            pricing_model="Open Source",
            has_free_tier=True,
            pricing_details="Open Source framework free; Vercel Hobby hosting is free with generous limits",
            has_api=True,
            current_version="v15.0.0",
            strengths=["React 19 support with Server Components and Server Actions", "Turbopack bundler for fast local development", "Optimized image, font, and script loaders", "Flexible routing with App Router"],
            limitations=["Steep learning curve around App Router caching semantics", "Deeply tied to Vercel deployment primitives"],
            platforms=["Node.js", "Docker", "Vercel", "AWS"],
            official_url="https://nextjs.org",
            docs_url="https://nextjs.org/docs",
            repo_url="https://github.com/vercel/next.js",
            last_verified_at="2026-09-28 13:50 UTC"
        )
    ]

    for tech in sample_technologies:
        insert_or_update_technology(tech)

    # ------------------------------------------------------------------
    # 2. Current ("today") canonical events — hand-written, high impact.
    #    Timestamps are generated relative to *now* so the "New in last 24h"
    #    stat is accurate on any day the project is first run.
    # ------------------------------------------------------------------
    _now = datetime.utcnow()

    def _ts(hours_ago: float) -> str:
        return (datetime.utcnow() - timedelta(hours=hours_ago)).strftime("%Y-%m-%d %H:%M UTC")

    def _pub(hours_ago: float) -> str:
        return _ts(hours_ago + 0.5)

    current_events = [
        TechEvent(
            id="evt-python-3-13",
            technology_id="python",
            technology_name="Python",
            title="Python Unlocks True Multi-Core Speed: Heavy AI & Data Calculations Now Run Simultaneously",
            category="DevTools",
            event_type="major_upgrade",
            importance="critical",
            summary_tldr="For the first time in 30 years, Python can now use all of your computer processor cores at once without freezing. It also introduced a friendlier, colorful interactive command screen.",
            what_changed=WhatChanged(
                previous_state=[
                    "Old bottleneck: Python was restricted to running on only 1 processor core at a time, even on expensive 16-core computers",
                    "The text command terminal had no colors and didn't help you fix typing mistakes",
                    "Heavy calculations would freeze up background tasks unless you set up complex workarounds"
                ],
                new_state=[
                    "True Multi-Core Speed: All computer CPU cores can now crunch heavy calculations simultaneously",
                    "Friendly New Terminal: Full colorful syntax highlighting, multiline editing, and easy paste support",
                    "Built-in speed engine (JIT) laying the groundwork to make everyday scripts much faster"
                ]
            ),
            explanation_technical="PEP 703 enables a free-threaded build of CPython 3.13 without the Global Interpreter Lock (GIL). Introduces thread-safe reference counting and mimalloc heap isolation. A Tier 2 copy-on-write JIT translates bytecode into machine code, and PyRepl provides full multiline colored interactive terminal capabilities.",
            explanation_simple="💡 Everyday Analogy: Think of this like widening a congested 1-lane road into an 8-lane expressway. Previously, no matter how powerful your laptop was, Python forced all work through a single lane. Now, all your computer cores work together simultaneously. Your AI models and big spreadsheets finish in a fraction of the time.",
            impact_audiences=["Anyone learning Python", "AI Researchers", "Data Analysts", "Software Engineers"],
            impact_summary="Your computer can finally run multiple heavy tasks at once without slowing to a crawl.",
            primary_source_tier=1,
            sources_count=8,
            sources=[
                SourceCitation(
                    url="https://docs.python.org/3/whatsnew/3.13.html",
                    title="What's New in Python 3.13 - Official Documentation",
                    publisher="Python Software Foundation",
                    tier=1,
                    tier_label="Tier 1 - Official Docs",
                    published_at=_pub(5)
                ),
                SourceCitation(
                    url="https://github.com/python/cpython/releases/tag/v3.13.0",
                    title="CPython Release v3.13.0 Changelog",
                    publisher="GitHub CPython Releases",
                    tier=1,
                    tier_label="Tier 1 - GitHub Release",
                    published_at=_pub(4.5)
                ),
                SourceCitation(
                    url="https://www.theregister.com/python_313_nogil_release",
                    title="Python 3.13 arrives with free-threading and experimental JIT",
                    publisher="The Register",
                    tier=2,
                    tier_label="Tier 2 - Technical Press",
                    published_at=_pub(3.5)
                )
            ],
            verified_at=_ts(0.5),
            is_confirmed=True
        ),

        TechEvent(
            id="evt-gamma-export-v28",
            technology_id="gamma-app",
            technology_name="Gamma App",
            title="Gamma Now Exports AI Slides Directly into PowerPoint as Fully Editable Text & Shapes",
            category="AI/ML",
            event_type="feature_update",
            importance="significant",
            summary_tldr="You can now create an entire presentation with AI in Gamma and export it directly to PowerPoint with all text boxes, charts, and fonts staying 100% editable.",
            what_changed=WhatChanged(
                previous_state=[
                    "Exporting AI slides to PowerPoint previously converted sections into flattened picture images you couldn't edit",
                    "Custom corporate logos and company fonts were limited to generic web styles"
                ],
                new_state=[
                    "100% Editable PowerPoint: Every word, shape, card, and table can be edited inside Microsoft PowerPoint",
                    "Company Brand Kit: Upload your corporate fonts and logos so AI slides match company guidelines automatically",
                    "Viewer Analytics: See who opened and read your slides in real-time"
                ]
            ),
            explanation_technical="Gamma rebuilt their export pipeline to compile native OpenXML presentation primitives directly instead of SVG rasterization. This enables round-trip PowerPoint interoperability while preserving dynamic cards, nested tables, and column flex ratios.",
            explanation_simple="💡 Everyday Analogy: Imagine previously receiving a scanned photocopy where you couldn't fix typos or change colors. With this update, you receive an actual editable Word document. You get the 10-second speed of AI generation plus the full editing freedom of PowerPoint.",
            impact_audiences=["Students making class presentations", "Startup founders pitching investors", "Sales teams & Marketers"],
            impact_summary="You no longer have to choose between AI generation speed and PowerPoint compatibility; drafts take 10 seconds and stay fully editable.",
            primary_source_tier=1,
            sources_count=5,
            sources=[
                SourceCitation(
                    url="https://gamma.app/changelog/v2-8-powerpoint-sync",
                    title="Gamma Changelog: Editable PPTX Export & Brand Kits",
                    publisher="Gamma Official Blog",
                    tier=1,
                    tier_label="Tier 1 - Official Blog",
                    published_at=_pub(6)
                ),
                SourceCitation(
                    url="https://techcrunch.com/gamma-ai-presentation-enterprise-features",
                    title="Gamma boosts workplace utility with editable PowerPoint exports",
                    publisher="TechCrunch",
                    tier=2,
                    tier_label="Tier 2 - Technical Press",
                    published_at=_pub(4)
                )
            ],
            verified_at=_ts(1),
            is_confirmed=True
        ),

        TechEvent(
            id="evt-qdrant-quantization-v112",
            technology_id="qdrant",
            technology_name="Qdrant",
            title="AI Search Memory Breakthrough: Cloud Server Memory Slashed by 95% to Cut Hosting Bills",
            category="Databases",
            event_type="major_upgrade",
            importance="major",
            summary_tldr="A new memory compression algorithm allows AI search engines and chatbots to store millions of documents in just 5% of the memory previously required, saving huge cloud hosting costs.",
            what_changed=WhatChanged(
                previous_state=[
                    "AI knowledge bases required massive, expensive cloud servers with hundreds of gigabytes of RAM",
                    "Smaller startups and students were priced out of building large-scale search apps"
                ],
                new_state=[
                    "95% Memory Reduction: Store 50 million document embeddings on a single budget laptop or server",
                    "Ultra-Fast Instant Search: Searches millions of documents in under 5 milliseconds",
                    "Zero Noticeable Quality Loss: Accuracy remains over 98% compared to uncompressed files"
                ]
            ),
            explanation_technical="Qdrant 1.12 implements 2-bit binary quantization with hardware SIMD bitwise hamming distance acceleration. Compresses float32 embeddings down to 2 bits per dimension with an automatic oversampling rescore pipeline.",
            explanation_simple="💡 Everyday Analogy: Imagine an entire room full of bulky metal filing cabinets compressed down into a single shoebox, without misplacing a single piece of paper. You can now build massive AI knowledge bases for pennies on budget servers.",
            impact_audiences=["AI App Developers", "Startups on a budget", "Students building chatbot projects"],
            impact_summary="Drastically lowers the cost of running AI knowledge bases and semantic search tools.",
            primary_source_tier=1,
            sources_count=6,
            sources=[
                SourceCitation(
                    url="https://qdrant.tech/articles/binary-quantization-v1-12",
                    title="Binary Quantization in Qdrant 1.12: Scaling to Billions of Vectors",
                    publisher="Qdrant Official Engineering Blog",
                    tier=1,
                    tier_label="Tier 1 - Official Docs",
                    published_at=_pub(7)
                ),
                SourceCitation(
                    url="https://venturebeat.com/ai/qdrant-vector-database-memory-breakthrough",
                    title="Qdrant tackles AI vector storage inflation with new compression techniques",
                    publisher="VentureBeat",
                    tier=2,
                    tier_label="Tier 2 - Technical Press",
                    published_at=_pub(5.2)
                )
            ],
            verified_at=_ts(0.8),
            is_confirmed=True
        ),

        TechEvent(
            id="evt-cursor-composer-v041",
            technology_id="cursor",
            technology_name="Cursor",
            title="Cursor AI Can Now Code Quietly in Background & Fix Its Own Mistakes Before Showing You",
            category="DevTools",
            event_type="feature_update",
            importance="major",
            summary_tldr="Instead of waiting for an AI to write code line by line, you can assign it a large task across multiple files. It tests its own code silently and only shows you a clean, working preview.",
            what_changed=WhatChanged(
                previous_state=[
                    "You had to stare at the screen and wait for the AI to finish writing each individual file",
                    "If the AI made a syntax or typo error, you had to manually diagnose and point it out"
                ],
                new_state=[
                    "Autonomous Background Mode: Give the AI a multi-step task and continue doing your own work",
                    "Self-Healing Code: The AI automatically runs tests and fixes its own mistakes before presenting results",
                    "1-Click Visual Review: See a clean color-coded diff of what changed and approve or reject with one click"
                ]
            ),
            explanation_technical="Cursor Composer executes within an isolated git worktree branch, running test runners and LSP diagnostics. If a syntax or type error is detected, the agent feeds the diagnostic back into context for up to 3 self-correction iterations.",
            explanation_simple="💡 Everyday Analogy: Like handing a junior assistant a complex assignment to finish at their own desk, rather than having them hover over your shoulder typing. They complete the assignment, check for typos themselves, and only present you with the final clean draft.",
            impact_audiences=["Programmers", "Freelancers", "Computer Science Students", "Solo Founders"],
            impact_summary="Saves hours of tedious repetitive work when updating websites or refactoring multiple files.",
            primary_source_tier=1,
            sources_count=7,
            sources=[
                SourceCitation(
                    url="https://cursor.com/changelog/0-41",
                    title="Cursor 0.41: Background Agents and Self-Healing Code",
                    publisher="Cursor Official Changelog",
                    tier=1,
                    tier_label="Tier 1 - Official Changelog",
                    published_at=_pub(7.8)
                )
            ],
            verified_at=_ts(1.2),
            is_confirmed=True
        ),

        TechEvent(
            id="evt-security-openssl-cve-2026",
            technology_id=None,
            technology_name="OpenSSL",
            title="Critical Internet Security Patch Released: Prevents Attackers from Remotely Crashing Web Servers",
            category="Security",
            event_type="security_patch",
            importance="critical",
            summary_tldr="An emergency security fix was released for OpenSSL to patch a dangerous loophole that malicious actors could use to crash web servers worldwide. Server owners must update immediately.",
            what_changed=WhatChanged(
                previous_state=[
                    "Vulnerability: Attackers could send corrupted connection requests that instantly crashed web servers without needing a password"
                ],
                new_state=[
                    "Emergency Safety Patch: OpenSSL 3.3.2, 3.2.3, and 3.0.15 completely close this vulnerability",
                    "Immediate Action: Web hosts and server owners are urged to install the free update now"
                ]
            ),
            explanation_technical="CVE-2026-4819 involves improper state validation when processing truncated ServerKeyExchange structures during post-handshake client authentication in TLS 1.3, allowing remote denial-of-service crashes.",
            explanation_simple="💡 Everyday Analogy: Imagine a building security door lock that would jam and lock everyone out if someone jiggled the handle in an unusual way. The lock manufacturer just distributed a free emergency replacement lock so the building stays protected.",
            impact_audiences=["Website Owners", "Cloud Engineers", "System Administrators", "IT Security Teams"],
            impact_summary="Immediate free security patch needed for websites and web servers to prevent crashes.",
            primary_source_tier=1,
            sources_count=11,
            sources=[
                SourceCitation(
                    url="https://www.openssl.org/news/secadv/20260928.txt",
                    title="OpenSSL Security Advisory - 28 Sep 2026",
                    publisher="OpenSSL Security Team",
                    tier=1,
                    tier_label="Tier 1 - Official Advisory",
                    published_at=_pub(9.5)
                ),
                SourceCitation(
                    url="https://nvd.nist.gov/vuln/detail/CVE-2026-4819",
                    title="NVD National Vulnerability Database - CVE-2026-4819",
                    publisher="NIST NVD",
                    tier=1,
                    tier_label="Tier 1 - Official NVD",
                    published_at=_pub(9)
                )
            ],
            verified_at=_ts(0.2),
            is_confirmed=True
        )
    ]

    for event in current_events:
        insert_event(event)

    # ------------------------------------------------------------------
    # 3. Generate a realistic 30-day history for every tracked technology so
    #    the dashboard can show version evolution instead of a single day.
    #
    #    This must stay idempotent. We remember the day the history was anchored
    #    to; if the database is still on that day we leave the rows alone, and if
    #    the day has rolled over we rebuild the month so "past 30 days" keeps
    #    meaning what it says instead of slowly draining into empty history.
    # ------------------------------------------------------------------
    from .seed_history import generate_history_events

    today = datetime.utcnow().strftime("%Y-%m-%d")
    anchored_day = get_seed_meta("history_anchor_day")

    if anchored_day == today and count_generated_history() > 0:
        # Already seeded for today — nothing to do.
        pass
    else:
        if count_generated_history() > 0:
            delete_generated_history()
        for hist_event in generate_history_events(sample_technologies):
            insert_event(hist_event)
        set_seed_meta("history_anchor_day", today)


# Initialize on import
init_db()
seed_database()
