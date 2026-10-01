-- Mirrors backend/database.py init_db() exactly.
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
);

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
    is_confirmed INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);