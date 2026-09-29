# Removing the "not commonly downloaded" warning (code signing)

**TL;DR:** Chrome's *"TechIntel.exe isn't commonly downloaded"* and Windows
SmartScreen prompts are **reputation notices**, not malware findings. They
appear for any new **unsigned** installer. The only real cure is signing the
EXE with a certificate from a CA in Microsoft's Authenticode trust chain.

The good news: **free, CI-automatable signing exists** (SignPath Foundation's
Open Source program) and the repository is already wired for it — see
["Option A"](#option-a--signpath-foundation-oss--free-recommended). It becomes
active the moment four secrets are added; nothing about the current builds
changes until then.

The APK is unaffected: it ships with a valid Android debug signature
(verified with `apksigner`), and the one-time "allow unknown apps" prompt on
the phone is normal sideloading behavior.

---

## Option A — SignPath Foundation OSS (free, recommended)

SignPath ([signpath.io](https://signpath.io) /
[signpath.org](https://signpath.org)) provides **free code signing for
open-source projects**: your private key lives on their HSM, they verify the
binary was built by your public GitHub Actions workflow from your repository,
and the resulting signature is from a CA-trusted certificate (issued in
SignPath Foundation's name — that's what vouches for the repo→binary link).

> **Fastest path:** the repo is ready; only the one-time signup needs a human.
> Use the 15-minute copy-paste runbook in
> **[SIGNPATH-ONBOARDING.md](SIGNPATH-ONBOARDING.md)** — pre-filled
> application answers, the 4 secrets to add, and the verification checklist.

### 1. Apply (one-time, ~1–5 days)

1. Go to the [SignPath Foundation application form](https://signpath.org/apply)
   ("Apply for a free SignPath.io subscription") and submit your project info —
   see the pre-filled answers in [SIGNPATH-ONBOARDING.md](SIGNPATH-ONBOARDING.md).
2. They'll create a **SignPath Foundation organization** for you with:
   - `organization-id`
   - a **project** (slug) linked to this GitHub repo
   - a **signing policy** (slug) — typically restricted to tag builds from
     GitHub-hosted runners
   - a user with submitter rights → generates your **API token**
3. Add the **SignPath GitHub App** access if asked (for origin verification).

### 2. Add 4 secrets to the repo

Settings → **Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `SIGNPATH_API_TOKEN` | token from your SignPath user |
| `SIGNPATH_ORG_ID` | your organization id |
| `SIGNPATH_PROJECT_SLUG` | e.g. `techintel` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | e.g. `release-signing` |

### 3. Done — push a `v*` tag

`.github/workflows/build-desktop.yml` already contains the gated integration:

1. **Upload unsigned EXE** (`actions/upload-artifact@v4`, captures `artifact-id`)
2. **Submit signing request** (`signpath/github-action-submit-signing-request@v3`,
   waits for completion, extracts the signed EXE to `signed/`)
3. **Swap the signed EXE** into `dist/TechIntel.exe`
4. Normal upload + release-attach continue from there (now using the signed file)

The steps run **only** on tag pushes **and** when the secrets exist — so the
unsigned path is untouched elsewhere. After the next tag build, the EXE on the
Release is signed → the browser/SmartScreen warnings disappear.

> Note: the step defaults to `actions/upload-artifact`'s ZIP packaging; SignPath
> validates this through your artifact configuration during onboarding. If a
> "same filename" artifact bug is hit, use a unique artifact name (the workflow
> already uses `techintel-exe-unsigned`).

---

## Option B — Azure Artifact Signing (paid fallback, ~$10/month)

Microsoft renamed **Trusted Signing → Artifact Signing**; use the current
action [`Azure/artifact-signing-action`](https://github.com/Azure/artifact-signing-action).
Requires an Azure subscription + identity validation, then 5 repo secrets.

To switch from SignPath, replace the three gated steps in
`build-desktop.yml` with:

```yaml
      - name: Sign the EXE (Azure Artifact Signing)
        if: startsWith(github.ref, 'refs/tags/')
        uses: azure/artifact-signing-action@v1
        with:
          endpoint: https://eus.codesigning.azure.net   # your region
          trusted-signing-account-name: ${{ secrets.AZURE_TRUSTED_SIGNING_ACCOUNT }}
          certificate-profile-name: ${{ secrets.AZURE_CERT_PROFILE }}
          files-folder: dist
          files-folder-filter: '*.exe'
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
```

Secrets needed: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`.
(Full Azure setup walkthrough:
[learn.microsoft.com — Set up Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations) —
OIDC/federated credentials are the recommended auth over a client secret.)

---

## Option C — Accept it (zero cost, works today)

- Every download is **byte-verifiable** via the SHA-256 fingerprints in the
  README.
- The prompts are one click: Chrome **"Keep"**, SmartScreen
  **"More info → Run anyway"** (detailed in the README's first-run guide).
- Reputation grows automatically with each download/run; for small OSS
  projects the warnings often fade after a few hundred to a few thousand
  downloads.

---

## Why self-signing is NOT the answer

A self-generated certificate makes things **worse**: Windows switches from
"unknown app" to *"**Unknown Publisher**"* — a scarier prompt with less
information. Only CA-trusted Authenticode certificates (Options A/B) remove
the warnings.

## Why Certum's OSS tier isn't recommended here

As of 2026 Certum's Open Source tier is no longer the free/instant path it
used to be (cloud/Hardware-based issuance, ~€25+, per-use tooling). SignPath
Foundation is the purpose-built free option for exactly this use case.

## Android note

The APK ships debug-signed (verified: v1+v2 schemes, `com.techintel.live`).
Android sideloading shows a single "allow unknown apps" confirmation, which
is normal for any non-Play-Store APK. Play Store signing would require a Play
Console account and is out of scope by design.