---
name: Edge Function Phase
description: Status of all Supabase Edge Functions — deployment versions, vault config, pending setup
type: project
originSessionId: 81b3cce7-9ecd-4e9b-96b5-3ec88d6dcbf9
---
## Status Summary
- football-api-sync ✅ ACTIVE v24 (2026-04-05)
- sync-odds ✅ ACTIVE v14 (2026-04-05)
- nightly-summary ✅ ACTIVE v16 (2026-04-22)

## nightly-summary v16 — Deployed 2026-04-22
- Step 7d: global rank per (user × group) — sorts by total_points DESC, exact_scores DESC — matches leaderboard RPC exactly
- exact_scores tracked from predictions where points_earned = 3 (per user × group)
- RANK() tiebreaker: same pts AND same exact_scores → same rank; otherwise increment
- Step 8g: writes `display_data: { global_ranks: { username: rank } }` to ai_summaries after upsert
- display_data is UI-only — never part of input_json/LLM payload
- Applies to new summaries only (old summaries keep existing display_data)

## nightly-summary v15 — Deployed 2026-04-22
- Step 7d: global rank per (user × group) — total_points only (no tiebreaker) — superseded by v16
- Daily standings (AiFeed.jsx): shows ALL group members incl. 0 pts / no predictions

## nightly-summary v14 — Deployed 2026-04-21
- Step 7d: all-time global rank per user, deduped by (user_id, game_id), max points per game
- M57: ai_summaries.display_data jsonb column added

## nightly-summary v13 — Built, Deployed & Verified 2026-04-12 (live test)

Branch: `feature/nightly-summary`. Model: OpenAI gpt-4o-mini.
OpenAI key: EF secret named `AI_Summary_GPT_Key` ✅ (reads `OPENAI_API_KEY` first, falls back to `AI_Summary_GPT_Key`).
Auth: `verify_jwt: true` — Supabase gateway verifies the service role JWT; no manual SRK check in code.

### Live test result (2026-04-11 real La Liga + PL games, triggered manually 2026-04-12)
- processed: 5 groups, skipped: 0, errors: []
- Groups below 3 members correctly skipped
- Content banter-style, group-specific, roasts auto-pickers, references correct scores
- Summaries verified against actual game data (Arsenal 1-2, Liverpool 2-0, Barcelona 4-1, Sevilla 2-1)

### Cron bug found & fixed (2026-04-12) — Migration 56
- **Bug**: `fn_schedule_ai_summaries()` passed `body := jsonb_build_object(...)::text` to `net.http_post`
- `net.http_post` expects `body` as `jsonb` — `::text` cast caused silent SQL type error
- pg_net never queued the request; EF never fired from cron
- **Fix**: Migration 56 — removed `::text` cast. Re-created Apr 12+13 crons with correct type.
- Apr 11 summary manually triggered and verified. Apr 12+ will fire automatically.

### End-to-end test result (2026-06-15)
- processed: 2 groups ("The Legends" + "Test"), skipped: 0, errors: []
- ai_summaries rows written with all LLM fields: model=gpt-4o-mini, temperature=0.5, top_p=1, max_tokens=400, seed=42
- prompt_tokens ~2100, completion_tokens ~260 per group
- content banter-style, group-specific, ~1100 chars

### Trigger
pg_cron fires **150min after last kickoff** of the day (fn_schedule_ai_summaries, updated in M53).
Run `SELECT fn_schedule_ai_summaries();` once after games table is seeded.

### Guards
- A1: no finished games on date → exit `no_games_today`
- A3: not all games of day finished → exit `games_not_finished`
- Soft: stats not synced → proceed but omit scorers/scorer_goals_today fields

### Qualifying groups
≥3 active (non-inactive) members only. Below threshold: silently skipped.

### Prompt system
`prompt_versions` table (M53). Active prompt read at runtime — no redeploy needed to iterate prompt.
**v10 ACTIVE** (activated 2026-04-10 20:41). Iterated v1→v10 over one session (2026-04-10). Test CSVs saved in test/prompts/prompt_v1.csv … test/prompts/prompt_v10.csv.
Key v10 changes vs v1: compact JSON payload, 6-paragraph required structure, HARD BANS list, global_top/global_zero, P4 competitive framing (competitors not "the app"), auto-picks → "the surprise model", P2 gap verification, P6 streak rules.

**Test mode:** pass `version_id` in request body → EF uses that draft prompt and writes `test_input/test_output/test_tokens` back to `prompt_versions` row.

