# Production Boot — WorldCup 2026 (`pickyguessers.com`)

## Context

The app is a single Supabase project (`World_Cup_App` in **Tokyo / ap-northeast-1**) serving both real testing and what will become production, with the frontend deployed from `gh-pages` to `itayavioz.github.io/2026-World-Cup-Social-Predicting-App/`. The 2026 World Cup starts **2026-06-11** (12 days away). We need a clean, low-risk production environment on the new `pickyguessers.com` domain, while keeping the current Supabase as a private dev playground for RAG / multi-agent chatbot R&D.

**Decisions locked in:**
- 100 % test data on dev → fresh prod seed, no user migration.
- 1 repo · 1 `main` · 1 `gh-pages` · hostname-routing at runtime.
- Dev = `npm run dev` localhost only. Prod = GitHub Pages + Cloudflare DNS for `pickyguessers.com`.
- Two Supabase projects, same external API keys re-set in each project, Resend sandbox kept for now.
- Region: prod → **`eu-central-1` (Frankfurt)** (~60 ms from Israel vs Tokyo ~250 ms).
- Data from dev to prod: **trivia questions + answers ONLY**. Teams, fixtures, squads pulled fresh from api-football.
- Execution style: **stop at every step, verify, report, wait for user "go", then continue.**
- **Phase 0 (Backup & Audit) is mandatory before any prod work begins.**

## 🟢 SOURCE OF TRUTH RULE

**Supabase dev DB is the single source of truth for schema. Local files are documentation only.**

For prod cutover, do NOT replay individual migration files. Instead:
1. `pg_dump` (or Supabase CLI `db dump`) the live dev schema as one authoritative bundle.
2. Apply the bundle to fresh prod.
3. Backfill `supabase_migrations.schema_migrations` table with the 86 historical records so future MCP `apply_migration` works.

**Why:** verified comparison (2026-05-30) shows 86 DB-tracked migrations vs 120 local files with name drift, bundled splits, missing entries, and 26 pre-tracking files that built the base schema before `schema_migrations` existed. Replaying files file-by-file would miss dashboard-applied SQL and risk order-dependent failures. The pg_dump captures the live ground truth exactly.

**Applies to all schema decisions throughout this plan.** Migration triage report (B5, `docs/MIGRATION_TRIAGE.md`) is now reference-only — not actionable steps.

**Agent-discovered corrections vs earlier conversation:**
- Vault holds only `app_edge_function_url` and `app_service_role_key`. The external API keys (Football, OpenAI, Resend, VAPID, OddsAPI) are set as **Edge Function environment variables** in the Supabase dashboard, NOT vault rows.
- Dev has **706** active cron jobs, not ~104 (per-date×per-group ai-summary alone = 312; trivia-miss per-question = 53).
- **86 DB-tracked migrations** + 26 pre-tracking files + dashboard-applied SQL = current dev schema. Cannot be cleanly file-by-file replayed → use pg_dump approach.
- Security advisors returned 128 KB output — saved to `C:\Users\yonatanam\.claude\projects\...\tool-results\mcp-supabase-get_advisors-1780134594257.txt`. Must be reviewed before cutover.

---

## How dev ↔ prod ↔ Supabase actually wire

The Vite "local server" does NOT proxy Supabase calls. It only serves static frontend files. The browser makes direct HTTPS calls to Supabase, picking the URL from JS at runtime based on `window.location.hostname`.

```
DEV (your laptop)                              PROD (any user)
─────────────────                              ─────────────────
Terminal: npm run dev                          Browser opens https://pickyguessers.com
  → Vite serves files at                         │
    http://localhost:5173                        │
                                                 │
Browser opens http://localhost:5173              │
    │  hostname = "localhost"                    │  hostname = "pickyguessers.com"
    │  JS picks DEV creds                        │  JS picks PROD creds
    ▼                                            ▼
  HTTPS direct to DEV Supabase (Tokyo)         HTTPS direct to PROD Supabase (Frankfurt)
```

Both prod and dev creds are baked into the same JS bundle. Anon keys are public by design — putting both in one bundle is safe. RLS protects the data.

---

## Architecture

```
ONE repo
├── main                              # source (UNCHANGED branch)
│   ├── js/supabase.js                # hostname → dev|prod creds
│   ├── src/lib/supabase.js           # hostname → dev|prod creds
│   ├── manifest.json                 # scope "/"
│   ├── supabase/
│   │   ├── migrations/               # applied to BOTH projects
│   │   └── migrations-dev/           # NEW — dev-only (chatbot R&D)
│   └── supabase/functions/           # same source, deployed to BOTH projects
└── gh-pages                          # deploy artifacts (UNCHANGED branch)
    ├── CNAME                         # NEW — contains "pickyguessers.com"
    └── ... (built bundle bakes in BOTH dev+prod creds)

TWO Supabase projects
├── ftryuvfdihmhlzvbpfeu  (DEV)  ap-northeast-1  ← unchanged, for chatbot R&D
└── <NEW PROD>          (PROD) eu-central-1   ← created today

ONE domain
└── pickyguessers.com (Cloudflare DNS) → CNAME → <gh-user>.github.io
       └── GitHub Pages picks up CNAME file → enforces HTTPS → serves prod
```

---

# PHASE 0 — Backup & Audit (mandatory, before any prod work)

Every step has a verification gate. Nothing in Phase 1+ runs until Phase 0 is signed off.

