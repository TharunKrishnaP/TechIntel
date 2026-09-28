import asyncio
import sys
import os

# Windows consoles default to cp1252, which cannot render the emoji used in the
# plain-English explanations. Force UTF-8 so the report prints cleanly.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import (
    init_db, seed_database, get_all_events, get_all_technologies, get_stats,
    get_technology_evolution
)
from backend.services.matcher import match_tools_for_purpose, generate_comparison_matrix, find_alternatives_for_tool
from backend.pipeline.ingestion import sync_all_feeds

async def run_tests():
    print("========================================")
    print("1. Testing Database & Seed Data")
    print("========================================")
    seed_database()
    events = get_all_events()
    technologies = get_all_technologies()
    stats = get_stats()

    print(f"Total events in database: {len(events)}")
    print(f"Total technologies in database: {len(technologies)}")
    print(f"Stats: Total={stats.total_events}, Security Alerts={stats.critical_security_count}, AI Updates={stats.ai_updates_count}")
    assert len(events) >= 5, "Expected at least 5 seeded events"
    assert len(technologies) >= 6, "Expected at least 6 seeded technologies"

    print("\n========================================")
    print("2. Verifying Canonical Event Model & Tiers")
    print("========================================")
    sample_evt = events[0]
    print(f"Title: {sample_evt.title}")
    print(f"Event Type: {sample_evt.event_type} | Importance: {sample_evt.importance}")
    print(f"Primary Source Tier: Tier {sample_evt.primary_source_tier}")
    print(f"Reporting Sources Count: {sample_evt.sources_count}")
    print(f"What Changed (Previous): {sample_evt.what_changed.previous_state[:1]}")
    print(f"What Changed (New): {sample_evt.what_changed.new_state[:1]}")
    print(f"Technical Explanation: {sample_evt.explanation_technical[:80]}...")
    print(f"Simple Explanation: {sample_evt.explanation_simple[:80]}...")

    assert sample_evt.what_changed.previous_state, "What Changed previous state should not be empty"
    assert sample_evt.what_changed.new_state, "What Changed new state should not be empty"
    assert sample_evt.sources, "Event sources list should not be empty"

    print("\n========================================")
    print("3. Testing Purpose-Based Tool Finder")
    print("Query: 'I need a free AI tool to generate presentations'")
    print("========================================")
    result = match_tools_for_purpose(
        query="I need a free AI tool to generate presentations",
        user_skill_level="Beginner",
        force_free_only=True
    )

    print(f"Extracted Purpose: {result.requirements.purpose}")
    print(f"Extracted Category: {result.requirements.category}")
    print(f"Extracted Budget: {result.requirements.budget}")
    print(f"Extracted Skill: {result.requirements.skill_level}")
    print(f"Top Recommended Tools count: {len(result.recommendations)}")

    for i, rec in enumerate(result.recommendations[:3], 1):
        print(f"\n#{i}: {rec.technology.name} (Suitability Score: {rec.suitability_score}%)")
        print(f"   Pricing: {rec.technology.pricing_model} | Free Tier: {rec.technology.has_free_tier}")
        print(f"   Why this tool?: {rec.why_this_tool}")
        print(f"   Tradeoffs: {rec.tradeoffs}")

    assert len(result.recommendations) > 0, "Expected recommendations for presentation query"
    top_tool = result.recommendations[0]
    # Gamma or SlidesAI should score highest because they have free tiers for presentations
    assert top_tool.technology.has_free_tier, "Top recommendation with force_free_only should have a free tier"

    print("\n========================================")
    print("4. Testing Side-by-Side Comparison Matrix")
    print("========================================")
    comparison = generate_comparison_matrix(["gamma-app", "beautiful-ai", "slidesai"])
    print(f"Tools compared: {[t.name for t in comparison.tools]}")
    print(f"Total comparison criteria: {len(comparison.matrix)}")
    for crit in comparison.matrix[:4]:
        print(f"  {crit.criterion}: {crit.values}")
    print(f"Verdict: {comparison.verdict}")
    assert len(comparison.tools) == 3, "Expected 3 tools in comparison"

    print("\n========================================")
    print("5. Testing Alternatives Finder")
    print("========================================")
    alts = find_alternatives_for_tool("gamma-app")
    print(f"Alternatives for Gamma App: {[a.name for a in alts]}")
    assert len(alts) > 0, "Expected alternatives for gamma-app"

    print("\n========================================")
    print("6. Testing Historical Time-Window Filtering")
    print("========================================")
    all_events = get_all_events(limit=200)
    last_24h = get_all_events(limit=200, days=1)
    last_week = get_all_events(limit=200, days=7)
    last_month = get_all_events(limit=200, days=30)

    print(f"All events:        {len(all_events)}")
    print(f"Last 24 hours:     {len(last_24h)}")
    print(f"Last 7 days:       {len(last_week)}")
    print(f"Last 30 days:      {len(last_month)}")

    # Windows must be monotonically nested, and the stats must agree with the feed.
    assert len(last_24h) <= len(last_week) <= len(last_month) <= len(all_events), \
        "Time windows must be monotonically nested"
    assert stats.new_today == len(last_24h), f"new_today ({stats.new_today}) != 24h feed ({len(last_24h)})"
    assert stats.new_this_week == len(last_week), f"new_this_week ({stats.new_this_week}) != 7d feed ({len(last_week)})"
    assert stats.new_this_month == len(last_month), f"new_this_month ({stats.new_this_month}) != 30d feed ({len(last_month)})"

    # The 30-day window should actually contain multi-day history, otherwise the
    # dashboard is showing a single day with extra steps.
    distinct_days = {e.verified_at[:10] for e in last_month}
    print(f"Distinct days present in the 30-day window: {len(distinct_days)}")
    assert len(distinct_days) >= 14, f"Expected a month of history, found only {len(distinct_days)} distinct days"
    assert len(last_month) > len(last_24h), "Expected more events across 30 days than in a single day"

    print("\n========================================")
    print("7. Testing Technology Evolution Timeline")
    print("========================================")
    for tech_id in ("python", "nextjs", "qdrant"):
        evo = get_technology_evolution(tech_id, days=30)
        assert "error" not in evo, f"No evolution data for {tech_id}"
        assert evo["period_days"] == 30
        assert evo["summary"]["total_events"] > 0, f"Expected history for {tech_id}"
        print(f"{evo['technology']['name']} (now {evo['technology']['current_version']}):")
        print(f"   events={evo['summary']['total_events']} "
              f"releases={evo['summary']['version_releases']} "
              f"features={evo['summary']['feature_updates']} "
              f"patches={evo['summary']['security_patches']}")
        print(f"   version trail: {[v['version'] for v in evo['version_timeline']]}")
        print(f"   breakdown: {evo['event_breakdown']}")
        # Version trail must read oldest -> newest for the UI stepper.
        dates = [v["date"] for v in evo["version_timeline"]]
        assert dates == sorted(dates), f"Version trail not chronological for {tech_id}"
        # Every trail entry must carry a real version, and the trail must show
        # more than one distinct version or it isn't an "evolution" at all.
        assert all(v["version"] for v in evo["version_timeline"]), \
            f"Version trail has unlabelled entries for {tech_id}"
        distinct_versions = {v["version"] for v in evo["version_timeline"]}
        assert len(distinct_versions) >= 2, \
            f"Expected multiple versions in the trail for {tech_id}, got {distinct_versions}"

    missing = get_technology_evolution("does-not-exist", days=30)
    assert "error" in missing, "Expected an error for an unknown technology id"

    print("\n========================================")
    print("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")
    print("========================================")

if __name__ == "__main__":
    asyncio.run(run_tests())
