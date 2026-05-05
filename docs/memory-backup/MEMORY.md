# WorldCup 2026 — Memory Index

## Project
Semi-public social predictions app for FIFA World Cup 2026.
Stack: **React + Vite** (inner pages) + Vanilla HTML/JS (landing) + Supabase + Claude API. GitHub Pages hosting.
Mobile-first, dark theme, users arrive via WhatsApp invite link.

## Supabase
- URL: https://ftryuvfdihmhlzvbpfeu.supabase.co
- Anon key: in js/supabase.js (safe to expose)
- Client pattern: `_supabase` from js/supabase.js (UMD CDN, window.supabase)

## Active Phase
✅ **LIVE ON GITHUB PAGES** — App deployed 2026-04-05 and verified working end-to-end.
✅ **nightly-summary EF ACTIVE + live tested** (2026-04-12, 5 groups processed, real La Liga/PL data, cron bug fixed).
✅ **Prompt v10 ACTIVE** (2026-04-10) — iterated v1→v10, all test CSVs in test/prompts/prompt_v*.csv.
✅ **Cron bug fixed M56** (2026-04-12) — `fn_schedule_ai_summaries()` body was `::text` not `jsonb`; silent failure; fixed.
✅ **feature/nightly-summary merged to main** (2026-04-12).
✅ **Groups focus-game fix** (2026-04-12) — now shows ALL live games regardless of KO time (not just exact same KO). Max 4 simultaneous (WC Jun 27). Query limit raised to 5.
✅ **Game page + Dashboard UI fixes** (2026-04-13) — 3 fixes: (1) LIVE badge on Dashboard (time-based: after KO + score=null + within 120min); (2) W/D/L form badges in Tournament Stats (colored, chronological order); (3) All-groups predictions on Game page — each group shows own pick, Predict/Edit per group, form labeled with group name.
✅ **AI Feed Total standings** (2026-04-21) — Total standings toggle per summary card (group rank + total pts). Global rank computed in EF v14, stored in ai_summaries.display_data (never sent to LLM). Auto-hidden on old summaries (display_data null), auto-appears on new ones. M57 deployed.
✅ **AI Feed daily + total standings fixes** (2026-04-22) — Daily: shows ALL group members incl. 0 pts / no prediction. Total: global rank now per (user × group) matching actual leaderboard. EF v15 deployed. M59 reverts M58 (auto-predict stays in fn_schedule_auto_predictions).
✅ **Global rank tiebreaker fix** (2026-04-22) — EF v16: global rank now sorts by total_points DESC, exact_scores DESC — matches leaderboard RPC exactly. Applies to new summaries only.
✅ **Auto-predict + AI summary scheduling clarified** (2026-04-22) — `fn_schedule_auto_predictions()` covers ALL games (no filter). `fn_schedule_ai_summaries()` covers ALL games. Call BOTH whenever new games are added to the DB.
✅ **In-app feedback system** (2026-05-03) — Hebrew modal, issue/idea + low/medium/high priority, optional screenshot upload to Supabase Storage. M60 deployed. See `memory/feedback-feature.md`.
✅ **Admin email notification system** (2026-05-03) — Resend API via notify-admin EF. Immediate alerts: new user, feedback, AI summary failure, EF crash/quota/stats errors. Daily digest 08:00 UTC: per-game stats, tokens, users, feedback, EF errors, app usage. M61 deployed. See `memory/admin-notifications.md`.
✅ **App usage tracking** (2026-05-03) — app_events table + 15s heartbeat (pauses when tab hidden). logEvent() fires page_view on all 5 pages; prediction_submit on Game; pick_submit on Picks. useHeartbeat in App.jsx.
✅ **Judge LLM system v3** (2026-05-04) — 5-agent parallel (v11-main-2/v12-picks-2/v13-unique-2/v10B + v10-baseline) + gpt-4o judge. M62+M63+M64+M65 deployed, nightly-summary EF v23 (Supabase v27) ACTIVE, notify-admin EF v3 live. 4 comparison runs completed (best: 16-25-10 CSV, 8.04 avg WTotal). PR #1 merged 2026-05-05. See `memory/judge-llm.md`.
✅ **Migration alignment** (2026-05-05) — 6 stub local files for MCP-applied migrations. 72 local migration files total, all aligned with DB. supabase/CLAUDE.md is canonical log.
✅ **Auto-schedule trigger M68** (2026-05-04) — `trg_auto_schedule_game` AFTER INSERT on games auto-calls fn_schedule_auto_predictions + fn_schedule_ai_summaries + fn_schedule_game_sync. No more manual scheduling after game inserts. Exception handlers prevent INSERT failure on cron errors. fn_schedule_game_sync skipped if KO in past or api_fixture_id null (call manually after setup mode for those cases).
✅ **Backfill sync crons M71** (2026-05-05) — one-time loop calling fn_schedule_game_sync for all existing future games with api_fixture_id. Fills the M68 gap for pre-existing games. M68 + M71 = full cron coverage for all games existing + new.
✅ **winner_score + version_tag M69 + EF v23** (2026-05-04) — M69: ai_summaries.winner_score (judge total of winning agent); backfills from ai_judge_runs; also backfills version_tag into ai_judge_runs.candidates JSONB. EF v23: candidates JSONB includes version_tag; ai_summaries upsert writes winner_score. Deployed Supabase v27. Committed + pushed to main.
**Pending:** Verify custom Resend domain (currently sending from onboarding@resend.dev sandbox — may go to spam). Update FROM_ADDRESS in notify-admin EF once domain verified.
✅ **PR #1 merged** (2026-05-05) — feature/judge-llm merged into main via local merge (-Xours, main's v23 EF kept). PR closed.
**Next:** Clean up test data (The Legends group + test games/fake scores), run both scheduling functions after real WC games seeded.

