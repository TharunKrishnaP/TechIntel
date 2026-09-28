# TechIntel Desktop App (EXE)

A single-file Windows executable that bundles the **real FastAPI backend** plus
the whole frontend. Double-click it and the dashboard opens — there is nothing
to install or configure.

## What it does

1. Starts uvicorn on `127.0.0.1` (a free port is chosen automatically).
2. Waits for `/api/health`, then opens the dashboard in:
   - a **native window** (Edge WebView2 via `pywebview`), if the runtime is
     available (preinstalled on Windows 10/11), otherwise
   - the **default browser**.
3. **First run seeds a fresh database** into
   `%LOCALAPPDATA%\TechIntel\techintel.db` automatically — the dashboard is
   live with real data, no setup.

Because a real backend is running, the app uses **live mode** (all `/api/*`
endpoints). The bundled offline snapshot remains as the safety net. Logs go to
`%LOCALAPPDATA%\TechIntel\techintel.log`.

## Build it

Requires Python 3.11+ on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build_exe.ps1
```

Artifact: `dist\TechIntel.exe` (~80–110 MB, one file).

The script installs `PyInstaller` + `pywebview` into the venv, regenerates
icons (including the `.ico` used as the EXE icon), runs the verification
suite, and produces the windowed one-file build.

## Distribute it without building

The GitHub Action **Build Desktop EXE** (`.github/workflows/build-desktop.yml`)
builds the same EXE on a free Windows runner:

- on every push to `main` → downloadable from the workflow's **Artifacts**;
- on a `v*` tag push → also attached to the GitHub Release.

## Uninstall

The EXE is portable: delete the file. User data (db + logs) lives in
`%LOCALAPPDATA%\TechIntel` — remove that folder too to fully wipe it.

## CLI flags (for testing / power users)

```
techintel.exe --port 8123 --no-browser --data-dir C:\some\dir
```

| Flag | Meaning |
|------|---------|
| `--port N` | fixed port (default: pick a free one) |
| `--no-browser` | headless: serve without opening a window (CI/testing) |
| `--data-dir D` | put db + logs in `D` instead of `%LOCALAPPDATA%\TechIntel` |
| `--host H` | bind address (default `127.0.0.1`) |
| `--version` | print version |

Environment overrides: `TECHINTEL_DATA_DIR`, `TECHINTEL_PORT`,
`TECHINTEL_DB`, `TECHINTEL_FRONTEND`.