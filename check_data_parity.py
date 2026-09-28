"""Assert the static (installed) data adapter answers identically to the live API.

The whole point of the PWA is that `frontend/data/*.json` stands in for
`/api/*`. That substitution is only safe if the two agree — and the riskiest
part is date filtering, which is implemented twice: as SQL in `get_all_events`
and as string comparison in `pwa/api.js`. A drift there produces an app that
quietly shows the wrong number of events.

    node check_data_parity.js  (invoked below)
    python check_data_parity.py
"""

import json
import os
import subprocess
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
failures = []


def check(cond, label, detail=""):
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}" + (f"\n          {detail}" if detail else ""))
        failures.append(label)


def ids(rows):
    return [r["id"] for r in rows]


client = TestClient(app)

# ---------------------------------------------------------------------------
# Run the JS adapter in static mode
# ---------------------------------------------------------------------------
print("== running static adapter (node, no backend) ==")
try:
    proc = subprocess.run(
        ["node", os.path.join(ROOT, "check_data_parity.js")],
        capture_output=True,
        encoding="utf-8",
        timeout=180,
    )
    if proc.returncode != 0:
        print(proc.stderr[-3000:])
        print("FAIL: node exited non-zero")
        sys.exit(1)
    js = json.loads(proc.stdout)
except FileNotFoundError:
    print("FAIL: node not found on PATH — cannot verify adapter parity")
    sys.exit(1)

print(f"  adapter reported mode = {js['mode']!r}")
check(js["mode"] == "static", "adapter correctly fell back to static mode with no backend")
check(
    js["refreshSupported"] is False,
    "static mode reports live sync as unsupported",
)
check(
    js["refresh"].get("status") == "unsupported",
    "refreshFeed() returns an explicit 'unsupported' status rather than failing",
)

# ---------------------------------------------------------------------------
# 1. Stats
# ---------------------------------------------------------------------------
print("\n== stats parity ==")
live = client.get("/api/stats").json()
st = js["stats"]
for key in (
    "total_events",
    "new_today",
    "new_this_week",
    "new_this_month",
    "critical_security_count",
    "ai_updates_count",
    "verified_sources_count",
):
    check(
        st[key] == live[key],
        f"{key}: static={st[key]} live={live[key]}",
    )
check(
    st["last_sync"] != live["last_sync"] and "napshot" in st["last_sync"],
    f"static mode labels its sync state honestly ({st['last_sync']!r} vs live {live['last_sync']!r})",
)

# ---------------------------------------------------------------------------
# 2. Feed windows — the highest-risk area
# ---------------------------------------------------------------------------
print("\n== feed window parity ==")
for case in js["feeds"]:
    w = case["w"]
    # The adapter's JS-facing params are camelCase; the API's are snake_case.
    # Map them explicitly — sending camelCase would be silently ignored by
    # FastAPI and the test would compare filtered vs unfiltered by accident.
    params = []
    if "days" in w:
        params.append(f"days={w['days']}")
    if "dateFrom" in w:
        params.append(f"date_from={w['dateFrom']}")
    if "dateTo" in w:
        params.append(f"date_to={w['dateTo']}")
    path = f"/api/feed?limit={w.get('limit', 100)}&offset={w.get('offset', 0)}"
    if params:
        path += "&" + "&".join(params)
    live_rows = client.get(path).json()
    js_rows = case["out"]
    same = ids(live_rows) == ids(js_rows)
    check(
        same,
        f"window {w} -> {len(js_rows)} events, identical order and membership",
        f"live={ids(live_rows)[:8]}\n          static={ids(js_rows)[:8]}"
        if not same
        else "",
    )
    # A window that should actually narrow the result must do so on both sides.
    if "days" in w and w["days"] < 30:
        check(
            len(live_rows) < live["total_events"],
            f"window {w} genuinely narrows the live result ({len(live_rows)} < {live['total_events']})",
        )
    if "dateFrom" in w or "dateTo" in w:
        check(
            len(live_rows) < live["total_events"],
            f"window {w} genuinely narrows the live result ({len(live_rows)} < {live['total_events']})",
        )
    if same:
        # Ordering must be newest-first; a stable-but-wrong sort would still match
        # element-wise while rendering the history backwards.
        stamps = [r["verified_at"] for r in js_rows]
        check(
            stamps == sorted(stamps, reverse=True),
            f"window {w} sorted newest-first",
        )

# The static export must not silently truncate below the default limit.
all_rows = js["feeds"][2]["out"]  # days=30, limit=200
check(
    len(all_rows) == live["total_events"],
    f"30-day window returns the full dataset ({len(all_rows)}/{live['total_events']})",
)

# ---------------------------------------------------------------------------
# 3. Tools
# ---------------------------------------------------------------------------
print("\n== tool directory parity ==")
live_tools = client.get("/api/tools").json()
check(ids(live_tools) == ids(js["tools"]), "tool list identical")
check(
    [t["recent_events_count"] for t in live_tools] == [t["recent_events_count"] for t in js["tools"]],
    "per-tool event counts identical",
)

# ---------------------------------------------------------------------------
# 4. Per-tool event windows
# ---------------------------------------------------------------------------
print("\n== per-tool event window parity ==")
bad = []
for case in js["toolFeeds"]:
    path = f"/api/tools/{case['id']}/events?limit=200"
    if "w7" in case:
        path += "&days=7"
    live_rows = client.get(path).json()
    if ids(live_rows) != ids(case.get("all", case.get("w7"))):
        bad.append((case["id"], "w7" in case, ids(live_rows)[:6]))