**Iterate prompt workflow:**
1. `INSERT INTO prompt_versions (version_tag='v2', is_active=false, ...)`
2. Trigger EF with `{"date":"...","version_id":"<v2-uuid>"}` → results written back
3. If happy: `UPDATE prompt_versions SET is_active=true WHERE id='<v2-uuid>'` → trigger auto-deprecates v1

### Data sent per group (compact JSON) — v13
- leaderboard: rank, total_pts, exact, today_pts, streak (positive=win, negative=loss)
- today.global_top[]: top 3 scorers app-wide with in_group flag (pts > 0)
- today.global_zero[]: zero-pointers app-wide with all_auto flag + in_group flag
- games: match, phase, scorers[], dist_group (% + top_score/top_score_n), dist_global (% + top_score, exact_hits)
- predictions: per member — pred, pts, auto flag
- picks: champion, top_scorer, scorer_goals_today (0 = silence)
**Breaking changes from v10**: today.top_scorer/zero_pts replaced with today.global_top/global_zero. dist_group now includes top_score/top_score_n.

### Error handling
Per A–D in docs/ERROR_HANDLING.md. 2s gap between groups. 120s timeout guard.
Failed upserts → `failed_summaries` table (existing, M20).

### Test trigger
```bash
curl -X POST https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/nightly-summary \
  -H "Authorization: Bearer <SRK>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-15"}'
# Test mode (draft prompt):
  -d '{"date":"2026-06-15","version_id":"<prompt-version-uuid>"}'
```

### Verify after trigger
```sql
SELECT version_tag, is_active, activated_at FROM prompt_versions;
SELECT group_id, date, model, prompt_version_id, char_length(content) len
  FROM ai_summaries ORDER BY generated_at DESC LIMIT 5;
SELECT group_id, error_msg FROM failed_summaries WHERE resolved = false;
SELECT LEFT(content, 400) FROM ai_summaries ORDER BY generated_at DESC LIMIT 1;
```

---

## Game Insert Auto-Scheduling — M68 (2026-05-04) ✅
`trg_auto_schedule_game` AFTER INSERT trigger on `public.games` — deployed M68.
Automatically calls: fn_schedule_auto_predictions() + fn_schedule_ai_summaries() + fn_schedule_game_sync(NEW.id).
Guards: fn_schedule_game_sync only fires if `kick_off_time > now()` AND `api_fixture_id IS NOT NULL`.
Exception handlers: scheduling failure never blocks the INSERT.
**Knockout games inserted before setup mode**: api_fixture_id is null → fn_schedule_game_sync skipped → call manually after running EF setup mode.

## football-api-sync v24 — ACTIVE

Key changes since v18:
- v22: +passes_total/passes_accuracy in writeStats + snap_stats
- v19: Bet365 odds (bookmaker ID 8); source written as 'bet365'
- v18: writeStats merges team + player stats; red_cards derived by summing player rows (VAR-correct)

Modes: probe, snap_stats, sync, sync_af_odds, sync_stats, verify, setup.

---

## football-api-sync — Error Handling Audit (2026-04-11)

Full status in `docs/ERROR_HANDLING.md` implementation status table. Summary:

### What's implemented ✅
- Rate limit (429) in score fetch → `fn_schedule_retry_sync` +10min
- Game in play / score null at FT → retry +5min
- ET in progress → partial write + `et_followup` cron +40min
- ET/PEN complete at KO+120 → writes all at once
- DB score write → 3 immediate retries before throwing
- Partial stats (null fields) → writes available, nulls rest
- All writes → upsert `ON CONFLICT DO UPDATE` (duplicate-safe)
- Odds: per-game error collection, writes what succeeds
- Odds: `is('score_home', null)` filter stops updating after KO
- KO time mismatch in verify → updates DB + re-schedules cron

### Gaps — not implemented ❌

**Before launch (blocking):**
- `writeStats` errors swallowed silently — no retry scheduling, no alert. Fix: on catch, call `fn_schedule_retry_sync` with `mode=sync_stats` +30min
- `fn_calculate_points` trigger health check — not verified before/after score write. Fix: query `information_schema.triggers` in `handleSync` before writing score
- Rate limit in `writeStats` — RATE_LIMIT thrown by `footballApiGet` inside `writeStats` try/catch is swallowed. Fix: propagate + schedule retry
- `mode=morning_check` EF mode — entire daily verification concept absent (fixture IDs, KO times, cron registrations, missing stats). Build ~May 2026

