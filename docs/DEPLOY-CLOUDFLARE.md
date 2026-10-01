# Deploy the TechIntel hosted backend to Cloudflare (your account, any account)

TechIntel ships a fully portable backend as a **Cloudflare Worker + D1 database + Cron
trigger**. You deploy it to **any Cloudflare account you own** — your main account or a
dedicated/secondary account, it doesn't matter. Nothing in the project is bound to a
specific account, and Cloudflare's free plan easily covers this workload (D1 free tier is
5 GB, 100k reads/day; the Worker cron is included).

Once deployed you get a public URL like `https://techintel-api.<your-subdomain>.workers.dev`
(or a custom domain you bind). You then paste that URL into
`frontend/pwa/api.js` (the `PUBLIC_SERVER` constant) or connect the app to it manually —
and the Android APK / PWA shows **live data from anywhere**.

---

## What you're deploying

| Piece            | Where                                          | Purpose |
|------------------|------------------------------------------------|---------|
| Worker           | `workers/src/index.ts` + `dist/`               | Serves the same `/api/*` surface as the desktop backend (13 endpoints) |
| D1 database      | `workers/schema.sql`                           | Stores events + technologies + sync metadata |
| Seed bundle      | `workers/src/seed-data.json` (committed, 82 events + 10 tools) | Auto-seeds on first request if empty |
| Cron trigger     | `workers/wrangler.jsonc` (`*/15 * * * *`)      | Re-polls the public feeds every 15 min so the hosted API is live |
| Manual refresh   | `POST /api/refresh-feed`                       | Sync-on-demand from the app |

The Worker is a faithful port of the desktop FastAPI backend — same endpoints, same
response shapes, same deterministic heuristics (no LLM keys needed).

---

## Prerequisites