check(
    not bad,
    f"all {len(js['toolFeeds'])} per-tool queries identical",
    "\n".join(f"{b}" for b in bad[:4]),
)

# ---------------------------------------------------------------------------
# 5. Evolution timelines
# ---------------------------------------------------------------------------
print("\n== evolution timeline parity ==")
# The 5 curated "today" events are deliberately re-dated to `utcnow()` on every
# seed (so the dashboard always has a populated "last 24 hours"), which means a
# snapshot taken earlier carries slightly older timestamps for exactly those
# events. That drift is by design. Everything else — including the generated
# history, which is anchored to a fixed day — must match exactly.
GENERATED_PREFIX = "evt-hist-"
bad = []
drift_seen = 0
for case in js["evolutions"]:
    live_evo = client.get(f"/api/tools/{case['id']}/evolution?days=30").json()
    snap = case["out"]
    if live_evo == snap:
        continue
    keys = [k for k in live_evo if live_evo[k] != snap.get(k)]
    detail = ""
    if keys == ["recent_events"] and len(live_evo["recent_events"]) == len(snap["recent_events"]):
        for a, b in zip(live_evo["recent_events"], snap["recent_events"]):
            if a["id"] != b["id"]:
                detail = f"id order differs: {a['id']} vs {b['id']}"
                break
            diff_keys = [k for k in a if a[k] != b.get(k)]
            if not diff_keys:
                continue
            is_generated = b["id"].startswith(GENERATED_PREFIX)
            if diff_keys != ["date"] or is_generated:
                detail = f"event {b['id']} differs in {diff_keys}"
                break
            drift_seen += 1
        else:
            continue  # only curated timestamps drifted — acceptable
    else:
        detail = f"keys {keys}"
    bad.append((case["id"], detail))

check(
    not bad,
    f"all {len(js['evolutions'])} evolution payloads match (membership, order, counts, all fields)",
    "\n".join(f"{b[0]}: {b[1]}" for b in bad[:4]),
)
check(
    True,
    f"{drift_seen} curated-event timestamp(s) drifted since export (by design: re-dated to 'now' each seed)",
)

# Generated history must be bit-exact including timestamps.
hist_drift = []
for case in js["evolutions"]:
    live_events = client.get(f"/api/tools/{case['id']}/evolution?days=30").json()["recent_events"]
    by_id = {e["id"]: e for e in live_events}
    for b in case["out"]["recent_events"]:
        if not b["id"].startswith(GENERATED_PREFIX):
            continue
        if by_id.get(b["id"]) != b:
            hist_drift.append((case["id"], b["id"]))
check(
    not hist_drift,
    f"generated history events are bit-exact (no drift across the {sum(1 for c in js['evolutions'] for e in c['out']['recent_events'] if e['id'].startswith(GENERATED_PREFIX))} checked)",
    str(hist_drift[:4]),
)

# Sanity: trails must actually be historical, not all the current version.
trails = {
    c["id"]: [v.get("version") for v in c["out"]["version_timeline"]] for c in js["evolutions"]
}
multi = {k: v for k, v in trails.items() if len(set(v)) >= 2}
check(
    len(multi) >= 8,
    f"{len(multi)}/{len(trails)} tools show >=2 distinct versions in the 30d trail",
)

# ---------------------------------------------------------------------------
# 6. Timeline / heatmap
# ---------------------------------------------------------------------------
print("\n== timeline parity ==")
for days, key in ((30, "timeline"), (14, "timeline14")):
    live_tl = client.get(f"/api/timeline?days={days}").json()
    check(live_tl == js[key], f"timeline?days={days} identical")

# ---------------------------------------------------------------------------
# 7. Client-side matcher endpoints
# ---------------------------------------------------------------------------
print("\n== recommend / compare / alternatives parity ==")
bad = []
for r in js["recs"]:
    live_r = client.post(
        "/api/recommend",
        json={"query": r["query"], "user_skill_level": None, "force_free_only": None},
    ).json()
    if ids([x["technology"] for x in live_r["recommendations"]]) != ids(
        [x["technology"] for x in r["recommendations"]]
    ):
        bad.append(r["query"])
check(not bad, f"all {len(js['recs'])} recommendations match the live endpoint", str(bad))

bad = []
for c in js["comps"]:
    live_c = client.post("/api/compare", json={"tool_ids": [t["id"] for t in c["tools"]]}).json()
    if live_c["matrix"] != c["matrix"] or live_c["verdict"] != c["verdict"]:
        bad.append([t["id"] for t in c["tools"]])
check(not bad, f"all {len(js['comps'])} comparison matrices match the live endpoint", str(bad))

bad = []
for tid, alts in js["alts"].items():
    live_alts = ids(client.get(f"/api/tools/{tid}/alternatives").json())
    if live_alts != alts:
        bad.append((tid, live_alts, alts))
check(not bad, f"all {len(js['alts'])} alternatives lists match the live endpoint", str(bad[:3]))

print()
if failures:
    print(f"{len(failures)} DATA PARITY FAILURE(S)")
    sys.exit(1)
print("DATA PARITY: static snapshot and live API answer identically")
