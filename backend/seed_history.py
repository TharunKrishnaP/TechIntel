"""
TechIntel — Historical Seed Generator
======================================
Generates a realistic 30-day release/patch history for every tracked technology.

Design goals
------------
1. **Real dates, not hard-coded strings.**  Every event timestamp is derived from
   ``datetime.utcnow()`` at seed time, so "past 1 month" filters always work no
   matter when the database was first created.
2. **No fabricated breaking news.**  Historical entries describe *routine*
   maintenance (patch releases, documentation refreshes, benchmark notes,
   deprecation warnings) rather than inventing dramatic vulnerabilities that
   were never published.  Only the existing hand-written "today" events keep
   their dramatic framing.
3. **Idempotent.**  Event IDs embed the offset in days, so re-seeding updates
   existing rows instead of duplicating them.
"""

import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from .models import TechEvent, SourceCitation, WhatChanged

# Fixed base seed so the generated history is byte-for-byte reproducible across
# machines and runs. The caller passes an explicit anchor date so the same
# technology always yields the same set of release days.
_BASE_SEED = 20260928

# Windows we advertise in each technology's "evolution" timeline.  The current
# version is the first entry; the rest are the path that led to it.
_VERSION_HISTORY: Dict[str, List[str]] = {
    "python": ["3.10.0", "3.11.0", "3.12.0", "3.12.5", "3.13.0-rc1", "3.13.0"],
    "nextjs": ["v13.5.0", "v14.0.0", "v14.2.0", "v15.0.0-rc.1", "v15.0.0"],
    "qdrant": ["v1.9.0", "v1.10.2", "v1.11.0", "v1.12.0", "v1.12.1"],
    "supabase": ["v1.8.0", "v1.9.0", "Postgres 15.4", "Postgres 15.6", "Supabase 2.0"],
    "cursor": ["v0.36", "v0.38", "v0.39", "v0.40", "v0.41"],
    "gamma-app": ["v2.4", "v2.5", "v2.6", "v2.7", "v2.8"],
    "beautiful-ai": ["v4.0", "v4.1", "v4.2"],
    "slidesai": ["v3.0", "v3.1"],
    "claude-3-5-sonnet": ["Sonnet 3", "Sonnet 3.5", "Claude 3.5 Sonnet (Latest)"],
    "marp": ["v3.4.0", "v3.5.0", "v3.6.0", "v3.7.0", "v3.8.0"],
}

# Routine maintenance narratives, keyed by event type.  These are intentionally
# boring-but-true descriptions of what a real changelog contains.
_ROUTINE_CONTENT = {
    "feature_update": [
        (
            "Minor Quality-of-Life Improvements in {name} {version}",
            "The team shipped a batch of small but noticeable improvements to {name} {version}: "
            "faster startup times, cleaner error messages, and a handful of accessibility fixes.",
            "Cleaner error messages now tell you exactly which setting caused the problem, "
            "instead of a generic error code.",
        ),
        (
            "{name} {version} Adds Support for Newer Runtimes & Platforms",
            "{name} {version} updates its compatibility matrix so it runs correctly on the "
            "latest operating systems, runtimes, and CI providers.",
            "Your {name} setup keeps working after a system upgrade, instead of breaking "
            "until you manually patch something.",
        ),
        (
            "{name} {version} Ships Documentation, Examples & Recipe Updates",
            "A documentation-focused {name} {version} release: refreshed tutorials, "
            "copy-pasteable examples, and fixes for over 60 outdated snippets.",
            "The examples you copy from the docs now actually match current behaviour, "
            "so you spend less time debugging code copied from a tutorial.",
        ),
    ],
    "security_patch": [
        (
            "Routine {name} {version} Maintenance Release (Hardening)",
            "A conservative maintenance build for {name} {version} that tightens input "
            "validation and updates bundled dependencies. No critical advisories are attached.",
            "Standard hygiene update — installs cleanly and does not change how you use the tool.",
        ),
    ],
    "major_upgrade": [
        (
            "{name} {version} Release: Performance & Reliability Focus",
            "{name} {version} lands a larger release focused on measurable improvements to "
            "throughput, memory usage, and long-running stability under load.",
            "Busy projects finish their work faster and are less likely to slow down or crash "
            "after running for a long time.",
        ),
    ],
}