- A Cloudflare account (any account — creating one is free).
- Node.js 20+ (the repo's `workers/` uses wrangler 4; verified on Node 24).
- Git.

---

## Step 1 — Install dependencies

From the repo root:

```powershell
cd workers
npm install
```

> **npm 11+ note:** newer npm versions warn that `esbuild`/`workerd` postinstall scripts
> were blocked. Those binaries are needed for `wrangler dev`/`deploy`. Approve them once:
>
> ```powershell
> npm approve-scripts --allow-scripts-pending
> ```

Verify the port compiles and passes its test-suite (runs against a real SQLite database via
`node:sqlite`, so no Cloudflare account is required):

```powershell
npm run build        # tsc -> dist/
node test/run-tests.mjs
# expect: ALL WORKER BACKEND TESTS PASSED (58 assertions + structural checks)
```

---

## Step 2 — Authenticate wrangler with the account of your choice

Choose **one** of these — both authenticate whichever account you want to own this.

**Option A (recommended) — browser login:**

```powershell
npx wrangler login
```

Your browser opens; sign in to the Cloudflare account you want to use (or create a new
dedicated account first, then sign in with it).

**Option B — API token (headless / CI):**

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token**.
2. Use the template **“Edit Cloudflare Workers”** and add the **D1** permission
   (Account → D1 → Edit) plus **Account → Account Settings → Read**.
3. Export it (PowerShell):

```powershell
$env:CLOUDFLARE_API_TOKEN = "your-token"
$env:CLOUDFLARE_ACCOUNT_ID = "your-account-id"
```

> Deploying under a *different* account later is just re-running these steps while signed
> into that account. Everything below is account-agnostic.

---

## Step 3 — Create the D1 database

```powershell
npx wrangler d1 create techintel-db
```

The output prints a `database_id` (a long UUID). Open `workers/wrangler.jsonc` and replace:

```jsonc
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with your actual ID. This file is committed — keep your own ID local or in CI secrets
(see Step 6). Note: `database_id` in CI can be injected via `CLOUDFLARE_D1_ID` by copying
the file, but the simplest path is to commit the ID (it is not a secret).

---

## Step 4 — Create the schema, then deploy

Create tables in your *remote* D1 database:

```powershell
npx wrangler d1 execute techintel-db --remote --file=schema.sql
```

Deploy the Worker:

```powershell
npx wrangler deploy
```

That’s it. The Worker auto-seeds the 82-event snapshot on its first request, then the cron
trigger starts polling feeds every 15 minutes.

---

## Step 5 — Point the apps at your hosted backend

Your public API URL is now `https://techintel-api.<your-subdomain>.workers.dev`
(str `npx wrangler whoami` shows your account’s workers.dev subdomain; the Worker name is
`techintel-api`).

### Option A (recommended) — bake it into the builds

Open `frontend/pwa/api.js` and set:

```js
const PUBLIC_SERVER = 'https://techintel-api.your-subdomain.workers.dev';
```

Then rebuild:

```powershell
# Desktop EXE
powershell -ExecutionPolicy Bypass -File desktop\build_exe.ps1
# Android APK
cd mobile
npm install
npx cap sync android
cd android
gradlew.bat assembleDebug
```

Apks are written to `mobile/android/app/build/outputs/apk/debug/`.
In the app’s 🌐 Server dialog the new “Use cloud backend” button appears; the APK also
auto-connects to `PUBLIC_SERVER` when it can’t reach a same-origin laptop backend.

### Option B — connect manually (no rebuild)

Open the app → 🌐 → enter `https://techintel-api.your-subdomain.workers.dev` → **Connect**.
The APK then runs fully live from anywhere.

### Optional: clean domain

In the dashboard: Workers & Pages → `techintel-api` → Settings → Domains & Routes → **Add
custom domain** (e.g. `api.techintel.dev`) so the URL is yours, then use that URL in
Step 5.

---

## Step 6 — CI deployment (optional, gated on secrets)

The repo includes `.github/workflows/deploy-worker.yml`. It stays skipped until three
secrets exist on your repo (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `CF_API_TOKEN`      | Token from Step 2 Option B (Workers Edit + D1 Edit) |
| `CF_ACCOUNT_ID`     | Your Cloudflare account ID |
| `CF_D1_ID`          | The D1 `database_id` from Step 3 |

Then every push to `main` deploys the Worker. (The workflow also runs on tag pushes, in
sync with the desktop/Android release build.)

---

## Day-to-day operations

- **Live feed**: the cron trigger polls the 5 public feeds every 15 minutes. You can also
  hit `POST /api/refresh-feed` from the app (the Refresh button goes live once connected).
- **Check it’s alive**: `GET https://techintel-api.<subdomain>.workers.dev/api/health` →
  `{"status":"healthy","service":"TechIntel Platform"}`.
- **Reset the database** (fresh seed): `npx wrangler d1 execute techintel-db --remote
  --file=schema.sql` after `npx wrangler d1 delete techintel-db` (recreate first). Or load
  the committed SQL seed directly: `npx wrangler d1 execute techintel-db --remote
  --file=seed.sql`.
- **Regenerate the snapshot seed** after the desktop data changes:
  `node workers/scripts/generate-seed.mjs` (reads `frontend/data/`, writes
  `workers/src/seed-data.json` + `workers/seed.sql`), then commit.
- **Logs**: `npx wrangler tail` streams Worker + cron logs live.

## Troubleshooting

- `wrangler login` opens nothing → run `npx wrangler whoami` to check; or use an API token
  (Step 2 Option B).
- `database_id` still set to `REPLACE_WITH_YOUR_D1_DATABASE_ID` → deploy fails on binding;
  complete Step 3 first.
- `Error: D1 execute requires local connection` → you used `--local`; the command above
  uses `--remote`.
- Strict SSL errors on the APK → your phone needs the site to be served over real HTTPS
  (workers.dev + custom domains are), so this shouldn’t occur.
- Feeds only produce new events when the upstream sources actually publish; on quiet hours
  `refresh-feed` returns `new_events_ingested: 0` — that is correct behaviour.