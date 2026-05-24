---
name: verify-ef-sync
description: Read-only audit of all WorldCup 2026 Edge Functions, pg_cron jobs, and DB triggers. Verifies the data-sync + scheduling + notification pipeline is correctly wired for the real tournament and flags gaps (unmapped WC games, missing sync crons, leftover test data, stale EF versions). Use when the user says "verify EF", "check the sync", "audit edge functions", "are the crons ready for the World Cup", or before go-live.
argument-hint: [ef-name | all]
allowed-tools: Read, Glob, Grep, mcp__supabase__execute_sql, mcp__supabase__list_edge_functions, mcp__supabase__get_edge_function, mcp__supabase__get_logs, mcp__supabase__get_advisors, mcp__supabase__list_migrations
---

# Verify EF Sync — WorldCup 2026

Read-only audit of the backend pipeline: **5 Edge Functions + all pg_cron jobs + all DB triggers**.
The goal is to confirm everything is wired for the *real* 2026 World Cup and report what must be
added / fixed / cleaned before go-live.

**This skill NEVER modifies anything.** No `apply_migration`, no `deploy_edge_function`, no `execute_sql`
that writes, no `cron.schedule`/`cron.unschedule`. Inspect only, then write a report. Fixes are a
separate, user-approved step.

Project id: `ftryuvfdihmhlzvbpfeu`

## What to audit (go EF by EF)

1. **football-api-sync** — game scores, team/player stats, odds, fixture mapping
2. **sync-odds** — champion outright odds (TheOddsAPI)
3. **nightly-summary** — per-group AI roast (5-agent judge LLM)
4. **notify-admin** — admin email alerts + daily digest
5. **send-push** — Web Push delivery
6. **Crons + triggers** — every scheduling fn + AFTER-INSERT trigger that drives the EFs

For the intended design, modes, triggers, and crons of each, read [ef-reference.md](ef-reference.md).

## Procedure

1. **Inventory live state** — `list_edge_functions` (capture deployed versions), then run the cron
   inventory + games-state queries from [checks.md](checks.md).
2. **Dispatch the diff agents** — for the deployed-vs-local comparison, run the 4 parallel subagents
   defined in [agents.md](agents.md) (football-api-sync, nightly-summary, the 3 small EFs, the DB
   trigger/cron layer). They keep the large deployed code out of the main thread and each return a
   structured 🔴/🟡/🟢 report. Skip an agent only if you already hold its result this session.
3. **Per EF**, fold the agent findings against the intended design in [ef-reference.md](ef-reference.md):
   does its trigger/cron exist and cover the real WC games? Is deployed code (not just the version
   label) drifted from local? Are its secrets referenced?
4. **Run every check** in [checks.md](checks.md) — C0–C15, each a labeled read-only SQL query with an
   expected-for-WC result. Run the core DB checks (C1/C4/C11/C12/C13/C15) **3× each** for repeatability
   (match the `/validate-all` convention). Always re-run live — game/cron counts move daily.
5. **Classify findings** as 🔴 Blocker (breaks WC) / 🟡 Should-fix / 🟢 OK. Keep it to **real
   need + impact** — don't pad with cosmetic notes; if something works and won't affect the
   tournament, mark it 🟢 and move on.
6. **Write the report** to `docs/EF_SYNC_AUDIT.md` in the 3-part structure below. Do not apply
   fixes — list them as next steps for the user to approve.

## Report format (`docs/EF_SYNC_AUDIT.md`) — three parts

**Header**: audit date, verdict line, deployed EF versions table (live vs `supabase/CLAUDE.md`).

### Part 1 — What we actually have (inventory)
For each of the 6 areas (football-api-sync, sync-odds, nightly-summary, notify-admin, send-push,
crons+triggers): **Logic** (what it does), **Scenarios** (the real paths it runs — e.g. group FT vs
knockout ET/PEN, rate-limit retry, qualifying-group loop), **Trigger** (what fires it — cron name +
schedule, AFTER-INSERT trigger, external cron-job.org, or manual). Describe the *actual* wired state,
not the ideal.

### Part 2 — Verification results
One row per check C0–C10: check · result (with numbers) · 🟢/🟡/🔴 · 1-line read. Core DB checks
shown as run 3× (note if stable). This is the evidence layer.

### Part 3 — Gaps, fixes & improvements (prioritized)
Ranked table by **need + impact**: 🔴 Blockers first (break the tournament), then 🟡 Should-fix
(degrade but not break), then 🟢 Improvements (optional). Each: what · why it matters · concrete fix.
End with an **ordered go-live checklist**.

## Known anchors (verify, don't assume — these reflect the last audit)

- `football-api-sync` config: `WC_LEAGUE_ID = 1`, `WC_SEASON = 2026`. `setup` mode maps
  `api_fixture_id` by team-name + kickoff match. No `api_fixture_id` ⇒ `trg_auto_schedule_game`
  skips `fn_schedule_game_sync` ⇒ **no sync/verify crons** ⇒ scores never pull.
- The **#1 blocker** historically: real WC games have no `api_fixture_id` and no `sync-game`/
  `verify-game` cron. Quantify it (see checks.md `C4`).
- Test-data pollution: games table holds far more than 104 rows (test group games, friendlies,
  a 2022 fixture). Test games carry their own auto-predict/ai-summary crons that fire junk.
- `notify-admin` `FROM_ADDRESS` may still be the `onboarding@resend.dev` sandbox sender.
