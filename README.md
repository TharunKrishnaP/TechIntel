<div align="center">

# 🔍⚡ TechIntel

### Live Technology Intelligence Platform

*Continuously discovers, verifies, summarizes, and compares technology updates — in plain English for everyone.*

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-Powered-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

</div>

---

## 🌟 What is TechIntel?

Most tech-news apps just dump articles at you. **TechIntel is different** — it's a *live intelligence platform* that answers two questions every developer and tech enthusiast asks every day:

> **"What changed in tech today?"** — and — **"What tool should I use for this?"**

It does this with real-time feed ingestion, AI-powered analysis, plain-English explanations (with everyday analogies!), a side-by-side comparison engine, and a **30-day release history** so you can see how a tool got to where it is today — not just what happened today.

---

## ✨ Features

### 📜 30-Day Release History — Not Just Today
Most tech feeds only show you the last 24 hours, which makes it impossible to answer *"how fast is this thing moving?"* TechIntel keeps a rolling month of history:

- **📊 30-day activity heatmap** — one bar per day, sized by how many releases shipped. Click any bar to jump the feed to that single day.
- **🕒 Time window controls** — Today / 7 Days / 30 Days / All Time, plus a custom `from → to` date range.
- **Relative age on every card** — "3h ago", "yesterday", "12 days ago", so a month of entries stays scannable.
- **🧬 Per-tool evolution timeline** — click **History** on any tool (feed card or directory) to open its version trail, oldest → newest, alongside an event-type breakdown.
- **Real windowed stats** — the header shows genuine counts for the last 24h / 7 days / 30 days, not a hardcoded number.

The history is generated deterministically from each project's real version
sequence, and is anchored to a stored day so re-seeding never duplicates rows or
lets the window quietly drift out of the 30-day range.

### ⚡ Live Radar — What Changed in Tech?
- Real-time event feed from verified sources (GitHub Releases, Official Changelogs, CVE advisories)
- **Tier-verified sources**: Official → Tech Press → Community
- 🔴 Critical / 🟠 Major / 🟡 Feature / 🔵 Routine severity tagging
- **Before vs. After delta** — clearly shows what limitation was removed and what new capability was added
- **3 reading depths**: 30-sec TL;DR / 2-min summary / Deep Dive with citations
- **Audience toggle**: Technical mode (architecture delta) ↔ Simple mode (plain English + everyday analogies)
- **"Why use this tool?"** — per-event benefit analysis vs. alternatives

### 🎯 Find a Tool — Purpose-Based Matcher
- Describe your goal in plain English: *"I need a free AI tool to create presentations"*
- AI extracts requirements: purpose, budget, skill level, open-source preference
- Real-time suitability scoring (0–100%) — no static biased rankings
- Transparent "Why This Tool?" rationale box

### ⚖️ Compare Tools — Side-by-Side Matrix
- Select 2–4 technologies for a detailed comparison
- 11 criteria: pricing, free tier, license, API support, version, strengths, limitations, platforms
- Comparative verdict summary

### 📁 Tech Directory — Verified Database
- Filterable database of tools, libraries, and frameworks
- Version tracking, pricing details, alternative suggestions
- One-click **History** button per tool to open its 30-day evolution trail

### 📲 Installable PWA — Desktop & Android, Zero Server
- Installable from Chrome/Edge (desktop) and "Add to Home Screen" (Android) — no APK, no Electron
- The app ships with a **bundled static snapshot** of the last 30 days; every screen (feed, heatmap, Find-a-Tool, Compare, evolution modals) works fully **offline**
- Detects a live backend automatically: server up → live `/api/*`, no server → offline snapshot with an honest mode badge

---

## 🎨 Visually Stunning Design

4 fully animated themes — all with glassmorphism cards, aurora orb effects, and an interactive 3D cyber-radar canvas:

| 🌌 Nebula Aurora | ⚡ Cyberpunk Neon | 🔮 Hologram Obsidian | 🌅 Tokyo Sunset |
|:---:|:---:|:---:|:---:|
| Deep Indigo + Cyan | Synthwave Magenta | Deep Space + Icy Blue | Crimson + Amber |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Python 3.11, SQLite (WAL mode) |
| **AI Engine** | Google Gemini API (`google-genai`) |
| **Data Pipeline** | Async RSS/Atom ingestion, token-overlap clustering |
| **Frontend** | Vanilla JS, CSS animations, Canvas API |
| **Installed App** | Installable PWA (manifest + service worker), bundled offline data snapshot |
| **Desktop App** | Self-contained EXE (PyInstaller one-file) bundling the FastAPI backend — double-click to run, first launch seeds a fresh DB |
| **Android App** | Debug-signed APK (Capacitor WebView) with the offline snapshot baked in — built for free on GitHub Actions |
| **Data Models** | Pydantic v2 schemas |

---

## 🗂️ Project Structure

```
TechIntel/
├── backend/
│   ├── main.py              # FastAPI server & REST API endpoints
│   ├── models.py            # Pydantic v2 data schemas
│   ├── database.py          # SQLite layer, query helpers & curated seed events
│   ├── seed_history.py      # Deterministic 30-day release-history generator
│   ├── export_static.py     # Exports the seeded DB to frontend/data/*.json (PWA payload)
│   ├── make_icons.py        # Pure-Python PNG icon generator (no Pillow)
│   ├── test_api.py          # Automated test suite
│   ├── pipeline/
│   │   ├── clustering.py    # Deduplication & source tier classifier
│   │   ├── ai_engine.py     # Gemini API + heuristic fallback
│   │   └── ingestion.py     # Async RSS/GitHub feed sync
│   └── services/
│       └── matcher.py       # Purpose-based tool matcher & comparison
├── frontend/
│   ├── index.html           # Main UI (4 tabs, heatmap, evolution modal)
│   ├── styles.css           # Theme system + glassmorphism
│   ├── app.js               # Radar canvas, state machine, rendering
│   ├── manifest.json        # PWA manifest (relative scope — works on subpaths)
│   ├── sw.js                # Service worker: cache-first shell + offline nav
│   ├── pwa/
│   │   ├── api.js           # Data adapter: live /api/* ⇄ bundled offline snapshot
│   │   └── matcher.js       # JS port of matcher.py (score-for-score parity)
│   ├── data/                # Bundled offline snapshot (committed, regenerated)
│   │   ├── events.json / tools.json / stats.json / timeline.json / build.json
│   │   └── evolution/       # One timeline per tool
│   └── icons/               # Any + maskable icons for install & splash
└── check_*.py / check_*.js  # Parity + wiring verification suites
```

Plus two installable-app builds:

```
├── desktop/
│   ├── launcher.py          # EXE entry point: runs FastAPI + opens native/browser window
│   ├── build_exe.ps1        # One-command PyInstaller build → dist/TechIntel.exe
│   └── README.md            # Build & distribute instructions for the EXE
├── mobile/
│   ├── package.json         # Capacitor 7 wrapper (Android WebView)
│   ├── capacitor.config.json# appId, appName, webDir → ../frontend (bundled snapshot)
│   ├── android/             # Generated Android project (committed)
│   ├── build_apk.ps1        # Local APK build (needs Android Studio/SDK)
│   └── README.md            # APK build & sideload instructions
└── .github/workflows/       # Free cloud builds: build-desktop.yml (EXE), build-android.yml (APK)
```

---

## 🚀 Run Locally

### Prerequisites
- Python 3.11+

### Setup

```bash
# Clone the repository
git clone https://github.com/TharunKrishnaP/TechIntel.git
cd TechIntel

# Create and activate virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Optional: Add Gemini API Key
```bash
# Windows PowerShell
$env:GEMINI_API_KEY="your-api-key-here"

