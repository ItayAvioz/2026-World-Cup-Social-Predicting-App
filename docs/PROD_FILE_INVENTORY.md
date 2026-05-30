# Production File Inventory

Every file that matters for the production rollout, what it does, and where it lives. Read this when something breaks and you need to know "what touches prod?".

Last updated: 2026-05-30.

---

## A. Frontend source (modified during Phase 1)

| File | Purpose | Prod-impact |
|---|---|---|
| `js/supabase.js` | Vanilla landing page Supabase client. Hostname switch picks DEV or PROD creds. | Powers `index.html` (login/register) |
| `src/lib/supabase.js` | React app ESM Supabase client. Same hostname switch. | Powers the SPA at `/app.html#/*` |
| `manifest.json` | PWA manifest. `start_url: "/app.html#/dashboard"`, `scope: "/"`. | Defines what gets installed when user "Add to Home Screen" |
| `sw.js` | Service Worker. Push handler + cache. Root-relative icon path. | Background push delivery + offline cache |
| `src/app.html` | SPA entry. Preconnect, manifest link, SW registration — all root-relative. | Loaded for every `/app.html` request on prod |
| `src/pages/Groups.jsx` (line ~331) | `copyInvite()` builds the WhatsApp share link → `https://pickyguessers.com/index.html?invite=<code>`. | Every invite link sent to friends |
| `src/components/EnvBadge.jsx` (NEW) | Red "DEV" badge shown only when `hostname` is `localhost`/`127.0.0.1`. Hidden on `pickyguessers.com`. | Visual safety rail — you always know which env you're on |
| `src/components/Layout.jsx` | Mounts `<EnvBadge />` so it appears on every page. | Same as above |
| `index.html` (vanilla) | Inline script injects the same DEV badge on the landing page. | Same as above |

## B. Edge Functions (deployed to both dev + prod)

| Folder | EF name | Current dev version | Modified for prod? |
|---|---|---|---|
| `supabase/functions/football-api-sync/` | football-api-sync | v36 | No |
| `supabase/functions/sync-odds/` | sync-odds | v23 | No |
| `supabase/functions/nightly-summary/` | nightly-summary | v35 | No |
| `supabase/functions/notify-admin/` | notify-admin | v12 | No |
| `supabase/functions/send-push/` | send-push | v9 | YES — icon, badge, default URL → root-relative paths |

## C. Scripts (run from terminal)

| File | Purpose | Touches prod? |
|---|---|---|
| `scripts/deploy.cjs` | `npm run deploy` — pushes built bundle to gh-pages. Adds CNAME file. Requires typed `deploy` confirmation. | YES (publishes prod frontend) |
| `scripts/seed-prod.mjs` (NEW) | One-off seeder: trivia copy + EF-triggered fixture/squad pull. Requires `--confirm-prod-write` flag. | YES |
| `scripts/parity-check.mjs` (NEW) | Dev↔prod schema diff. Refuses to run if both args target the same project. | Read-only on prod |

## D. Migration folders

| Folder | Audience | Apply via |
|---|---|---|
| `supabase/migrations/` | BOTH dev + prod | MCP `apply_migration` to each project separately. Source of truth for schema changes going forward. |
| `supabase/migrations-dev/` (NEW) | DEV ONLY | MCP `apply_migration project_id=ftryuvfdihmhlzvbpfeu` only. Chatbot R&D goes here. |
| `supabase/migrations-prod/` (NEW) | PROD ONLY | MCP `apply_migration project_id=<PROD_REF>` only. Empty on day 1. |

Source of truth for the INITIAL prod schema = dev DB itself (via `pg_dump`), NOT these folders. After P3 completes, future schema changes use the folders.

## E. Build output (auto-generated, not in git)

| Path | Purpose |
|---|---|
| `dist/` | Vite build output. Created by `npm run build`. Copied to gh-pages by `npm run deploy`. |
| `dist/app.html` | Built SPA entry. Hash-named JS/CSS in `dist/assets/`. |

## F. gh-pages branch (deployed site)

| File | Purpose |
|---|---|
| `CNAME` (NEW) | Single line `pickyguessers.com`. Tells GitHub Pages to serve from this domain. |
| `app.html` | Deployed SPA entry with hash-named JS/CSS refs + `window.__APP_VER__` injected. |
| `sw.js` | Same as main, with incremented SW_VERSION. |
| `assets/*` | Hash-named bundles (1 per route + main + lazy chunks). |
| `index.html`, `host.html`, `team.html` | Vanilla pages restored from main during deploy. |
| `manifest.json`, `icon-*.png`, etc. | Static assets. |

## G. Documentation

| File | Purpose |
|---|---|
| `docs/PLAN_PROD_CUTOVER.md` | The full 7-phase cutover plan. Single source of truth. |
| `docs/MIGRATION_TRIAGE.md` | Reference-only — file vs DB triage report. |
| `docs/SECURITY_ADVISORS_PRE_CUTOVER.md` | 190-lint review. Zero blockers; 2 dashboard toggles + deferred hardening. |
| `docs/PROD_FILE_INVENTORY.md` | This file. |
| `CLAUDE.md` | Project overview + tech stack. |
| `supabase/CLAUDE.md` | Migrations + EF + cron deployed-state log. |

## H. Backups (OUTSIDE the repo)

Lives at `C:\Users\yonatanam\Desktop\wc2026-backup-2026-05-30\`. Reasons it's outside the repo:
- Contains potentially sensitive artifacts (`.claude/settings.local.json`)
- Large binaries (pg_dump SQL files, screenshots, storage objects) bloat git history
- Survives if the repo is corrupted

| Sub-path | Contents | Created in step |
|---|---|---|
| `repo-mirror.git/` | Full git mirror of the repo (all branches, tags, refs) | B2 |
| `settings.local.json` | Backup of `.claude/settings.local.json` | B4 |
| `dev-schema-2026-05-30.sql` (will exist after B8) | pg_dump of dev schema — source of truth for prod build | B8 |
| `dev-trivia-data.sql` (will exist after B8) | trivia_questions + trivia_secrets data | B8 |
| `ef-env-vars.md` (will exist after B10) | EF env var names captured from dev dashboard | B10 |
| `auth-settings/` (will exist after B11) | Auth dashboard screenshots | B11 |
| `storage/feedback-screenshots/` (will exist after B12) | 8 user feedback screenshots | B12 |
| `cron-jobs-dev.csv` (will exist after B13) | Full 706-row cron job dump | B13 |
| `auth-orphans.md` (will exist after B14) | 3 users without identity rows, classified | B14 |
| `test-data-inventory.md` (will exist after B15) | Test artifacts that won't migrate | B15 |

## I. Archive (INSIDE the repo)

`archive/2026-05-30/` — committed in B3. 10 dev artifacts (screenshots, icon b64 dumps) moved here so they survive but don't clutter the root.

## J. Rollback anchors

- `git tag pre-prod-cutover-2026-05-30` → main commit `a987c07` (pushed to origin)
- `git tag pre-prod-cutover-2026-05-30-ghp` → gh-pages commit `53079aa` (pushed to origin)
- To restore: `git reset --hard pre-prod-cutover-2026-05-30` on main, or `git checkout pre-prod-cutover-2026-05-30-ghp -- .` on gh-pages.

---

## How to use this inventory

- **Something broke in prod after deploy** → check section A first (frontend changes), then F (gh-pages bundle).
- **EF behaving wrong** → check section B + version numbers.
- **Lost work, need to restore** → section H (backups) + J (git tags).
- **About to make a schema change** → section D, dev first.
- **Reviewing what changes are prod-specific** → all the "(NEW)" tags in A and C.