## Deployment
- Landing + register/login: https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/
- React app entry: https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/app.html#/dashboard
- GitHub Pages: `gh-pages` branch, `/ (root)` — **no GitHub Actions, fully manual**
- Architecture: vanilla `index.html` landing (intentional) → login → `app.html` React SPA
- [Deploy steps](feedback_deploy.md) — copy dist/ contents to ROOT of gh-pages (not dist/ subfolder)

## Feedback
- [Commit means commit only](feedback_commit_no_push.md) — "commit" = local commit only, never push unless explicitly asked
- [API keys in vault only](feedback_api_keys.md) — keys live ONLY in Supabase vault, never ask for values, never put in frontend/.env
- [API stats null→0 fix](feedback_api_stats_null.md) — API Football returns null for offsides (and possibly others) when count=0; use `?? 0` for all count fields in writeTeamStats; gk_saves/gk_conceded pending bug
- [Odds sources](feedback_odds_sources.md) — game odds: API Football Bet365 only; champion odds: TheOddsAPI William Hill only; single source per data type
- [Deploy to gh-pages](feedback_deploy.md) — copy dist/ contents to ROOT, not dist/ subfolder; fully manual, no GitHub Actions
- [team.html data duplication](feedback_team_html_duplication.md) — team.html has own hardcoded TEAMS+TEAM_EXTRA (independent of js/main.js); any team edit must be applied to BOTH files; approved fix: load js/main.js via script tag instead

## Phase Memory Files
- `memory/db-phase.md` — schema, migrations 1–25, RPCs, decisions, test pages
- `memory/edge-function-phase.md` — EF status, vault config, football-api-sync error handling audit (2026-04-11)
- `memory/frontend-phase.md` — React+Vite migration status, page/component build tracker
- `memory/qa-round2.md` — 6 edge-case bugs found + fixed (2026-04-01)
- `memory/qa-round3.md` — 8 issues: contrarian logic, RLS fix, auth param, max 3 groups, join deadline, ungrouped migration, stats, vault fix (2026-04-02)
- `memory/api-pull-plan.md` — API Football data pull plan: teams + players from API (not hardcoded) ← NEXT
- `memory/feedback-feature.md` — in-app feedback system: DB schema, RLS, storage, component, admin view
- `memory/admin-notifications.md` — admin email system: notify-admin EF, M61 tables/triggers, app_events, daily digest, pending domain setup
- `memory/judge-llm.md` — Judge LLM system: 5-agent (v11/v12/v13/v10B + v10-baseline), M62–M65 schema, EF v23 active, test results, PR #1 merged
- Point 7 (player rating): two ideas to decide — 1) Game page stat (players sorted by rating), 2) AI summary context (top 3 rated fed to prompt). Details in `memory/edge-function-phase.md`.