| # | Action | Verification | Agent? |
|---|---|---|---|
| **B1** | `git tag pre-prod-cutover-2026-05-30 main && git tag pre-prod-cutover-2026-05-30-ghp gh-pages && git push --tags`. Immutable rollback anchors. | `git tag -l 'pre-prod-cutover-*'` shows both tags; `git ls-remote --tags origin` confirms both pushed. | — |
| **B2** | Clone full repo to `C:\Users\yonatanam\Desktop\wc2026-backup-2026-05-30\` (full history mirror, `git clone --mirror`). | Folder exists, `git --git-dir=... log --oneline -1` returns current main commit. | — |
| **B3** | Decide on 10 untracked files (root: `amit_feedback_5.png`, `icon-*.txt`, `nav-*.png`, `picks-upcoming.png`, etc.). Two options: (a) move to new `archive/` subfolder and commit, (b) add to `.gitignore`. Recommended (a) so they survive backup. | `git status` shows zero untracked (or all in `.gitignore`). | — |
| **B4** | Copy `.claude/settings.local.json` → backup folder + verify it contains no secrets. Read first 50 lines. | File copied; content reviewed; no API keys / tokens present. | — |
| **B5** | **Migration reality check** (REFERENCE ONLY — pg_dump strategy supersedes this). Compare `supabase/migrations/*.sql` filenames vs DB `supabase_migrations.schema_migrations`. Authoritative finding (2026-05-30): 86 DB-tracked + ~26 pre-tracking files (M1-M26 base schema) + dashboard-applied SQL = current dev state. **120 local files cannot be cleanly re-applied to prod** due to name drift, bundled splits, ordering. Triage report saved at `docs/MIGRATION_TRIAGE.md` for documentation. **No action items derive from B5 anymore** — P3 uses pg_dump instead. | Report exists; team aware that local files are documentation, not source of truth. | (already run) |
| **B6** | **Read security advisors output**: read the 128 KB file at the path the audit agent saved. Summarize ERROR + WARN level findings. Decide: which to fix in dev now, which to fix in prod-only, which to defer. | Summary table created in `docs/SECURITY_ADVISORS_PRE_CUTOVER.md`. Each ERROR has a decision. | **Explore agent** — read advisor file, group by severity |
| **B7** | **Supabase Dashboard**: trigger a manual on-demand backup of dev project (PRO plan includes this). Verify backup appears in dashboard with today's timestamp. | Screenshot or dashboard confirmation. | — |
| **B8** | **Canonical pg_dump of dev DB.** Schema-only: `supabase db dump --db-url <DEV_DB_URL> --schema-only -f backup/dev-schema-2026-05-30.sql`. **This file is the source of truth for P3 — also serves as a recovery backup.** Then a separate small data-only dump of the tables we'll copy/seed-from in P8: `supabase db dump --db-url <DEV_DB_URL> --data-only -t trivia_questions -t trivia_secrets -f backup/dev-trivia-data.sql` (45 non-test rows + matching secrets filtered later). | Both files exist, schema dump ≥ 200 KB and contains `CREATE TABLE public.games`, trivia dump non-empty. Open in editor, verify SQL is well-formed. | — |
| **B9** | **EF source backup**: confirm all 5 EFs (`football-api-sync`, `sync-odds`, `nightly-summary`, `notify-admin`, `send-push`) are in `supabase/functions/*/index.ts` in git. Compare local `index.ts` mtime + size against dev EF version metadata from `list_edge_functions` audit. Flag drift. | Each EF: local SHA vs dev SHA reported. Drift → must reconcile before deploying to prod. | — |
| **B10** | **Capture EF env vars from dev**: you go to Supabase dashboard → Edge Functions → Settings (per function) and screenshot the env var **names** (NOT values). Expected names per the audit: `FOOTBALL_API_KEY`, `OPENAI_API_KEY` (or `AI_Summary_GPT_Key`), `theoddsapi`, `RESEND_API_KEY`, `Notification_Key`, `ADMIN_EMAIL`, `FROM_ADDRESS`, plus auto-provided `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Save names to `backup/ef-env-vars.md`. | File exists, lists ≥ 7 secret names. | — |
| **B11** | **Capture Auth dashboard settings from dev**: Site URL, redirect allowlist, email templates (confirm + invite + recovery), JWT expiry, refresh-token rotation, password min length, rate limits, third-party providers. You screenshot each tab. Save to `backup/auth-settings/`. | Folder contains ≥ 5 screenshots. | — |
| **B12** | **Storage backup**: download all 8 objects from `feedback-screenshots` bucket. Use Supabase CLI or dashboard. Save to `backup/storage/feedback-screenshots/`. | Folder contains 8 image files matching dev count. | — |
| **B13** | **Cron jobs full export**: spawn Explore agent to dump `SELECT * FROM cron.job ORDER BY jobname` from dev → save as CSV to `backup/cron-jobs-dev.csv`. Will be reference for verifying prod cron coverage later. | CSV file exists with 706 rows. | **Explore agent** — execute_sql + write file |
| **B14** | **Investigate 3 orphan auth users** (23 users vs 20 email identities). Query `SELECT id, email, created_at FROM auth.users WHERE id NOT IN (SELECT user_id FROM auth.identities)`. Classify each: test artifact, admin-created, manual-magic-link, etc. Document in `backup/auth-orphans.md`. | File exists with 3 user rows + 1-line classification each. | — |
| **B15** | **Confirm test data isolation**: list test artifacts that will NOT migrate to prod: `bob@test.com`, `carol@test.com`, `claude.test.wc2026@…`, `verify-game-aa000001`, `verify-game-aa000002`, any `[TEST]` trivia rows (3). Document in `backup/test-data-inventory.md` (informational — prod is fresh so these don't migrate anyway). | File exists. | — |
| **B16** | **Pre-flight checklist**: review every B-step output. Confirm all 15 artifacts exist in backup folder, all agent reports filed, all decisions documented. | Single yes/no per checklist row. | — |
| **V0** | **STOP. Final pre-flight gate.** Show backup folder tree + summary. Wait for explicit "go to Phase 1". | — | — |

**Backup folder structure produced by Phase 0:**
```
C:\Users\yonatanam\Desktop\wc2026-backup-2026-05-30\
├── repo-mirror\               (B2 — full git mirror)
├── settings.local.json        (B4)
├── docs\
│   ├── MIGRATION_TRIAGE.md    (B5)
│   └── SECURITY_ADVISORS_PRE_CUTOVER.md (B6)
├── schema.sql                 (B8)
├── reference-data.sql         (B8)
├── ef-env-vars.md             (B10)
├── auth-settings\             (B11 — screenshots)
├── storage\feedback-screenshots\ (B12)
├── cron-jobs-dev.csv          (B13)
├── auth-orphans.md            (B14)
└── test-data-inventory.md     (B15)
```

---

# PHASE 1 — Source changes (1 commit on `main`, after Phase 0 sign-off)

| # | File | Change |
|---|---|---|
| S1.1 | `js/supabase.js` | Hostname switch with DEV + PROD constants. |
| S1.2 | `src/lib/supabase.js` | Same pattern, ESM. |
| S1.3 | `manifest.json` | `start_url: "/app.html#/dashboard"`, `scope: "/"`. |
| S1.4 | `sw.js` | `ICON` → root-relative `/icon-notif.png?v=4`. SW_VERSION auto-bumped by deploy script. |
| S1.5 | `src/app.html` | Strip `/2026-World-Cup-Social-Predicting-App/` prefix from preconnect, apple-touch-icon, manifest link, SW register. |
| S1.6 | `src/pages/Groups.jsx` line 331 | Invite link → `https://pickyguessers.com/index.html?invite=${code}`. |
| S1.7 | `supabase/functions/send-push/index.ts` | `icon`, `badge`, default URL → root-relative. |
| S1.8 | `supabase/migrations-dev/.gitkeep` + `README.md` | NEW folder + convention doc. |
| S1.9 | `scripts/seed-prod.mjs` | NEW: trivia copy + EF-triggered fixture/squad pull. |
| S1.10 | `scripts/parity-check.mjs` | NEW: dev↔prod parity diff (used in V13). |
| S1.11 | `scripts/deploy.cjs` | Patch: (a) write `CNAME` file to gh-pages root, (b) **prompt for typed `deploy` confirmation** before pushing (env tag shown in prompt). |
| S1.12 | `src/components/EnvBadge.jsx` | NEW: fixed-position badge — red "DEV" on `localhost`/`127.0.0.1`, hidden on `pickyguessers.com`. Reads `window.location.hostname` once on mount. |
| S1.13 | `src/components/Layout.jsx` | Mount `<EnvBadge />` so it shows on every page. |
| S1.14 | `index.html` (vanilla landing) | Inline `<script>` injects the same DEV badge `<div>` for the non-React pages when hostname is localhost. |
| S1.15 | `scripts/seed-prod.mjs` | Requires `--confirm-prod-write` CLI flag AND interactive typed confirmation matching the prod project ref. Refuses to run without both. |
| S1.16 | `scripts/parity-check.mjs` | Refuses to run if `project_id` arg is missing or both args refer to the same project (prevents accidental "prod vs prod" comparison). |

PROD URL + anon key in S1.1/S1.2 get filled in **after** P2 creates the prod project (step S7 in the cutover).

| Gate | What |
|---|---|
| **V1** | `git diff` shown. Grep `2026-World-Cup-Social-Predicting-App` returns 0 hits across `src/`, `js/`, `supabase/functions/`. Grep hostname switch present in both supabase.js files. STOP, wait for "go". |

---

# PHASE 2 — Prod Supabase project (after V1 sign-off)

| # | Action | Verification |
|---|---|---|
| **P2** | MCP `create_project` (name `pickyguessers-prod`, region `eu-central-1`, org `gkubhajttcjseekpwoiy`, plan PRO). | `get_project` returns `ACTIVE_HEALTHY`, region matches. |
| **V2** | Show project id, URL, anon key. STOP, wait. | — |
| **P3a** | **Use the dump produced in B8** (`backup/dev-schema-2026-05-30.sql`). No new dump needed. Quickly re-verify file integrity (size, SHA, first/last line) before applying. | SHA matches B8's; file still ≥ 200 KB; no edits since B8. |
| **P3b** | **Apply bundle to fresh prod.** Use `psql` or MCP `execute_sql` in chunks to run `backup/dev-schema-2026-05-30.sql` against the new prod project. Stop on any error. | All CREATE statements complete. MCP `list_tables` on prod returns same 27 table names as dev. Same routine count, trigger count, RLS policy count. |
| **P3c** | **Backfill migration tracking** (so future MCP `apply_migration` works on prod). Copy `supabase_migrations.schema_migrations` rows from dev → prod via `INSERT … SELECT` (just metadata: version + name; statements already executed via the dump). | Prod `SELECT COUNT(*) FROM supabase_migrations.schema_migrations` returns 86, identical version + name set to dev. |
| **V3** | Show: dump file size, prod table count, prod routine count, prod migration tracking count. All match dev. **Explore agent** runs full row-set parity (tables, routines, triggers, RLS) dev↔prod and reports zero diffs. STOP, wait. | — |
| **P4** | **You** set EF env vars in prod dashboard, per function, using the names captured in B10. Same values as dev (copy from dev dashboard). | I run a no-op invocation of each EF that touches each env var; if EF returns 200, env var is set. |
| **V4** | Show curl smoke output per function. STOP, wait. | — |
| **P5** | MCP `deploy_edge_function` for all 5 EFs from local `supabase/functions/*/index.ts`. | `list_edge_functions` → 5 ACTIVE, each at v1 (initial prod deploy). |
| **V5** | Show name + version + status. STOP, wait. | — |
| **P6** | **You** configure Auth in prod dashboard, using B11 screenshots as template: Site URL `https://pickyguessers.com`, redirect allowlist `https://pickyguessers.com/**` + `http://localhost:5173/**`, email templates (paste from B11), JWT expiry, rate limits. | You confirm visually; I sanity-check via `auth.config` introspection where possible. |
| **V6** | Confirm. STOP, wait. | — |
| **S7** | Fill PROD URL + anon key into `js/supabase.js` and `src/lib/supabase.js`. | Grep both files show the new URL. |
| **V7** | Show diff. STOP, wait. | — |

---

# PHASE 3 — Seed prod data (after V7 sign-off)

| # | Action | Verification |
|---|---|---|
| **P8** | Run `seed-prod.mjs` step **8a**: copy 45 trivia questions + 45 trivia_secrets from dev → prod. Filter: `question_text NOT ILIKE '%[TEST]%'`. | Prod `SELECT COUNT(*) FROM trivia_questions` = 45, `trivia_secrets` = 45. **Explore agent** runs row hash diff dev↔prod (excluding test rows). |
| **V8** | Show counts + sample diff. STOP, wait. | — |
| **P9** | Run seed step **8b**: invoke prod's `football-api-sync` EF `{mode:"setup_fixtures", league:<WC2026>, season:2026}`. Inserts ~104 games; `trg_auto_schedule_game` auto-creates per-game crons. | Prod `games` count = ~104, all rows have `api_fixture_id NOT NULL`. **Explore agent** verifies phase distribution: 72 group + 16 r32 + 8 r16 + 4 qf + 2 sf + 1 third + 1 final. |
| **V9** | Show fixture count + phase breakdown. STOP, wait. | — |
| **P10** | Run seed step **8c**: invoke `football-api-sync` `{mode:"setup_rosters"}`. Fetches per-team squads. | Prod players table count ≥ 1100 (≥20 × 48). **Explore agent** lists any team with <20 players. |
| **V10** | Show roster count + outliers. STOP, wait. | — |
| **P11** | **Verify every cron created**. Use queries C + D below. | All 4 per-game cron types ≥ 104; `trivia-push-daily` × 1; `admin-digest-daily` × 1; query D returns 0 rows (no games missing crons). **Explore agent** runs the queries + reports. |
| **V11** | Show cron coverage table. STOP, wait. | — |
| **P12** | **Verify trivia-push guard active** (migration `fn_notify_trivia_guard`, confirmed applied in V3). Force-trigger with today + a future no-question date; expect skip on empty. | Test output: "no live question, skipping push" on empty date. |
| **V12** | Show test output. STOP, wait. | — |
| **P13** | Run `parity-check.mjs` (or Explore agent). Compares dev vs prod schema, RPCs, RLS policies, triggers, global cron names. | Zero functional diffs. Acceptable diffs: per-game cron counts (different game sets), prediction/group/user counts (dev populated, prod empty). |
| **V13** | Show parity report. STOP, wait. | — |

---

# PHASE 4 — Deploy + DNS + HTTPS (after V13 sign-off)

| # | Action | Verification |
|---|---|---|
| **D14** | `npm run build && npm run deploy`. Deploy script writes `CNAME` to gh-pages root, bumps SW_VERSION, pushes. | gh-pages commit pushed; `CNAME` file present at root. |
| **V14** | Show gh-pages commit hash + file list. STOP, wait. | — |
| **D15** | **You** add Cloudflare DNS records: apex `pickyguessers.com` CNAME → `<gh-user>.github.io`, www same. **DNS-only (grey cloud)**. | `nslookup pickyguessers.com` resolves to GitHub Pages IP. |
| **V15** | Show DNS resolution. STOP, wait. | — |
| **D16** | **You** set custom domain in GitHub Pages settings (Settings → Pages → `pickyguessers.com`, Enforce HTTPS). Wait ~15 min for Let's Encrypt. | `curl -I https://pickyguessers.com` → 200, valid cert. |
| **V16** | Show curl output. STOP, wait. | — |

---

# PHASE 5 — Smoke test + go-live (after V16 sign-off)

| # | Action | Verification |
|---|---|---|
| **V17** | End-to-end smoke test from `https://pickyguessers.com`. **general-purpose agent** with `mcp__playwright__browser_*` drives desktop flows; you do iOS/Android PWA install manually. | See "Smoke test matrix" below. All 14 rows green. |
| **V18** | STOP, wait. | — |
| **D19** | (Optional) Flip Cloudflare to orange-cloud (CDN/proxy). | `curl -I` 200, `cf-ray` header present. |
| **D20** | Send invite links to testers. | — |

---

## Smoke test matrix (V17)

| # | Flow | Tool | Expected |
|---|---|---|---|
| 1 | Hostname routing at `https://pickyguessers.com` | Playwright `browser_navigate` + `browser_network_requests` | All Supabase API calls → PROD URL |
| 2 | Hostname routing at `http://localhost:5173` | Playwright | All Supabase API calls → DEV URL |
| 3 | Register fresh user A | Playwright | Email confirm → dashboard |
| 4 | Create group "Smoke A" | Playwright | Group + invite code |
| 5 | Open invite link as user B (incognito) | Playwright | After register, auto-joins |
| 6 | Submit prediction on future game | Playwright | Saved; locks after kickoff |
| 7 | Champion + top scorer pick (per group) | Playwright | Saved, lock countdown visible |
| 8 | Answer today's trivia | Playwright | Result + explanation shown |
| 9 | Push subscription | Playwright | `push_subscriptions` row created |
| 10 | Global leaderboard | Playwright | A + B present, scored per group |
| 11 | iOS Safari → PWA install | manual | Icon on home screen, scope `/` |
| 12 | Android Chrome → PWA install | manual | Same |
| 13 | Daily admin digest forced | curl | Email arrives at itayavioz1@gmail.com |
| 14 | `nightly-summary` dry-run | curl | Returns valid JSON without writing |

---

## Verification queries

### A. Schema parity (`scripts/parity-check.mjs`, used in V13)
```sql
SELECT table_name        FROM information_schema.tables    WHERE table_schema='public' ORDER BY 1;
SELECT routine_name      FROM information_schema.routines  WHERE routine_schema='public' ORDER BY 1;
SELECT trigger_name      FROM information_schema.triggers  WHERE trigger_schema='public' ORDER BY 1;
SELECT tablename||':'||policyname FROM pg_policies WHERE schemaname='public' ORDER BY 1;
SELECT jobname FROM cron.job WHERE jobname IN ('trivia-push-daily','admin-daily-digest','cleanup-push-subs-daily','af-odds-daily','auto-assign-picks') ORDER BY 1;
```
Expected: zero diffs in tables / routines / triggers / RLS policies / global cron names.

### B. Seed counts (prod, V11)
```sql
SELECT (SELECT COUNT(*) FROM teams)                              AS teams,
       (SELECT COUNT(*) FROM games)                              AS games,
       (SELECT COUNT(*) FROM games WHERE api_fixture_id IS NULL) AS games_unmapped,
       (SELECT COUNT(*) FROM trivia_questions)                   AS trivia,
       (SELECT COUNT(*) FROM trivia_secrets)                     AS secrets,
       (SELECT COUNT(*) FROM auth.users)                         AS users,
       (SELECT COUNT(*) FROM groups)                             AS groups,
       (SELECT COUNT(*) FROM predictions)                        AS predictions;
```
Expected: `48, 104, 0, 45, 45, 0, 0, 0`.

### C. Per-game cron coverage (V11)
```sql
WITH game_count AS (SELECT COUNT(*) AS n FROM games WHERE kick_off_time > now() AND api_fixture_id IS NOT NULL)
SELECT
  (SELECT n FROM game_count)                                    AS future_games,
  COUNT(*) FILTER (WHERE jobname LIKE 'ai-summary-%' AND jobname NOT LIKE 'ai-summary-push-%') AS ai_summary,
  COUNT(*) FILTER (WHERE jobname LIKE 'ai-summary-push-%')      AS ai_push,
  COUNT(*) FILTER (WHERE jobname LIKE 'auto-predict-%')         AS auto_predict,
  COUNT(*) FILTER (WHERE jobname LIKE 'ko-notif-%')             AS ko_notif,
  COUNT(*) FILTER (WHERE jobname LIKE 'sync-game-%')            AS sync,
  COUNT(*) FILTER (WHERE jobname = 'trivia-push-daily')         AS trivia_push,
  COUNT(*) FILTER (WHERE jobname = 'admin-daily-digest')        AS admin_digest,
  COUNT(*) FILTER (WHERE jobname = 'cleanup-push-subs-daily')   AS cleanup,
  COUNT(*) FILTER (WHERE jobname = 'af-odds-daily')             AS af_odds,
  COUNT(*) FILTER (WHERE jobname = 'auto-assign-picks')         AS pick_deadline
FROM cron.job;
```
Expected: `future_games ≈ 104`, each per-game cron type ≥ future_games, every global cron = 1.

### D. Games without their crons (red-flag listing, V11)
```sql
SELECT g.id, g.kick_off_time, g.api_fixture_id,
       EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname LIKE 'ai-summary-%' || g.id::text || '%')  AS has_ai,
       EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname = 'auto-predict-' || g.id::text)           AS has_ap,
       EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname = 'ko-notif-' || g.id::text)               AS has_ko,
       EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname = 'sync-game-' || g.id::text)              AS has_sync
FROM games g
WHERE g.kick_off_time > now() AND g.api_fixture_id IS NOT NULL
  AND (NOT has_ai OR NOT has_ap OR NOT has_ko OR NOT has_sync);
```
Expected: zero rows.

---

## Migrations going forward

```
supabase/
├── migrations/         # shared schema — applied to BOTH dev and prod
│   └── *.sql           # first line: "-- target: prod" (default)
└── migrations-dev/     # dev-only — chatbot R&D, RAG tables
    └── *.sql           # first line: "-- target: dev-only"
```

**Rule:** schema/RLS/scoring changes → `migrations/` → apply to both. Chatbot R&D → `migrations-dev/` → dev only.

---

# PHASE 6 — Steady-state operations (life after go-live)

This is the operating manual. Read this every time you're not sure where a change goes.

## What lives where

| Layer | DEV (Tokyo, current) | PROD (Frankfurt, new) | Shared in repo |
|---|---|---|---|
| Frontend source code | — | — | `src/`, `js/`, `css/` on `main` |
| Supabase URL + anon key | hardcoded in supabase.js | hardcoded in supabase.js | both pairs, selected by hostname |
| DB schema (tables, RPCs, triggers, RLS) | 27 tables + 52 routines + 24 triggers | identical after Phase 3 | `supabase/migrations/` |
| Chatbot R&D schema (RAG, agents) | dev only | never present | `supabase/migrations-dev/` |
| Edge Functions | 5 deployed | 5 deployed (same source) | `supabase/functions/` |
| EF env vars (API keys) | set in dev dashboard | set in prod dashboard | NOT in repo (secrets) |
| Cron jobs | dev's set (706 today) | prod's set (created during seed) | NOT in repo (DB state) |
| Game/team/player data | dev's (186 test games) | prod's (104 real WC fixtures) | NOT in repo (DB state) |
| Trivia questions | 48 (incl. 3 [TEST]) | 45 (copied from dev) | NOT in repo (DB state) |
| User accounts | 23 test users | starts at 0, grows from invites | NOT in repo (auth) |

## How you reach each one

| To browse… | Open in browser | Hostname JS sees | Talks to |
|---|---|---|---|
| DEV (your laptop only) | `http://localhost:5173` after `npm run dev` | `localhost` | DEV Supabase |
| DEV (your phone on same WiFi) | `http://<laptop-LAN-IP>:5173` after `npm run dev -- --host` | the IP | DEV Supabase |
| PROD (anyone, anywhere) | `https://pickyguessers.com` | `pickyguessers.com` | PROD Supabase |
| PROD (your laptop direct) | `https://pickyguessers.com` | `pickyguessers.com` | PROD Supabase |

There is no public dev URL. The old `itayavioz.github.io/...` gh-pages URL auto-redirects to `pickyguessers.com` (= prod) after CNAME is set. To touch dev from a browser anywhere, you MUST be running `npm run dev` on your laptop.

## The 5 things you might change, and where each goes

### 1. Frontend code change (button, layout, fix a bug)
```bash
# edit src/pages/Foo.jsx (or any file under src/, js/, css/)
npm run dev                      # browser at localhost:5173 — tests against DEV
# (verify the change works)
git add src/pages/Foo.jsx
git commit -m "fix: …"
git push origin main
npm run build
npm run deploy                   # ships to gh-pages → pickyguessers.com gets it in ~1 min
```
The same change reaches prod and dev. There's no "frontend that's only on dev" — they share `main`.

### 2. Schema change that prod needs (new column, new RLS policy, new RPC)
```bash
# create supabase/migrations/20260612_add_xyz_column.sql
# apply to DEV first
#    via Claude/MCP: apply_migration project_id=ftryuvfdihmhlzvbpfeu
#    or Supabase CLI: supabase db push --project-ref ftryuvfdihmhlzvbpfeu
npm run dev                      # test against dev with the new schema
# (verify the change works)
# apply to PROD
#    via Claude/MCP: apply_migration project_id=<PROD_REF>
git add supabase/migrations/20260612_add_xyz_column.sql
git commit -m "db: add xyz column"
git push origin main
```
Two `apply_migration` calls, same SQL file. Dev first, always.

### 3. Chatbot R&D — schema (RAG embedding table, agent state, anything experimental)
```bash
# create supabase/migrations-dev/20260612_chatbot_rag.sql
#    first line of file: -- target: dev-only
# apply to DEV ONLY
#    apply_migration project_id=ftryuvfdihmhlzvbpfeu
# DO NOT apply to PROD. Ever.
git add supabase/migrations-dev/20260612_chatbot_rag.sql
git commit -m "dev: chatbot RAG table"
git push origin main
```
The folder name is the safety: never run `apply_migration` against prod with a file from `migrations-dev/`. The plan tells you not to; the folder name reminds you not to; nothing else enforces it.

### 4. Edge Function change
```bash
# edit supabase/functions/nightly-summary/index.ts
# deploy to DEV
#    deploy_edge_function project_id=ftryuvfdihmhlzvbpfeu name=nightly-summary
npm run dev                      # exercise the EF from localhost
# (verify the change works)
# deploy to PROD
#    deploy_edge_function project_id=<PROD_REF> name=nightly-summary
git add supabase/functions/nightly-summary/index.ts
git commit -m "ef: nightly-summary fix"
git push origin main
```
Two deploys, same file. Each project tracks its own version number.

### 5. Chatbot-only Edge Function (chatbot EF you never want in prod)
EFs don't have a `functions-dev/` convention out of the box. Two options:
- **Option A (recommended for one-offs):** put the chatbot EF in `supabase/functions/chatbot/` and just never deploy it to prod (`deploy_edge_function project_id=ftryuvfdihmhlzvbpfeu` only). Discipline-based. Add a header comment `// DEV ONLY — do not deploy to prod`.
- **Option B (if you accumulate several):** create `supabase/functions-dev/` and move chatbot EFs there. Same folder-convention rule as migrations.

We don't need this on day 1; introduce it the first time you build a chatbot EF.

## Decision tree: "where does this change go?"

```
Does this change affect what real users see / score / get notifications on?
│
├── YES → goes to PROD
│        └── frontend  → main → npm run deploy
│        └── schema    → supabase/migrations/ → apply to BOTH projects
│        └── EF        → supabase/functions/ → deploy to BOTH projects
│
└── NO  → dev-only, experimental, chatbot, RAG, throwaway
         └── frontend  → still on main, but only test on localhost (never deploy)
                         OR keep on a feature branch and never merge until promoted
         └── schema    → supabase/migrations-dev/ → apply to DEV ONLY
         └── EF        → supabase/functions/<name>/ + DEV-ONLY header comment;
                         deploy to DEV ONLY (or migrate to supabase/functions-dev/)
```

## Safety rails baked into the plan

| Risk | Mitigation |
|---|---|
| Accidentally deploy dev experiment to prod via `npm run deploy` | `npm run deploy` only ships **frontend**, and frontend has no dev/prod distinction (hostname routes). If your code is buggy on dev it's also buggy on prod. ⚠️ **Always test on `localhost:5173` before `npm run deploy`.** |
| Accidentally apply dev migration to prod | Migration files for prod live in `supabase/migrations/`; dev-only ones in `supabase/migrations-dev/`. The MCP `apply_migration` call takes a `project_id` and a SQL string — you (or Claude) chooses both. Discipline + folder convention. |
| Accidentally point dev frontend to prod DB | Impossible by construction — hostname routing decides. `localhost` → dev, `pickyguessers.com` → prod. No env var to fat-finger. |
| Accidentally point prod frontend to dev DB | Same — impossible by construction. |
| Run a destructive query on prod thinking it's dev | When you call `execute_sql` via MCP, you pass `project_id`. **PROD ref = always Frankfurt project's ref. DEV ref = `ftryuvfdihmhlzvbpfeu`.** Get in the habit of saying which one. |
| Push secret to git | EF env vars are set in dashboards, not in source. There are no `.env` files in this repo (audit B4 confirmed). Don't start now. |
| Lose dev work while iterating | Use feature branches: `git checkout -b feature/chatbot-rag` for any multi-day experiment. Merge to `main` only when promoted. |

## Anti-patterns — don't do these

- ❌ Editing `supabase.js` in your laptop to "point dev to prod for a minute" → just navigate to `pickyguessers.com` instead.
- ❌ Running a chatbot table migration against prod by typo → check the project ref before every `apply_migration`.
- ❌ Deploying a half-baked feature to `gh-pages` to "preview on a phone" → use `npm run dev -- --host` and your phone on WiFi, not gh-pages.
- ❌ Treating dev as "production for friends" → it's localhost-only after cutover. If a friend should see something, it's prod.
- ❌ Skipping the dev → prod order on migrations → always dev first, even for 1-line changes. Catches typos free.

## Cheat sheet — the only 4 commands you regularly type

```bash
npm run dev                                          # work on dev
npm run build && npm run deploy                      # ship frontend to prod (prompts "type 'deploy' to confirm")
# (Claude/MCP) apply_migration project_id=ftryuvfdihmhlzvbpfeu     # apply to dev
# (Claude/MCP) apply_migration project_id=<PROD_REF>               # apply to prod (Claude will ask "confirm prod?" first)
```

Everything else is one-off (EF env vars, DNS, etc.) and lives in the cutover phases above.

---

# PHASE 7 — Skills + Memory writes (after V18 sign-off)

To make the dev↔prod workflow durable across future Claude sessions, persist it as a skill and as memory entries. This is the "the rules don't have to be re-explained every session" layer.

## Skills to create (in `.claude/skills/`)

| Skill | Purpose | Trigger phrases |
|---|---|---|
| **dev-prod-workflow** | Documents the decision tree from Phase 6 — which folder a change goes in, dev-first rule, when migrations are dev-only vs both. Refers to Phase 6 of this plan as the canonical source. | "where does this change go", "is this dev or prod", "should I apply this to prod" |
| **deploy-prod** | Wraps `npm run build && npm run deploy` with: (a) parity check against last gh-pages commit, (b) confirmation prompt, (c) post-deploy curl smoke. | "deploy to prod", "ship to prod", "release" |
| **apply-migration-safely** | Before any `apply_migration` against prod, REQUIRES: (i) the same migration was already applied to dev, (ii) prod migration list is up to date with dev (no drift), (iii) explicit user "yes" on the project ref. | invoked automatically when Claude is about to apply a migration to prod |
| **verify-ef-sync** *(already exists)* | Update with prod project ref so it can audit both. | "verify prod EFs", "is prod sync ready" |

Each skill is a `SKILL.md` file with frontmatter `description`, `triggers`, and step-by-step instructions. Created during Phase 7, NOT in plan-mode.

## Memory entries to write

These get persisted under `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\` so future conversations start with the workflow already known.

| File | Type | Content |
|---|---|---|
| `reference_supabase_projects.md` | reference | DEV ref `ftryuvfdihmhlzvbpfeu` (Tokyo, chatbot R&D). PROD ref `<NEW>` (Frankfurt, real users). Always pass `project_id` explicitly. |
| `feedback_dev_first.md` | feedback | Rule: always apply migrations to DEV first, verify, then PROD. **Why:** prod has live users from 2026-06-11; rollback is expensive. **How to apply:** every `apply_migration` against prod requires a matching prior dev apply within the same session. |
| `feedback_prod_deploy_confirm.md` | feedback | Rule: `npm run deploy` and any prod-write script require typed confirmation. **Why:** prod serves real-user pickyguessers.com from gh-pages; a stray deploy can break the WC tournament. **How to apply:** never bypass the confirm prompt; never `--yes` flags on prod scripts. |
| `project_prod_setup.md` | project | New prod project created 2026-05-30. Ref: `<NEW>`. Region: eu-central-1. EF env vars set: FOOTBALL_API_KEY, AI_Summary_GPT_Key, theoddsapi, RESEND_API_KEY, Notification_Key, ADMIN_EMAIL, FROM_ADDRESS. Auth Site URL = `https://pickyguessers.com`. **Why:** primary prod env for WC2026. **How to apply:** any prod-touching operation uses this ref. |
| `reference_backup_2026-05-30.md` | reference | Pre-cutover backup at `C:\Users\yonatanam\Desktop\wc2026-backup-2026-05-30\`. Git tag `pre-prod-cutover-2026-05-30`. Use for full restore if catastrophic. |
| `feedback_env_badge.md` | feedback | The frontend shows a red "DEV" badge on localhost/127.0.0.1. **Why:** prevents working in the wrong env. **How to apply:** if you see no badge, you're on prod — proceed with extra care. If you see DEV, you're safe to break things. |
| Update existing `MEMORY.md` index | — | Add 6 new index lines pointing at the above files. |

## Phase 7 verification (V19)

After memory + skills exist:
1. `ls C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\reference_supabase_projects.md` returns a file.
2. `ls C:\Users\yonatanam\.claude\skills\dev-prod-workflow\SKILL.md` returns a file.
3. Start a fresh Claude conversation and ask "where should I put a chatbot RAG migration?" — Claude should answer "supabase/migrations-dev/, apply to dev only" from memory alone.

| Gate | What |
|---|---|
| **V19** | Show skill + memory file listing. STOP, wait for "go to D20 (invite testers)". |

---

# Post-go-live operations (ongoing after V19)

## Monitoring (passive)
- **Resend sandbox emails** land in spam folder of `itayavioz1@gmail.com` — manually check daily for the admin digest at 08:00 UTC. Move to inbox / mark not-spam as needed. When you upgrade to a verified Resend domain, this stops.
- **Supabase dashboard → Edge Functions → Logs**: spot-check weekly for errors. The `notify-admin` EF also self-reports failures via the `ef_errors` table → triggers an immediate email.
- **Supabase dashboard → Database → Reports**: watch row growth on `predictions` and `app_events` during the tournament (predictions hit 1934 rows by end of group stage in dev — past 1000-row JS cap; all client code already uses `.range(0,99999)` defensively).

## Backups (PRO plan)
- Supabase PRO = **automatic daily backups + 7-day point-in-time recovery**. No action needed.
- Take a manual on-demand backup before any large schema migration (push button in Supabase dashboard).
- Phase 0 backup at `Desktop\wc2026-backup-2026-05-30\` is your "lost laptop + lost cloud" insurance. Keep it.

## Admin access
- `service_role` key (full DB read/write, bypasses RLS) — stored in EF env vars + your laptop's `.env` when running `seed-prod.mjs`. Never commit to git, never paste into chat.
- Supabase dashboard access — your existing account. Has full project control.
- Direct DB access via Supabase SQL editor — same account, same auth.

## When you onboard real users (post-launch)
- Watch `auth.users` count grow.
- Watch `feedback` table for complaints — they trigger an immediate admin email.
- The daily digest at 08:00 UTC tells you everything: per-game stats, errors, new users, predictions submitted.

---

# Final coverage matrix

Every concern from this conversation → which step covers it.

| Concern | Covered by | Plan section |
|---|---|---|
| Domain on Cloudflare → GitHub Pages | D15, D16 | Phase 4 |
| Same external keys reused | P4, B10 | Phase 0 + 2 |
| 100 % test data — no migration | confirmed in B14, B15 | Phase 0 |
| Pull WC2026 fixtures + squads from api-football | P9, P10 | Phase 3 |
| Pull trivia from dev (filtered) | P8 | Phase 3 |
| All EF crons verified ready for tournament | P11, V11, queries C + D | Phase 3 |
| Trivia push guard active | P12 | Phase 3 |
| Resend sandbox kept | B11, P6 | Phase 0 + 2 |
| Verify ALL again | this matrix + V0/V13/V17 | spans all phases |
| Backups (GitHub + Supabase) | B1–B15 | Phase 0 |
| Backup of `.claude/settings.local.json` | B4 | Phase 0 |
| Backup of storage bucket | B12 | Phase 0 |
| Migration reality check (Supabase is source of truth, files are documentation) | B5 + SOURCE OF TRUTH RULE | Phase 0 + Context |
| Prod schema build via pg_dump (not file replay) | B8 → P3a/b/c | Phase 0 → Phase 2 |
| Security advisor review (128 KB) | B6 | Phase 0 |
| Auth dashboard settings export | B11 | Phase 0 |
| EF env var names captured | B10 | Phase 0 |
| 3 orphan auth users investigated | B14 | Phase 0 |
| Environment indicator in UI | S1.12, S1.13, S1.14 | Phase 1 |
| Confirmation prompts for prod writes | S1.11, S1.15, S1.16 | Phase 1 |
| Hostname routing | S1.1, S1.2 | Phase 1 |
| Root-relative paths (no `/2026-World-Cup-...`) | S1.3, S1.4, S1.5, S1.6, S1.7 | Phase 1 |
| Two-folder migration convention | S1.8 + memory | Phase 1 + 7 |
| Step-by-step verification gates | V0 → V19 | Phases 0-7 |
| Use agents for verify + tests | B5, B6, B13, V3, V8, V9, V10, V11, V13, V17 | Phases 0-5 |
| Dev↔prod workflow understanding | Phase 6 + dev-prod-workflow skill | Phases 6 + 7 |
| Today's game in dev keeps working | dev untouched property + Phase 6 cheat sheet | Phase 6 |
| Skills (.claude/skills) | Phase 7 — 4 skills | Phase 7 |
| Memory entries | Phase 7 — 6 files + MEMORY.md index | Phase 7 |
| Rollback strategy per scenario | Rollback table below | Rollback |
| Post-go-live ops (monitoring, backups, admin) | Post-go-live section | Post-go-live |

If a concern is missing from this matrix, the plan does not cover it. Read the matrix bottom-to-top once before V0; if any row says "missing", we add a step before starting.

---

## Rollback

| Scenario | Action | Recovery time |
|---|---|---|
| HTTPS doesn't provision after 30 min | Remove custom domain from GitHub Pages → re-add | 15 min |
| Prod EF crashes | MCP `deploy_edge_function` rolls back | 2 min |
| Seed wrong (e.g., wrong league id) | `TRUNCATE games CASCADE; TRUNCATE rosters` → re-run | 10 min |
| Frontend bug after deploy | `git revert` gh-pages commit + push | 3 min |
| Source regression | `git reset --hard pre-prod-cutover-2026-05-30` | 1 min |
| Full nuclear: prod broken | MCP `pause_project` → re-run Phases 2-3 | 1 h |
| Cloudflare DNS issue | Toggle DNS-only ↔ proxied; verify NS | 5 min |
| Dev DB corruption (Phase 0 protected!) | Restore from Supabase backup (B7) + `schema.sql` (B8) | 30 min |

**Dev is never touched during any phase.** Worst case: point DNS away, fix, retry tomorrow. Backups in Phase 0 cover the catastrophic "lost laptop + Supabase outage" scenario.

---

## Open items prompted during execution

- **WC2026 league id + season on api-football** — confirmed at P9. If 0 fixtures returned, I show available leagues and we pick together.
- **GitHub user/owner for the Pages URL** — confirmed at D15. Source paths show `itayavioz.github.io`, git config shows `yonatanam`. I'll resolve before then.
- **Cloudflare access** — D15 happens in your browser; I supply exact records.
- **EF env var values** — P4 happens in your browser; I supply the name checklist from B10.
- **Send-push hardcoded gh-pages URL** — already covered in S1.7 (rewrite to root-relative); confirm this is sufficient or whether a `FRONTEND_URL` EF env var is preferable.