# macOS / Linux
export GEMINI_API_KEY="your-api-key-here"
```
> TechIntel has built-in heuristic extractors and runs without an API key — Gemini enhances accuracy for complex queries.

### Launch

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** in your browser.

---

## 📲 Installable PWA (Desktop & Android)

The entire UI is a **progressive web app**: no Electron, no Tauri, no APK. The
web version is hosted by FastAPI; the *installed* version replaces the server
with a **bundled snapshot** of the seeded database that lives in
`frontend/data/`. That snapshot is committed, so the installed app works even
with the laptop off.

### How it works

- **One codebase, two data paths.** `frontend/pwa/api.js` probes
  `/api/health` (1.5 s timeout) at boot:
  - server answers → live mode, everything served by FastAPI (`/api/*`);
  - otherwise → static mode, loads `data/*.json`, recomputes stats and date
    windows in the browser, and runs Find-a-Tool / Compare through the
    JavaScript matcher port.
- **Offline-first when installed.** The service worker (`sw.js`) precaches the
  app shell (versioned `techintel-shell-<ver>`, bumped on every shell change),
  uses stale-while-revalidate for `data/`, and always goes straight to the
  cache for navigation — so a cold launch while offline still renders.
- **Real-time stats are honest offline.** "new today / week / month" are
  recomputed from the snapshot against the *current* clock, and the header
  shows an **Offline snapshot** badge with the bundle timestamp, so stale data
  is always labeled as stale.

### Install it

| Platform | How |
|----------|-----|
| **Desktop (Chrome/Edge)** | Open the deployed app → the **Install** button in the header (or the address-bar install icon) → **Install** |
| **Android (Chrome)** | Menu → **Add to Home Screen** (or "Install app") → add |
| **iOS (Safari)** | Share → **Add to Home Screen** (standalone, masked icon included) |

No Play Store distribution is configured (intentionally) — the app is
installable from any HTTPS page serving `manifest.json` + `sw.js`.

### If you host on GitHub Pages (optional)

The frontend deploys as a plain static site too — every asset path is
*relative* (`./`), the manifest `scope`/`start_url` are relative, and the
service worker scope is `<repo>/`, so nothing needs rewriting for a
subpath. `manifest.json` is used rather than `.webmanifest` because GitHub
Pages does not map the latter to a JSON MIME type (Chrome rejects
`application/octet-stream` manifests).

### Rebuild the bundled snapshot

Run this whenever the seeded data or API response shapes change, then commit
`frontend/data/` so installs pick it up:

```bash
python -m backend.export_static   # writes frontend/data/*.json (~163 KB)
python -m backend.make_icons      # regenerates frontend/icons/*.png (pure Python)
```

The export drives the real FastAPI app through its `TestClient`, so the JSON
files are byte-identical to the live `/api/*` responses.

### Verification suite

```bash
python -m backend.test_api          # backend + matcher, incl. JS parity asserts
python check_icons.py               # PNG structure/size/content validation
python check_matcher_parity.py      # JS matcher port ≡ Python matcher (104 cases)
python check_data_parity.py         # static snapshot ≡ live API (all windows/endpoints)
python check_pwa_wiring.py          # precache list, manifest, export integrity
node check_ui_harness.js static     # real app.js boot, headless, no server
node check_ui_harness.js live       # real app.js boot against a running server
```

---

## 🖥️ Desktop App (EXE)

A double-click-install desktop app for Windows. The EXE is **one self-contained
file** built with PyInstaller — end users install **nothing** (no Python, no
Node, no CLI).

- **It's the real live app.** The EXE bundles the entire FastAPI backend and
  starts it on `127.0.0.1` on a free port, then opens the dashboard in a native
  window (Edge WebView2) or the default browser. The UI runs in **live mode**
  against the local `/api/*` endpoints.
- **First run is automatic.** A fresh database is seeded on launch into
  `%LOCALAPPDATA%\TechIntel\techintel.db` — nothing to configure.
- **Still works offline.** The bundled PWA snapshot (`frontend/data/`) is the
  safety net if the local server can't start.
- **Portable & cleanly removable.** Uninstall = delete the EXE; user data stays
  in `%LOCALAPPDATA%\TechIntel`.

### Get the EXE

| Route | How |
|-------|-----|
| **CI build (no local tooling)** | Push to `main` or run the **Build Desktop EXE** workflow → download `TechIntel.exe` from the workflow's **Artifacts** |
| **Tag → Release** | Push a `v*` tag and the EXE is attached to a GitHub Release automatically |
| **Build it yourself** | `powershell -ExecutionPolicy Bypass -File desktop\build_exe.ps1` → `dist\TechIntel.exe` |

Windows SmartScreen may warn about the unsigned EXE: click **More info → Run
anyway** (it's built from this public repo).

---

## 🤖 Android App (APK)

A native Android app (Capacitor WebView) with the **offline snapshot baked
in** — it opens instantly with no network and no server, exactly like the
installed PWA. Data refresh happens when a new APK is built.

### Get the APK

| Route | How |
|-------|-----|
| **CI build (no local tooling)** | Push to `main` or run the **Build Android APK** workflow → download the `app-debug.apk` from the workflow's **Artifacts** |
| **Tag → Release** | Push a `v*` tag and the APK is attached to a GitHub Release automatically |
| **Build it yourself** | Install Android Studio + JDK 17, then `powershell -ExecutionPolicy Bypass -File mobile\build_apk.ps1` → `mobile\TechIntel.apk` |

Install: copy the APK to the phone → tap it → allow **Install unknown apps**
for the source. The debug-signed APK is fine for sideloading (no Play Store
involvement, by design).

App `id` is `com.techintel.live`; launcher icons and the branded splash
(`#070A18`) are generated by `backend/make_icons.py`.

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Platform metrics, incl. `new_today` / `new_this_week` / `new_this_month` |
| `GET` | `/api/feed` | Filterable canonical events feed |
| `GET` | `/api/timeline?days=30` | Per-day event counts (feeds the activity heatmap) |
| `GET` | `/api/feed/{id}` | Full event with source citations |
| `GET` | `/api/tools` | Technology directory |
| `GET` | `/api/tools/{id}/events` | Events for one tool, optionally windowed |
| `GET` | `/api/tools/{id}/evolution?days=30` | Version trail, event breakdown & history for one tool |
| `GET` | `/api/tools/{id}/alternatives` | Alternative tool discovery |
| `POST` | `/api/recommend` | Purpose-based tool finder |
| `POST` | `/api/compare` | Side-by-side comparison matrix |
| `POST` | `/api/refresh-feed` | Trigger live feed sync |

**Time filtering.** `/api/feed` and `/api/tools/{id}/events` accept either
`days=<N>` (trailing window) or an explicit `date_from` / `date_to` pair in
`YYYY-MM-DD` form. Explicit bounds win if both are supplied.

```bash
# Last 7 days
curl "http://127.0.0.1:8000/api/feed?days=7&limit=50"

# A specific slice of history
curl "http://127.0.0.1:8000/api/feed?date_from=2026-09-01&date_to=2026-09-15"

# How a single tool evolved over the trailing month
curl "http://127.0.0.1:8000/api/tools/python/evolution?days=30"
```

---

## 🗺️ Roadmap

- [x] PWA — installable on desktop & Android (bundled offline snapshot)
- [x] Desktop app — self-contained EXE bundling the live backend
- [x] Android app — sideloadable APK built free on GitHub Actions
- [ ] Web deployment (Render.com / Railway)
- [ ] User accounts & personalized tracking
- [ ] Email/push alerts for tracked technologies
- [ ] Expanded feed sources (Product Hunt, npm, PyPI release feeds)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ by [TharunKrishnaP](https://github.com/TharunKrishnaP)

</div>
