# Build the TechIntel desktop EXE as a single, self-contained Windows executable.
#
#   powershell -ExecutionPolicy Bypass -File desktop/build_exe.ps1
#
# Produces:  dist\TechIntel.exe   (one file, ~80-110 MB, no installation needed)
#
# The EXE bundles the FastAPI backend + the whole frontend. Double-clicking it
# starts a local live server on the loopback interface and opens the dashboard
# in a native window (WebView2) or the default browser. First run seeds a fresh
# database into %LOCALAPPDATA%\TechIntel — nothing to configure.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "Root: $root"

# Prefer the project venv if present, else the ambient python.
if (Test-Path "$root\venv\Scripts\python.exe") {
    $py = "$root\venv\Scripts\python.exe"
    Write-Host "Using venv python: $py"
} else {
    $py = "python"
}

Write-Host "== Installing build + runtime dependencies =="
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r requirements.txt pyinstaller pywebview

Write-Host "== Regenerating icons (incl. Windows .ico + Android mipmaps) =="
& $py -m backend.make_icons

Write-Host "== Running the verification suite (fail fast) =="
& $py -W ignore -m backend.test_api
if ($LASTEXITCODE -ne 0) { throw "backend.test_api failed" }
& $py -W ignore .\check_pwa_wiring.py
if ($LASTEXITCODE -ne 0) { throw "check_pwa_wiring failed" }

Write-Host "== PyInstaller: one-file windowed build =="
& $py -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --windowed `
    --name TechIntel `
    --icon frontend\icons\techintel.ico `
    --add-data "frontend;frontend" `
    --collect-submodules uvicorn `
    --hidden-import webview.platforms.edgechromium `
    --hidden-import webview.platforms.winforms `
    --exclude-module tkinter `
    --exclude-module matplotlib `
    --exclude-module numpy `
    --exclude-module pandas `
    desktop\launcher.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$exe = Join-Path $root "dist\TechIntel.exe"
if (-not (Test-Path $exe)) { throw "Expected EXE not found: $exe" }
$mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host ""
Write-Host "BUILD OK: $exe ($mb MB)"
Write-Host "  Double-click to run. First launch seeds %LOCALAPPDATA%\TechIntel\techintel.db."
Write-Host "  Uninstall = delete the EXE (user data stays in %LOCALAPPDATA%\TechIntel)."