**Medium:**
- Admin alerting — console.error only. Fix: write to `admin_alerts` table `(created_at, severity, message)`
- Score > 5 goals not validated — writes immediately without confirmation
- PST/CANC in `handleSync` — falls through to generic +5min retry forever; no self-unschedule

**Low / defer:**
- Retry-every-30min after 3 DB score failures (3 retries already in place)
- Team name re-validation in `handleSync` (setup validated already)
- KO-20/KO-10 retry in `handleVerify` on API down

### Mismatches vs ERROR_HANDLING.md spec
- Error 4: doc says "3 consecutive failures → alert + keep retrying every 30min" — EF only handles rate limit; network errors throw → 500, no retry RPC
- Error 13/14: doc says "+5min → +15min → +30min → alert" retry chain for stats — EF logs only
- Error 18: doc says "keep retrying every 30min" after 3 DB failures — EF throws after 3x
- Error 31: doc says validate team names in sync — EF trusts api_fixture_id from setup
- Admin alerting (all groups): doc says "alert admin" — EF has no mechanism

## sync-odds v14 — ACTIVE

Champion odds only (William Hill). TEAM_NAME_MAP: USA→United States.
Filters non-WC teams (Sweden, Turkey, Iraq, etc.).

---

## EF Secrets (Supabase Edge Function secrets — Deno.env.get())
- SUPABASE_URL ✅ auto-injected by Supabase
- SUPABASE_SERVICE_ROLE_KEY ✅ auto-injected by Supabase
- AI_Summary_GPT_Key ✅ set (2026-04-10, renamed from "AI Summary - GPT Key" → underscores)
- FOOTBALL_API_KEY ✅ set
- theoddsapi ✅ set

## Vault Secrets (DB — vault.decrypted_secrets)
- app_edge_function_url ✅ set
- app_service_role_key ✅ set (2026-03-26)

## Pending
- Run football-api-sync mode=setup (after FOOTBALL_API_KEY confirmed working)
- Run fn_schedule_game_sync() for all games (after setup)
- Run fn_schedule_ai_summaries() (after games seeded) — see note below before running
- Clean up test data: delete "The Legends" group + test games/predictions/picks/events; NULL out fake scores on 4 real 2026-06-15 games

## Known error handling gaps (not yet implemented)
Verified 2026-04-11 against docs/ERROR_HANDLING.md F8 section.

| Gap | Code | Severity | Detail |
|---|---|---|---|
| No trigger health check | A2 | Medium | EF doesn't verify fn_calculate_points ran correctly before calling LLM — leaderboard could be wrong |
| No fallback written on group data fail | B2 | Low | Group RPC error → group skipped silently, nothing written to ai_summaries for that day |
| No retry on group RPC fail | B3 | Low | Group RPC error → skips immediately, no single retry attempt |
| No hallucination check | C3 | Low | No validation that response references a member name — generic response goes straight to DB |
| No admin alerting | General | Medium | EF only logs to console + returns errors in response body — no email/Slack/webhook alert |

Implement before launch. Fix order: A2 → admin alerting → B2/B3 → C3.

## Planned improvement: dual-cron retry for stats gap
**Problem:** stats check in EF is soft — if football-api-sync hasn't finished when nightly-summary fires (T+150min), summary runs without goal scorer data.
**Solution:** register 2 cron jobs per game-day in fn_schedule_ai_summaries():
- `ai-summary-YYYY-MM-DD` → T+150 (primary): if statsReady=false → return `stats_pending`, no LLM call
- `ai-summary-YYYY-MM-DD-retry` → T+180 (retry): always proceeds, soft degradation if still no stats
**EF change:** make stats check hard on primary attempt. Distinguish via `{"date":"...","retry":true}` in POST body — retry skips the hard stats check.
**Status:** not yet implemented — implement before running fn_schedule_ai_summaries().

## Odds Architecture (final)
| Data | Source | Mechanism |
|---|---|---|
| Game 1X2 + over/under | API Football Bet365 | pg_cron af-odds-daily 07:15 UTC |
| Champion outright | TheOddsAPI William Hill | cron-job.org 07:00 UTC, expires Jun 11 2026 |

## Point 7 — Player Rating (deferred)
`game_player_stats.rating` stored per-game since M46. Two options not yet decided:
1. Game page stat — players sorted by rating
2. AI summary context — top 3 rated players fed to nightly-summary prompt
