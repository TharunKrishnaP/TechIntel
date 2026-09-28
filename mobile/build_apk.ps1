# Build the TechIntel Android APK locally.
#
# Requires: Android Studio / Android SDK + JDK 17 installed (that's it — no
# Python, no server). npm only runs the Capacitor sync step.
#
#   powershell -ExecutionPolicy Bypass -File mobile\build_apk.ps1
#
# Produces: mobile\TechIntel.apk  (debug-signed, installable by sideloading
# — enable "Install unknown apps" on the phone).
#
# Prefer the GitHub Actions workflow (build-android.yml) if you don't want to
# install the SDK: it builds the same APK in the cloud and you download it.
$ErrorActionPreference = "Stop"

$mobile = $PSScriptRoot
Set-Location $mobile

Write-Host "== Installing Capacitor deps (first run only) =="
if (-not (Test-Path "$mobile\node_modules")) {
    npm install
}

Write-Host "== Syncing web assets into the Android project =="
npx cap sync android

Write-Host "== Building debug APK =="
Push-Location "$mobile\android"
try {
    .\gradlew.bat assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "gradle build failed" }
} finally {
    Pop-Location
}

$apk = "$mobile\android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "Expected APK not found: $apk" }
Copy-Item $apk "$mobile\TechIntel.apk" -Force
$mb = [math]::Round((Get-Item "$mobile\TechIntel.apk").Length / 1MB, 1)
Write-Host ""
Write-Host "BUILD OK: mobile\TechIntel.apk ($mb MB)"
Write-Host "  Copy it to your phone and install (allow unknown sources)."