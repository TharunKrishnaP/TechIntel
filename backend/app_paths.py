"""
TechIntel — runtime path resolution.

The same code runs three ways:

* `python -m uvicorn backend.main:app`  (dev server)
* bundled into a one-file PyInstaller EXE (desktop app)
* as a static snapshot inside the Android app (no backend at all)

Only the first two import this module. When frozen into an EXE, the SQLite
database and log file must live in a *user-writable* location — the EXE's own
directory could be `Program Files` and the onefile temp extraction dir is wiped
on exit — so we fall back to `%LOCALAPPDATA%\\TechIntel`. Watch-listed db
creation (WAL mode) then behaves like any normal installed app.

Every resolution is overridable via an environment variable, which is how the
desktop launcher lets power users pin everything to one folder.
"""

import os
import sys


def _frozen():
    return getattr(sys, "frozen", False)


def get_data_dir() -> str:
    """Where the app writes user state (SQLite DB + logs)."""
    env = os.environ.get("TECHINTEL_DATA_DIR")
    if env:
        return os.path.abspath(env)
    if _frozen():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "TechIntel")
    # Dev: alongside the repo (backend/../ = repo root) for a familiar layout.
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_db_path() -> str:
    """Where the SQLite database file lives."""
    env = os.environ.get("TECHINTEL_DB")
    if env:
        return os.path.abspath(env)
    if _frozen():
        return os.path.join(get_data_dir(), "techintel.db")
    # Dev: keep the db next to the package (backend/techintel.db).
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "techintel.db")


def get_frontend_dir() -> str:
    """Where the static UI lives (index.html, pwa/, data/, …)."""
    env = os.environ.get("TECHINTEL_FRONTEND")
    if env:
        return os.path.abspath(env)
    if _frozen():
        # PyInstaller --add-data "frontend;frontend" unpacks to _MEIPASS/frontend.
        return os.path.join(sys._MEIPASS, "frontend")
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
    )