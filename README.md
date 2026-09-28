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

It does this with real-time feed ingestion, AI-powered analysis, plain-English explanations (with everyday analogies!), and a side-by-side comparison engine.

---

## ✨ Features

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
| **Data Models** | Pydantic v2 schemas |

---

## 🗂️ Project Structure

```
TechIntel/
├── backend/
│   ├── main.py              # FastAPI server & REST API endpoints
│   ├── models.py            # Pydantic v2 data schemas
│   ├── database.py          # SQLite + seed data (plain-English events)
│   ├── test_api.py          # Automated test suite
│   ├── pipeline/
│   │   ├── clustering.py    # Deduplication & source tier classifier
│   │   ├── ai_engine.py     # Gemini API + heuristic fallback
│   │   └── ingestion.py     # Async RSS/GitHub feed sync
│   └── services/
│       └── matcher.py       # Purpose-based tool matcher & comparison
└── frontend/
    ├── index.html           # Main UI (4 tabs, animated themes)
    ├── styles.css           # Theme system + glassmorphism
    └── app.js               # Radar canvas, state machine, rendering
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

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Platform metrics (events, security alerts, AI updates) |
| `GET` | `/api/feed` | Filterable canonical events feed |
| `GET` | `/api/feed/{id}` | Full event with source citations |
| `GET` | `/api/tools` | Technology directory |
| `GET` | `/api/tools/{id}/alternatives` | Alternative tool discovery |
| `POST` | `/api/recommend` | Purpose-based tool finder |
| `POST` | `/api/compare` | Side-by-side comparison matrix |
| `POST` | `/api/refresh-feed` | Trigger live feed sync |

---

## 🗺️ Roadmap

- [ ] Web deployment (Render.com / Railway)
- [ ] PWA — installable on desktop & Android
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
