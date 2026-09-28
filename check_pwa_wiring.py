"""Verify the PWA wiring: every precached asset exists, every HTML reference
resolves, and the manifest is internally consistent.

An install that 404s on one shell asset fails to install at all (the service
worker's `addAll` is all-or-nothing), so a single stale filename here is a
complete break rather than a cosmetic one.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")
failures = []


def check(cond, label, detail=""):
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}" + (f"\n          {detail}" if detail else ""))
        failures.append(label)


# ---------------------------------------------------------------------------
# 1. Service worker precache list
# ---------------------------------------------------------------------------
print("== service worker precache list ==")
sw_path = os.path.join(FRONTEND, "sw.js")
check(os.path.exists(sw_path), "sw.js exists")
sw_src = open(sw_path, encoding="utf-8").read()

m = re.search(r"const SHELL_ASSETS = \[(.*?)\];", sw_src, re.S)
check(m is not None, "SHELL_ASSETS array is declared")
assets = re.findall(r"'([^']+)'", m.group(1)) if m else []
check(len(assets) > 0, f"SHELL_ASSETS has {len(assets)} entries")

missing = []
for a in assets:
    rel = a[2:] if a.startswith("./") else a
    target = FRONTEND if rel in ("", "index.html") else os.path.join(FRONTEND, rel)
    if rel in ("", "index.html"):
        target = os.path.join(FRONTEND, "index.html")
    if not os.path.exists(target):
        missing.append(a)
check(
    not missing,
    "every precached asset exists on disk (addAll is all-or-nothing)",
    f"missing: {missing}",
)

# The SW scope must cover the manifest scope so a launch is intercepted.
check(
    "./index.html" in assets and "./" in assets,
    "both './' and './index.html' precached so cold launch resolves offline",
    f"assets: {assets[:3]}",
)

# Every evolution file must be reachable; they are fetched on demand, not
# precached, but the SW must not be told to cache them under a stale name.
evo_dir = os.path.join(FRONTEND, "data", "evolution")
evo_files = sorted(f for f in os.listdir(evo_dir) if f.endswith(".json"))
check(len(evo_files) == 10, f"{len(evo_files)} evolution snapshots exported")

# ---------------------------------------------------------------------------
# 2. index.html references
# ---------------------------------------------------------------------------
print("\n== index.html references ==")
html = open(os.path.join(FRONTEND, "index.html"), encoding="utf-8").read()

refs = re.findall(r'(?:href|src)="([^"]+)"', html)
local = [r for r in refs if not r.startswith(("http://", "https://", "//", "data:", "#"))]
missing_refs = [r for r in local if not os.path.exists(os.path.join(FRONTEND, r.split("?")[0]))]
check(
    not missing_refs,
    f"all {len(local)} local href/src references resolve on disk",
    f"missing: {missing_refs}",
)

absolute = [r for r in local if r.startswith("/")]
check(
    not absolute,
    "no absolute /-rooted asset paths (would break on a subpath host)",
    f"absolute: {absolute}",
)

check('rel="manifest"' in html, "manifest is linked")
check("apple-touch-icon" in html, "apple-touch-icon present (iOS standalone)")
check("apple-mobile-web-app-capable" in html, "iOS standalone meta present")
check("theme-color" in html, "theme-color meta present")
check("viewport-fit=cover" in html, "viewport-fit=cover for notched displays")

# Script order matters: app.js boots through API.init(), and api.js reads
# `window.Matcher`, so the matcher must load first.
order = [s for s in re.findall(r'<script src="([^"]+)"', html)]
check(
    order.index("pwa/matcher.js") < order.index("pwa/api.js") < order.index("app.js"),
    f"script load order is matcher -> api -> app: {order}",
)

# ---------------------------------------------------------------------------
# 3. Manifest consistency
# ---------------------------------------------------------------------------
print("\n== manifest ==")
mpath = os.path.join(FRONTEND, "manifest.json")
check(os.path.exists(mpath), "manifest.json exists")
man = json.load(open(mpath, encoding="utf-8"))

for key in ("name", "short_name", "start_url", "scope", "display", "icons"):
    check(key in man, f"manifest has `{key}`")

check(man.get("display") == "standalone", "display=standalone (opens without browser chrome)")

sizes = {i["sizes"] for i in man["icons"]}
check("192x192" in sizes, "has a 192x192 icon (Android install requirement)")
check(any("512" in s for s in sizes), "has a 512x512 icon (splash screen)")
check(
    any(i.get("purpose") == "maskable" for i in man["icons"]),
    "has a maskable icon (Android adaptive icon)",
)

for i in man["icons"]:
    p = os.path.join(FRONTEND, i["src"])
    if not check(os.path.exists(p), f"icon {i['src']} exists"):
        continue
    # Read the IHDR to confirm the declared size matches the real one.
    with open(p, "rb") as fh:
        head = fh.read(33)
    w = int.from_bytes(head[16:20], "big")
    h = int.from_bytes(head[20:24], "big")
    check(
        f"{w}x{h}" == i["sizes"],
        f"icon {i['src']} is really {i['sizes']} (IHDR says {w}x{h})",
    )

check(
    not man["start_url"].startswith("/"),
    f"start_url is relative ({man['start_url']!r}) so it works on a subpath host",
)
check(
    not man["scope"].startswith("/"),
    f"scope is relative ({man['scope']!r}) so it works on a subpath host",
)

# Theme colour must match the app background or the status bar will clash.
check(
    man["theme_color"].lower() == "#070a18",
    f"theme_color matches the app background ({man['theme_color']})",
)

# ---------------------------------------------------------------------------
# 4. Exported data integrity
# ---------------------------------------------------------------------------
print("\n== exported data ==")
data = os.path.join(FRONTEND, "data")
for f in ("events.json", "tools.json", "stats.json", "timeline.json", "build.json"):
    p = os.path.join(data, f)
    ok = os.path.exists(p)
    if check(ok, f"data/{f} exists"):
        try:
            json.load(open(p, encoding="utf-8"))
            check(True, f"data/{f} is valid JSON")
        except Exception as e:
            check(False, f"data/{f} is valid JSON", str(e))

build = json.load(open(os.path.join(data, "build.json"), encoding="utf-8"))
check(
    build["counts"]["events"] == len(json.load(open(os.path.join(data, "events.json"), encoding="utf-8"))),
    "build.json event count matches events.json",
)
check(build["date_range"]["oldest"] < build["date_range"]["newest"], "date range is ordered")

# Every tool in tools.json must have an evolution snapshot.
tools = json.load(open(os.path.join(data, "tools.json"), encoding="utf-8"))
missing_evo = [t["id"] for t in tools if not os.path.exists(os.path.join(evo_dir, f"{t['id']}.json"))]
check(not missing_evo, "every tool has an evolution snapshot", f"missing: {missing_evo}")

# Every evolution file should be reachable by the adapter's path pattern.
check(
    "evolution/${toolId}.json" in open(os.path.join(FRONTEND, "pwa", "api.js"), encoding="utf-8").read(),
    "adapter fetches evolution from data/evolution/<id>.json",
)

print()
if failures:
    print(f"{len(failures)} PWA WIRING FAILURE(S)")
    sys.exit(1)
print("PWA WIRING OK: install would succeed and launch offline")
