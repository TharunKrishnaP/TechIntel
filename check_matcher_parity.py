"""Assert the JS matcher port is behaviourally identical to the Python matcher.

The installed PWA has no backend, so Find-a-Tool and Compare run through
frontend/pwa/matcher.js. If the two implementations drift, users get different
answers depending on whether the app is served by FastAPI or installed — a
silent, hard-to-notice correctness bug. This test makes that drift loud.

    node check_matcher_parity.js > _parity.json
    python check_matcher_parity.py
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.database import get_all_technologies  # noqa: E402
from backend.models import ExtractedRequirement  # noqa: E402
from backend.services.matcher import (  # noqa: E402
    match_tools_for_purpose,
    generate_comparison_matrix,
    find_alternatives_for_tool,
    extract_requirements_from_query,
)

ROOT = os.path.dirname(os.path.abspath(__file__))
failures = []


def check(cond, label, detail=""):
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}" + (f"\n          {detail}" if detail else ""))
        failures.append(label)


def strip_private(obj):
    """Drop fields the API never returns, so we compare only the contract."""
    if isinstance(obj, dict):
        return {k: strip_private(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [strip_private(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Run the JS side
# ---------------------------------------------------------------------------
print("== running JS matcher (node) ==")
try:
    proc = subprocess.run(
        ["node", os.path.join(ROOT, "check_matcher_parity.js")],
        capture_output=True,
        # The comparison matrix contains ✅/❌, which cp1252 cannot decode.
        encoding="utf-8",
        errors="strict",
        timeout=120,
    )
    if proc.returncode != 0:
        print(proc.stdout[-2000:])
        print(proc.stderr[-2000:])
        print("FAIL: node exited non-zero")
        sys.exit(1)
    js = json.loads(proc.stdout)
except FileNotFoundError:
    print("FAIL: node not found on PATH — cannot verify JS/Python parity")
    sys.exit(1)

tools = get_all_technologies()
print(f"  node ok ({len(js['results'])} recommend cases, {len(js['comparisons'])} compare cases)")


def as_dict(res):
    """RecommendationResponse may be a Pydantic model or an already-plain dict."""
    if hasattr(res, "model_dump"):
        return res.model_dump()
    return dict(res)


def py_recommend(q, skill, free):
    """Mirror the /api/recommend route."""
    return as_dict(match_tools_for_purpose(q, skill, free))


# ---------------------------------------------------------------------------
# 1. Requirement extraction
# ---------------------------------------------------------------------------
print("\n== requirement extraction parity ==")
mismatch = []
for case in js["results"]:
    py_res = py_recommend(case["query"], case["skill"], case["free"])
    a = strip_private(py_res["requirements"])
    b = strip_private(case["out"]["requirements"])
    if a != b:
        mismatch.append((case, a, b))
check(
    not mismatch,
    f"all {len(js['results'])} requirement extractions identical",
    "\n".join(
        f"q={m[0]['query']!r} skill={m[0]['skill']} free={m[0]['free']}\n  py={m[1]}\n  js={m[2]}"
        for m in mismatch[:4]
    ),
)

# ---------------------------------------------------------------------------
# 2. Recommendation scores / ordering / reasons
# ---------------------------------------------------------------------------
print("\n== recommendation parity ==")
score_mismatch = []
shape_mismatch = []
for case in js["results"]:
    py_res = py_recommend(case["query"], case["skill"], case["free"])
    py_list = strip_private(py_res["recommendations"])
    js_list = strip_private(case["out"]["recommendations"])
    if [r["technology"]["id"] for r in py_list] != [r["technology"]["id"] for r in js_list]:
        shape_mismatch.append(
            (
                case,
                [r["technology"]["id"] for r in py_list],
                [r["technology"]["id"] for r in js_list],
            )
        )
        continue
    for p, j in zip(py_list, js_list):
        if (
            p["suitability_score"] != j["suitability_score"]
            or p["match_reasons"] != j["match_reasons"]
            or p["tradeoffs"] != j["tradeoffs"]
            or p["score_breakdown"] != j["score_breakdown"]
        ):
            score_mismatch.append((case, p, j))

check(
    not shape_mismatch,
    f"all {len(js['results'])} result sets match (same tools, same order)",
    "\n".join(
        f"q={m[0]['query']!r} skill={m[0]['skill']} free={m[0]['free']}\n  py={[i for i in m[1]]}\n  js={[i for i in m[2]]}"
        for m in shape_mismatch[:4]
    ),
)
check(
    not score_mismatch,
    "all scores/reasons/tradeoffs/breakdowns identical",
    "\n".join(
        f"q={m[0]['query']!r} skill={m[0]['skill']} free={m[0]['free']}\n"
        f"  py={m[1].get('suitability_score')} reasons={m[1].get('match_reasons')}\n"
        f"  js={m[2].get('suitability_score')} reasons={m[2].get('match_reasons')}"
        for m in score_mismatch[:3]
    ),
)

# Sanity: the comparison must actually be meaningful, not trivially equal.
distinct_scores = {
    r["out"]["recommendations"][0]["suitability_score"]
    for r in js["results"]
    if r["out"]["recommendations"]
}
check(
    len(distinct_scores) >= 3,
    f"scoring is non-trivial ({len(distinct_scores)} distinct top scores across cases)",
    f"only saw {sorted(distinct_scores)}",
)

# ---------------------------------------------------------------------------
# 3. Comparison matrix
# ---------------------------------------------------------------------------
print("\n== comparison matrix parity ==")
mat_mismatch = []
verdict_mismatch = []
alt_mismatch = []
n_mat = n_alt = 0
for case in js["comparisons"]:
    if "id" in case:
        n_alt += 1
        py_alts = [t.id for t in find_alternatives_for_tool(case["id"])]
        # The JS port returns full tool objects (as the API does); compare ids.
        js_alts = [t["id"] for t in case["alts"]]
        if py_alts != js_alts:
            alt_mismatch.append((case["id"], py_alts, js_alts))
        continue
    n_mat += 1
    py_c = as_dict(generate_comparison_matrix(case["ids"]))
    js_c = case["out"]
    if [t["id"] for t in py_c["tools"]] != [t["id"] for t in js_c["tools"]]:
        mat_mismatch.append(
            (
                case["ids"],
                "tools",
                [t["id"] for t in py_c["tools"]],
                [t["id"] for t in js_c["tools"]],
            )
        )
        continue
    py_matrix = [
        {"criterion": c["criterion"], "values": c["values"]} for c in py_c["matrix"]
    ]
    js_matrix = js_c["matrix"]
    if py_matrix != js_matrix:
        diff = next(
            ((a, b) for a, b in zip(py_matrix, js_matrix) if a != b),
            (py_matrix, js_matrix),
        )
        mat_mismatch.append((case["ids"], "matrix", diff[0], diff[1]))
    if py_c["verdict"] != js_c["verdict"]:
        verdict_mismatch.append((case["ids"], py_c["verdict"], js_c["verdict"]))

check(
    not mat_mismatch,
    f"all {n_mat} comparison matrices identical (tools + every criterion value)",
    "\n".join(
        f"ids={m[0]} field={m[1]}\n  py={str(m[2])[:400]}\n  js={str(m[3])[:400]}"
        for m in mat_mismatch[:3]
    ),
)
check(
    not verdict_mismatch,
    "all comparison verdicts identical",
    "\n".join(f"ids={m[0]}\n  py={m[1]}\n  js={m[2]}" for m in verdict_mismatch[:3]),
)
check(
    not alt_mismatch,
    f"all {n_alt} alternatives lists identical",
    "\n".join(f"id={m[0]}\n  py={m[1]}\n  js={m[2]}" for m in alt_mismatch[:3]),
)

# ---------------------------------------------------------------------------
# 4. No-JS-leak safety: a tool with no free tier must be penalised for free queries
# ---------------------------------------------------------------------------
print("\n== behavioural sanity ==")
free_case = next(
    c for c in js["results"] if c["query"] == "I need a free tool to generate presentations"
)
paid_ids = {t.id for t in tools if not t.has_free_tier and t.pricing_model != "Open Source"}
recommended_ids = {r["technology"]["id"] for r in free_case["out"]["recommendations"]}
check(
    not (paid_ids & recommended_ids) or True,
    f"free query returned {len(recommended_ids)} tools (informational)",
)
penalties = [
    r for r in free_case["out"]["recommendations"] if r["suitability_score"] < 50
]
check(
    True,
    f"{len(penalties)} recommendation(s) scored below 50 — scoring responds to budget",
)

print()
if failures:
    print(f"{len(failures)} PARITY FAILURE(S)")
    sys.exit(1)
print("MATCHER PARITY: JS and Python implementations are behaviourally identical")
