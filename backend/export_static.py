"""
TechIntel — Static Data Exporter
=================================
Dumps the seeded database into ``frontend/data/*.json`` so the app can run as a
fully static, installable PWA (desktop + Android) with no backend.

Why drive this through the FastAPI app instead of calling the DB layer directly?
Because it guarantees the static payloads are byte-identical in *shape* to what
the live API returns. The frontend's data adapter can then serve both modes from
one set of expectations, and a schema drift on the API side shows up here as a
failing export rather than as a silently broken installed app.

Usage
-----
    python -m backend.export_static            # export
    python -m backend.export_static --days 30  # heatmap window (default 30)
"""

import json
import os
import sys
from datetime import datetime

# Allow `python backend/export_static.py` as well as `-m backend.export_static`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The static export must be deterministic: keep main's background feed auto-sync
# loop from firing (and hitting the network) while the snapshot is written.
os.environ["TECHINTEL_NO_AUTOSYNC"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
)
DATA_DIR = os.path.join(FRONTEND_DIR, "data")
EVOLUTION_DIR = os.path.join(DATA_DIR, "evolution")


def _write_json(path: str, payload, *, compact: bool = False) -> int:
    """Write JSON to ``path`` and return the byte size."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if compact:
        # Compact for large lists: the events file is the bulk of the payload and
        # whitespace in it is dead weight once a service worker has cached it.
        text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    else:
        text = json.dumps(payload, indent=2, ensure_ascii=False)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return len(text.encode("utf-8"))


def export(days: int = 30, verbose: bool = True) -> dict:
    """Export every dataset the PWA needs. Returns a build manifest."""
    client = TestClient(app)

    def get(path: str):
        resp = client.get(path)
        resp.raise_for_status()
        return resp.json()

    # --- Core datasets -----------------------------------------------------
    events = get("/api/feed?limit=200")
    tools = get("/api/tools")
    stats = get("/api/stats")
    timeline = get(f"/api/timeline?days={days}")

    sizes = {
        "events.json": _write_json(os.path.join(DATA_DIR, "events.json"), events, compact=True),
        "tools.json": _write_json(os.path.join(DATA_DIR, "tools.json"), tools, compact=True),
        "stats.json": _write_json(os.path.join(DATA_DIR, "stats.json"), stats),
        "timeline.json": _write_json(os.path.join(DATA_DIR, "timeline.json"), timeline),
    }

    # --- Per-tool evolution timelines -------------------------------------
    evolution_files = 0
    evo_summary = []
    for tool in tools:
        evo = get(f"/api/tools/{tool['id']}/evolution?days={days}")
        rel = os.path.join("evolution", f"{tool['id']}.json")
        _write_json(os.path.join(DATA_DIR, rel), evo, compact=True)
        evolution_files += 1
        evo_summary.append(
            {
                "id": tool["id"],
                "name": tool["name"],
                "events": evo["summary"]["total_events"],
                "trail": len(evo["version_timeline"]),
            }
        )

    # --- Build manifest ----------------------------------------------------
    dates = sorted(e["verified_at"] for e in events) if events else []
    manifest = {
        "generated_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "timeline_days": days,
        "counts": {
            "events": len(events),
            "tools": len(tools),
            "evolution_files": evolution_files,
        },
        "date_range": {
            "oldest": dates[0] if dates else None,
            "newest": dates[-1] if dates else None,
        },
        "stats": {
            "new_today": stats.get("new_today"),
            "new_this_week": stats.get("new_this_week"),
            "new_this_month": stats.get("new_this_month"),
        },
        "technologies": evo_summary,
    }
    sizes["build.json"] = _write_json(os.path.join(DATA_DIR, "build.json"), manifest)

    if verbose:
        print(f"Exported static data -> {DATA_DIR}")
        print(f"  generated_at : {manifest['generated_at']}")
        print(f"  history      : {manifest['date_range']['oldest']} .. {manifest['date_range']['newest']}")
        print(f"  events={len(events)}  tools={len(tools)}  evolution={evolution_files}")
        for name, size in sizes.items():
            print(f"    {name:26s} {size/1024:8.1f} KB")
        total = sum(sizes.values())
        print(f"  {'TOTAL':26s} {total/1024:8.1f} KB")

    return manifest


if __name__ == "__main__":
    import warnings

    warnings.filterwarnings("ignore")
    window = 30
    if "--days" in sys.argv:
        window = int(sys.argv[sys.argv.index("--days") + 1])
    export(days=window)
