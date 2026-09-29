# Removing the "not commonly downloaded" warning (code signing)

**TL;DR:** Chrome's *"TechIntel.exe isn't commonly downloaded"* and Windows
SmartScreen prompts are **reputation notices**, not malware findings. They
appear for any new **unsigned** installer. There are exactly two ways to make
them disappear:

1. **Sign the EXE with a certificate trusted by Microsoft / Chrome**
   (the only real fix), or
2. **Let the file build reputation** — the warning fades as more people
   download and run the file (takes time and usage, nothing to do).

The APK is unaffected by this: Android installs use the APK's own debug
signature (verified with `apksigner`), and phones only show a one-time
"allow unknown apps" prompt.

---

## Option A — Azure Trusted Signing (recommended, ~$10/month)

Microsoft's cloud code-signing service. Certificates are already trusted by
Windows/Chrome (SHA-2, EV-grade trust), no hardware token needed, and it
integrates natively with GitHub Actions. You need an **Azure subscription**.

1. Create a **Trusted Signing** resource (Azure portal).
   - Identity validation: **Public (Microsoft) Trusted Test Certificate Signing**
     for testing, or **Public (Microsoft) Trusted Certificate Signing**
     (DVS validation, ~1 day) for production trust.
   - User prompts: >95%.
2. Create a **certificate profile** (e.g. `techintel-release`).
3. Set up **Azure AD app registration** + client credentials (Client ID /
   Tenant ID / Certificates & secrets) used by the GitHub Actions action.
4. Add these secrets to the repo:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_CERTIFICATE` (the base64 of the client certificate)
   - `AZURE_TRUSTED_SIGNING_ACCOUNT` (resource name)
   - `AZURE_TRUSTED_SIGNING_CERT_PROFILE`
5. Uncomment the signing step in `.github/workflows/build-desktop.yml` (shown
   below); push a new tag → CI signs the EXE → warning gone.

```yaml
      # Near the end of build-desktop.yml (after "Build one-file EXE",
      # before "Upload EXE artifact"). Requires the 5 Azure secrets above
      # and the Azure/trusted-signing-action@v0 action.
      - name: Sign the EXE (Azure Trusted Signing)
        if: startsWith(github.ref, 'refs/tags/')
        uses: azure/trusted-signing-action@v0
        with:
          endpoint: https://eus.codesigning.azure.net   # your region
          trusted-signing-account-name: ${{ secrets.AZURE_TRUSTED_SIGNING_ACCOUNT }}
          certificate-profile-name: ${{ secrets.AZURE_TRUSTED_SIGNING_CERT_PROFILE }}
          files-folder: dist
          files-folder-filter: '*.exe'
          signing-proxy-url: http://localhost:5000
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          client-certificate: ${{ secrets.AZURE_CLIENT_CERTIFICATE }}
```

---

## Option B — SignPath.io (free for open source)

Free code signing for open-source projects via the [SignPath OSS
program](https://about.signpath.io/en/oss-program/). Same end result — the
Signed EXE carries an authenticode signature trusted by Windows/Chrome.

1. Create a SignPath account and submit the TechIntel project to the OSS
   program (takes a few days for review).
2. Set up a **code signing policy** with "sign after CI build".
3. Add the SignPath secrets to the repo (`SIGNPATH_USERNAME` /
   `SIGNPATH_PASSWORD` / `SIGNPATH_ORG_ID` / `SIGNPATH_PROJECT_SLUG` /
   `SIGNPATH_API_TOKEN`).
4. Add the official `signpath/github-action-submit-signing-request@v1` step
   to `build-desktop.yml`, then push a new tag.

---

## Option C — Accept it (zero cost, works today)

The warning is one click ("Keep" in Chrome, "More info → Run anyway" in
SmartScreen — see the README), and every build is **byte-verifiable** via the
SHA-256 fingerprints published in the README. Reputation grows automatically
as more people download and run the EXE; for many small open-source projects
the prompt disappears after a few hundred to a few thousand downloads.

---

## Why self-signing is NOT the answer

Signing with a self-generated certificate makes things **worse**: Windows
switches from "unknown app" to *"**Unknown Publisher**"* — a scarier prompt
with even less information. Only certificates issued by a CA trusted by
Microsoft's Authenticode trust chain (as in Options A/B) remove the warnings.

## Android note

The APK ships debug-signed (verified: v1+v2 schemes, `com.techintel.live`).
Android sideloading shows a single "allow unknown apps" confirmation, which
is normal and expected for any non-Play-Store APK. Play Store signing would
require a Play Console account and is out of scope by design.