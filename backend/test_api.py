import asyncio
import sys
import os

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import init_db, seed_database, get_all_events, get_all_technologies, get_stats
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
    print("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")
    print("========================================")

if __name__ == "__main__":
    asyncio.run(run_tests())
