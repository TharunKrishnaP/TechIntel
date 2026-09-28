"""
TechIntel — Desktop App Launcher
================================

Entry point for the PyInstaller-bundled desktop EXE. It starts the real
FastAPI backend on a local loopback port, waits until it is healthy, then
presents the dashboard in a native window (Edge WebView2 via `pywebview`)
or, if that runtime is unavailable, the system browser.

This is a *live* app: the backend runs locally, so the dashboard talks to
real `/api/*` endpoints with real data. First launch seeds the fresh
database into `%LOCALAPPDATA%\\TechIntel\\techintel.db` automatically, so
there is nothing to install or configure — double-click and it works.
The bundled PWA snapshot keeps it usable even fully offline.

The launcher also works in dev mode (`python desktop/launcher.py`) and in
headless/test mode (`--no-browser --port 8123 --data-dir <temp>`), where it
behaves exactly like `uvicorn backend.main:app`.

Environment variables usable by power users (all optional):
  TECHINTEL_DATA_DIR   where techintel.db + techintel.log live
  TECHINTEL_PORT       fixed port (overridden by --port)
"""

import argparse
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

# Allow `python desktop/launcher.py` from anywhere to find the `backend` package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# PyInstaller --windowed builds set sys.stdout/stderr to None (no console). Any
# module that prints at import time (or the interpreter's own exception hook)
# then blows up on a None stream — which can deadlock a windowed EXE with no
# visible error. Give the runtime real streams up front (devnull is fine:
# everything important goes to %LOCALAPPDATA%\TechIntel\techintel.log).
if getattr(sys, "frozen", False) and sys.stdout is None and sys.stderr is None:
    _null = open(os.devnull, "w", encoding="utf-8")
    sys.stdout = _null
    sys.stderr = _null

APP_VERSION = "1.0.0"
APP_TITLE = "TechIntel — Live Technology Intelligence"


# ---------------------------------------------------------------------------
# Logging: survives --windowed (no console) via a rotating file in the data dir
# ---------------------------------------------------------------------------

def setup_logging(data_dir):
    os.makedirs(data_dir, exist_ok=True)
    logger = logging.getLogger("techintel")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = logging.FileHandler(os.path.join(data_dir, "techintel.log"), encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    # In a --windowed EXE there is no console: without a handler, uvicorn's
    # own loggers (uvicorn.error/access) would swallow startup failures. Route
    # them to the same file so "why won't the server start?" is always
    # answerable from %LOCALAPPDATA%\TechIntel\techintel.log.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.addHandler(fh)
        lg.setLevel(logging.INFO)
        lg.propagate = False
    # A --windowed EXE has no console: stdout is None and any print() crashes.
    if sys.stdout is not None:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        logger.addHandler(sh)
    return logger


def pick_port(host):
    with socket.socket() as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def wait_ready(host, port, log, timeout=30.0):
    url = f"http://{host}:{port}/api/health"
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True, None
        except Exception as exc:
            last_error = repr(exc)
        time.sleep(0.2)
    return False, last_error


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog="TechIntel",
        description="TechIntel — Live Technology Intelligence (desktop app)",
    )
    p.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=0,
                   help="port to listen on (default: pick a free one)")
    p.add_argument("--no-browser", action="store_true",
                   help="do not open a window/browser; keep serving (headless/test)")
    p.add_argument("--data-dir", default=None,
                   help="override the user-data directory (db + logs)")
    p.add_argument("--version", action="store_true",
                   help="print version and exit (works even in --windowed builds)")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    if args.version:
        msg = f"TechIntel {APP_VERSION}"
        try:
            print(msg, flush=True)
        except Exception:
            pass  # windowed builds have no stdout
        return 0

    # The environment must be pinned BEFORE the backend is imported: database.py
    # computes its module-level DB path at import time. In dev (non-frozen) the
    # database stays at backend/techintel.db unless a dir is explicitly given —
    # then it should follow the flag, so pin both env vars.
    if args.data_dir:
        data_dir_abs = os.path.abspath(args.data_dir)
        os.environ["TECHINTEL_DATA_DIR"] = data_dir_abs
        os.environ["TECHINTEL_DB"] = os.path.join(data_dir_abs, "techintel.db")
    port = args.port or int(os.environ.get("TECHINTEL_PORT") or 0)

    # Delayed import: app_paths.get_data_dir() now sees TECHINTEL_DATA_DIR.
    from backend.app_paths import get_data_dir
    data_dir = get_data_dir()
    log = setup_logging(data_dir)
    log.info("TechIntel %s starting (data dir: %s)", APP_VERSION, data_dir)

    try:
        from backend.main import app  # noqa: E402  (env must be set first)
    except Exception as exc:
        log.exception("failed to import the backend: %s", exc)
        return 1

    if not port:
        port = pick_port(args.host)
        log.info("picked free port %d", port)

    import uvicorn
    server = uvicorn.Server(
        uvicorn.Config(app, host=args.host, port=port, log_level="warning", access_log=False)
    )

    def serve():
        try:
            server.run()
        except Exception as exc:  # surface startup crashes into the log
            log.exception("uvicorn failed: %s", exc)

    thread = threading.Thread(target=serve, daemon=True, name="uvicorn")
    thread.start()

    url = f"http://{args.host}:{port}/"
    ok, last_error = wait_ready(args.host, port, log)
    if not ok:
        log.error("health check failed after retries — server.started=%s "
                  "thread_alive=%s last_error=%s",
                  getattr(server, "started", None), thread.is_alive(), last_error)
        return 1
    log.info("backend healthy at %s", url)

    if args.no_browser:
        log.info("headless mode — serving %s until the process is stopped", url)
        while server.should_exit is False and thread.is_alive():
            time.sleep(1.0)
        return 0

    # Prefer a real app window; fall back to the default browser.
    used_window = False
    try:
        import webview  # bundled with the EXE

        webview.create_window(APP_TITLE, url)
        webview.start()
        used_window = True
    except Exception as exc:  # WebView2 runtime missing / import failed
        log.warning("native window unavailable (%s) — opening the browser instead", exc)
        webbrowser.open(url)

    if used_window:
        # The window was closed: shut the backend down cleanly.
        log.info("window closed — shutting down")
        server.should_exit = True
        thread.join(timeout=5.0)
    else:
        log.info("serving %s (close the browser tab and end TechIntel from the "
                 "system tray / Task Manager to stop)", url)
        while server.should_exit is False and thread.is_alive():
            time.sleep(1.0)
    return 0


if __name__ == "__main__":
    sys.exit(main())