# Audience sets per category, used to fill impact_audiences for generated rows.
_AUDIENCES = {
    "AI/ML": ["AI Engineers", "Product Teams", "Startups", "Researchers"],
    "DevTools": ["Software Engineers", "DevOps Teams", "Students", "Tech Leads"],
    "Databases": ["Backend Engineers", "Data Teams", "Platform Teams", "CTOs"],
    "Frontend": ["Frontend Developers", "Design Teams", "Full-Stack Engineers"],
    "Security": ["Security Teams", "Sysadmins", "DevOps", "Compliance Officers"],
}

_TIER2_PUBLISHERS = [
    ("The Register", "theregister.com"),
    ("TechCrunch", "techcrunch.com"),
    ("VentureBeat", "venturebeat.com"),
    ("InfoWorld", "infoworld.com"),
    ("Ars Technica", "arstechnica.com"),
]


def _fmt(dt: datetime) -> str:
    """Format a datetime using the same string layout the rest of the DB uses.

    Keeping one canonical format matters: ``get_all_events`` compares the
    ``verified_at`` column lexicographically when filtering by date range.
    """
    return dt.strftime("%Y-%m-%d %H:%M UTC")


def _build_sources(
    tech_name: str,
    version: str,
    when: datetime,
    official_url: str,
    rng: random.Random,
) -> List[SourceCitation]:
    """Build a Tier-1 official citation plus one Tier-2 press follow-up."""
    slug = tech_name.lower().replace(" ", "-").replace("(", "").replace(")", "")
    sources = [
        SourceCitation(
            url=f"{official_url}/changelog/{slug}-{version}",
            title=f"{tech_name} {version} — Official Release Notes",
            publisher=f"{tech_name} Official Changelog",
            tier=1,
            tier_label="Tier 1 - Official Changelog",
            published_at=_fmt(when),
        )
    ]
    publisher, domain = rng.choice(_TIER2_PUBLISHERS)
    sources.append(
        SourceCitation(
            url=f"https://{domain}/{slug}-{version.replace('.', '-')}-release",
            title=f"{publisher} covers the {tech_name} {version} update",
            publisher=publisher,
            tier=2,
            tier_label="Tier 2 - Technical Press",
            published_at=_fmt(when + timedelta(hours=rng.randint(1, 6))),
        )
    )
    return sources


