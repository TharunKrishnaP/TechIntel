# SignPath Foundation onboarding — 15-minute runbook

Everything below is what **only you** can do (SignPath needs your identity/email to
issue the free open-source subscription). The repository side is already done and
tested — the moment step 2 below is finished, the next `v*` tag build signs the EXE
automatically. **No code changes are ever needed after this.**

---

## Step 1 — Apply (one-time, ~15 minutes + 1–5 days review)

Open: **[https://signpath.org/apply](https://signpath.org/apply)**
("Apply for a free SignPath.io subscription")

The form asks for your project and build setup. Pre-drafted answers you can
copy/paste (adjust wording as needed):

| Field | Suggested answer |
|---|---|
| Project name | TechIntel |
| Repository URL | https://github.com/TharunKrishnaP/TechIntel |
| License | MIT (LICENSE committed in the repo) |
| Description | TechIntel — a free, no-login tech-intelligence dashboard (Windows EXE + Android APK). Curated events: CVEs, breaches, cloud incidents, vulnerabilities; desktop web app with live offline API, plus offline mobile snapshot. |
| Build system | GitHub Actions, GitHub-hosted runners (`windows-latest` for the EXE, `ubuntu-latest` for the APK). Workflows are public and committed: `.github/workflows/build-desktop.yml`, `.github/workflows/build-android.yml`. |
| Artifact to sign | Windows EXE produced by `PyInstaller` (one-file, `TechIntel.exe`) on tag builds. |
| Release cadence | Tag-based (`v*` tags), the two workflows run in parallel on each tag push. |

Notes that help approval:
- The project is **public**, fully **MIT-licensed**, and the CI pipeline is
  **transparent** (all build steps are committed — nothing is built on a
  maintainer's private machine).
- SignPath will create everything on their side: the **organization**, a
  **project** linked to this repo, a **signing policy** (typically restricted to
  tag builds), and a user with submitter rights.
- It's normal to be asked for a short confirmation email or to verify the tag →
  binary link. Timeline is usually **1–5 business days**.

---

## Step 2 — Add 4 repository secrets (2 minutes)

Once SignPath Foundation sends you your organization details, add the secrets in:

> GitHub → **Settings** (of the repo) → **Secrets and variables** → **Actions** → **New repository secret**

| Secret name | Value they send you |
|---|---|
| `SIGNPATH_API_TOKEN` | the API token from your SignPath user |
| `SIGNPATH_ORG_ID` | your organization id |
| `SIGNPATH_PROJECT_SLUG` | e.g. `techintel` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | e.g. `release-signing` |

The desktop workflow already mirrors `SIGNPATH_API_TOKEN` into a job-level
`env:` and gates the three signing steps on it, so **nothing else needs
configuring.**

---

## Step 3 — Push a `v*` tag → signed EXE on the Release

```bash
git push origin main
git tag -f v1.1.0            # or bump however you version
git push origin v1.1.0
```

On the tag run, `build-desktop.yml` will:

1. Build the unsigned EXE (`PyInstaller`).
2. **Upload unsigned EXE** as a workflow artifact.
3. **Sign via SignPath** (`signpath/github-action-submit-signing-request@v3`,
   waits for completion, extracts the signed EXE).
4. **Swap in the signed EXE** for upload + release attach.
5. Attach to the Release (existing release updated, asset overwritten).

Result: `releases/download/v1.1.0/TechIntel.exe` is **CA-trusted signed**
(Publisher: *SignPath Foundation, verified*) — Chrome's "isn't commonly
downloaded" and SmartScreen "Unknown publisher" prompts disappear.

---

## Verification checklist (after the tag run)

- [ ] The GitHub Actions run for `build-desktop.yml` shows all three SignPath
      steps completed **success** (not skipped).
- [ ] `releases/download/v1.1.0/TechIntel.exe` downloads (HTTP 200).
- [ ] Right-click the EXE → **Properties → Digital Signatures** shows a valid
      signature ("SignPath Foundation" / trusted cert chain).
- [ ] Windows runs it without the "unknown publisher" prompt (first run may still
      ask once for *unknown app* on a fresh file — SmartScreen/Chrome reputation
      warnings are gone).
- [ ] APK unaffected: still debug-signed, side-loads with the normal
      "allow unknown apps" prompt.

---

## If you hit any snags

| Symptom | Likely cause → fix |
|---|---|
| Signing steps show **skipped** on the tag run | One of the 4 secrets is missing/renamed → re-check Secret names, then re-push the tag. |
| Signing step fails with "permission" | SignPath user missing submitter rights → ask SignPath to grant **submit** on the signing policy. |
| SignPath asks for an artifact configuration | Tell them the workflow uploads a ZIP of the EXE via `actions/upload-artifact` (they'll map a `<zip-file>` artifact configuration). |
| Need to re-run signing after a mistake | Move the tag to the fixed commit and re-push (release assets update in place). |

---

## For reference — what's already wired

- `.github/workflows/build-desktop.yml` — gated SignPath integration (steps only
  run on `v*` tag pushes **and** when `SIGNPATH_API_TOKEN` exists; validated with
  `actionlint`).
- `docs/CODE-SIGNING.md` — full background on why signing removes the warnings
  (plus the paid Azure Artifact Signing fallback).