## Skills
- `/verify-feature [0-9]` — test runner: DB checks + browser test + feedback report + memory update ← USE NOW
- `/db-feature [name]` — ERD + RLS planner (SKILL.md = live ERD source of truth)
- `/frontend [page|file]` — full workflow: read → plan → fill gaps → build → update memory → link → auto-chains /ux ← READY
- `/ux [page|file]` — UX audit: mobile, visual, states, a11y, component reuse → prioritized report → ask before fix ← AUTO after /frontend
- `/edge-function [nightly-summary|football-api-sync]` — EF builder: pre-checks → questions → build → deploy → auto-verify → report → memory update ← ACTIVE
- `/tips` — Claude Code tips

## Dashboard
- [My Stats counting rules](dashboard-stats.md) — Exact%/Predicted%/Streak count from 2026-04-11 (test data exclusion), definitions, impl notes

## Structure
- [Project structure](project_structure.md) — reorganization decisions 2026-04-11 (what moved where, what was skipped)

## Key Files
- CLAUDE.md — app characterization + file structure
- docs/UX_PATTERNS.md — spacing grid, touch targets, state patterns, a11y rules, do/don'ts (used by /ux)
- .claude/skills/db-feature/SKILL.md — live ERD + RLS (always up to date)
- docs/PLAN_REACT_VITE.md — React+Vite migration plan (full build order) ← ACTIVE
- supabase/migrations/ — 72 local files (all deployed): ...68: trg_auto_schedule_game; 69: winner_score + version_tag backfill; 70: ai_judge_scores view; 71: backfill sync-game crons for existing games
- supabase/functions/notify-admin/index.ts — ✅ deployed v3 ACTIVE (2026-05-04) — added v10-baseline wins row to Judge LLM section; v2: Judge LLM section; v1 base: Resend gateway, 5 email types
- supabase/functions/football-api-sync/index.ts — ✅ deployed v29 ACTIVE (v29: +reportEfError at quota/stats_write/crash; v24 base)
- docs/QA_REPORT.md — full QA report (22 initial issues + 6 edge-case issues, all fixed)
- supabase/functions/sync-odds/index.ts — ✅ deployed v19 ACTIVE (v19: +reportEfError at crash; v14 base: USA→United States map + filter non-WC long-shots)
- docs/data/API_FULL_SUMMARY.csv — full API field verification (api-football + theoddsapi, all 7 sections)
- supabase/functions/nightly-summary/index.ts — ✅ deployed v23 ACTIVE (Supabase v27, 2026-05-04) — candidates JSONB includes version_tag; ai_summaries includes winner_score; see memory/judge-llm.md
- test/judge_compare.cjs — local 5-agent test script (use .cjs not .js); runs all 5 prompts on 4 dates, outputs CSV; needs OPENAI_API_KEY. 4 runs archived in test/
- supabase/CLAUDE.md — deployed migrations log + EF status + pending setup
- docs/PLAN_API_SYNC.md — EF architecture, cron lifecycle, post-deploy setup order
- docs/DATA_SOURCES.md — API field mappings (api-football.com + theoddsapi.com)
- docs/ERROR_HANDLING.md — error groups 1–7 (API sync) + A–D (nightly summary) + implementation status table (audited 2026-04-11) + recommended fix order
- js/main.js — TEAMS array + HOST_SCHEDULES (all 104 games) — to be extracted to src/lib/teams.js