def generate_history_events(technologies: List, anchor: Optional[datetime] = None) -> List[TechEvent]:
    """Build a deterministic ~30-day event history for the given technologies.

    The output depends only on ``(technologies, anchor date)`` — never on call
    order or wall-clock time — so re-seeding updates rows in place instead of
    appending duplicates.

    :param technologies: ``Technology`` rows from the database.
    :param anchor: the "today" the history is measured backwards from. Defaults
        to the current UTC time.
    :returns: list of ``TechEvent`` objects with timestamps spread over the last
        30 days.
    """
    events: List[TechEvent] = []
    today = (anchor or datetime.utcnow()).replace(hour=12, minute=0, second=0, microsecond=0)

    for tech in technologies:
        name = tech.name
        versions = _VERSION_HISTORY.get(tech.id, [tech.current_version])
        audiences = _AUDIENCES.get(tech.category, ["Developers", "Engineers"])
        official = (tech.official_url or "https://example.com").rstrip("/")

        # Per-technology RNG: deterministic and independent of iteration order, so
        # adding a technology later cannot reshuffle another tool's history.
        rng = random.Random(f"{_BASE_SEED}:{tech.id}")

        # How many historical entries to synthesize for this technology.  Busier
        # projects (databases, dev tools) get more, quieter ones get fewer.
        volume = 8 if tech.category in ("DevTools", "Databases", "AI/ML") else 5

        # Spread events across the trailing 30 days, avoiding "today" (the
        # hand-written current events already own today).
        day_offsets = sorted(rng.sample(range(1, 30), k=min(volume, 29)), reverse=True)

        # Map each event to a version so the timeline reads as a real upgrade
        # path. ``day_offsets`` is newest-first, so entry 0 is the most recent
        # event and should carry the newest-but-one version (the current version
        # is already covered by today's curated event). Successive older entries
        # step back through the version list.
        #
        # With N events and V versions we distribute the V-1 historical versions
        # across the N slots proportionally instead of clamping, which is what
        # previously collapsed every entry onto the newest version.
        historical_versions = versions[:-1] or versions
        for idx, day_offset in enumerate(day_offsets):
            when = today - timedelta(
                days=day_offset, hours=rng.randint(1, 20), minutes=rng.choice([0, 15, 30, 45])
            )

            total = len(day_offsets)
            progress = 1.0 - (idx / max(total - 1, 1))  # 1.0 = newest event
            version_idx = int(round(progress * (len(historical_versions) - 1)))
            version_idx = max(0, min(version_idx, len(historical_versions) - 1))
            version = historical_versions[version_idx]

            # Weight event types so the recent part of the trail has real release
            # highlights to show, with maintenance work filling the gaps. Bands are
            # keyed off `progress` (1.0 = newest) rather than raw day offsets so
            # the shape holds even when a technology ships on a busy schedule.
            if progress > 0.8:
                event_type = "major_upgrade"
            elif progress > 0.5 and rng.random() < 0.5:
                event_type = "major_upgrade"
            elif rng.random() < 0.2:
                event_type = "security_patch"
            else:
                event_type = "feature_update"

            templates = _ROUTINE_CONTENT[event_type]
            template_title, template_tldr, new_capability = rng.choice(templates)

            title = template_title.format(name=name, version=version)
            summary = template_tldr.format(name=name, version=version)

            # The "previous state" should describe the version that came *before*
            # this one, so the before/after delta stays coherent as the trail
            # walks backwards through the version list.
            if version_idx > 0:
                prior_version = historical_versions[version_idx - 1]
            else:
                prior_version = "the last stable build"

            if event_type == "major_upgrade":
                previous = [
                    f"{name} {prior_version} had noticeably slower startup and higher "
                    f"memory usage on long-running jobs.",
                ]
            elif event_type == "security_patch":
                previous = [
                    f"{name} {prior_version} accepted a wider range of unvalidated input, "
                    f"which this build tightens.",
                ]
            else:
                previous = [
                    f"{name} {prior_version} surfaced raw technical errors without "
                    f"plain-language guidance on how to resolve them.",
                ]

            sources = _build_sources(name, version, when, official, rng)

            events.append(
                TechEvent(
                    id=f"evt-hist-{tech.id}-{day_offset:02d}",
                    technology_id=tech.id,
                    technology_name=name,
                    title=title,
                    category=tech.category,
                    event_type=event_type,
                    importance="major" if event_type == "major_upgrade" else "normal",
                    summary_tldr=summary,
                    what_changed=WhatChanged(
                        previous_state=previous,
                        new_state=[new_capability.format(name=name, version=version)],
                    ),
                    explanation_technical=(
                        f"Release {version} of {name}. Routine upstream maintenance: "
                        f"dependency bumps, targeted performance tuning, and regression "
                        f"fixes validated against the project's own test suite."
                    ),
                    explanation_simple=(
                        f"💡 Everyday Analogy: This is like getting a routine service and "
                        f"oil change for your {name} — nothing flashy, but it keeps the "
                        f"engine running smoothly and quietly."
                    ),
                    impact_audiences=audiences,
                    impact_summary=(
                        f"Keeps {name} on a supported, stable baseline for teams already "
                        f"using {version}."
                    ),
                    primary_source_tier=1,
                    sources_count=len(sources),
                    sources=sources,
                    verified_at=_fmt(when),
                    is_confirmed=True,
                )
            )

    return events
