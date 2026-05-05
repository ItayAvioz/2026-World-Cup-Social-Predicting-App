---
name: db-phase
description: DB build status, migration files, RPCs, schema decisions, test pages — active during DB build & verify phase
type: project
originSessionId: 2558683a-5bcd-4860-8faa-5b07a193465b
---
## DB Build Status

| Table | Status | Migration file |
|---|---|---|
| profiles | ✅ verified 2026-03-14 | 20260312000002_profiles.sql |
| groups + group_members | ✅ verified 2026-03-14 | 20260312000001_groups.sql |
| group rename lock (migration 11) | ✅ deployed 2026-03-14 | 20260314000011_group_rename_lock.sql |
| games | ✅ live + 104 games seeded | 20260312000003_games.sql |
| predictions | ✅ live + 104 cron jobs | 20260313000004_predictions.sql |
| champion_pick | ✅ live | 20260313000005_picks.sql |
| top_scorer_pick | ✅ live | 20260313000005_picks.sql |
| leaderboard | ✅ live (view + 2 RPCs) | 20260313000006_leaderboard.sql |
| ai_summaries | ✅ live | 20260313000007_ai_summaries.sql |
| game_team_stats | ✅ live | 20260314000008_game_stats.sql |
| game_player_stats | ✅ live | 20260314000008_game_stats.sql |
| fixes (migration 9) | ✅ deployed 2026-03-14 | 20260314000009_fixes.sql |
| user self-service (migration 10) | ✅ deployed 2026-03-14 | 20260314000010_user_self_service.sql |
| predictions profile FK (migration 12) | ✅ deployed 2026-03-15 | 20260315000012_predictions_profile_fk.sql |
| distribution RPC v2 (migration 13) | ✅ deployed 2026-03-15 | 20260315000013_distribution_rpc_v2.sql |
| picks profile FK (migration 14) | ✅ deployed 2026-03-15 | 20260315000014_picks_profile_fk.sql |
| auto-assign picks (migration 15) | ✅ deployed 2026-03-15 | 20260315000015_auto_assign_picks.sql |
| leaderboard top_scorer_player (migration 16) | ✅ deployed 2026-03-16 | 20260316000016_leaderboard_top_scorer.sql |
| games ET + penalties columns (migration 17) | ✅ deployed 2026-03-16 | 20260316000017_games_et_penalties.sql |
| fix get_group_summary_data (migration 18) | ✅ deployed 2026-03-16 | 20260316000018_fix_group_summary_data.sql |
| games end result columns (migration 19) | ✅ deployed 2026-03-16 | 20260316000019_games_end_result.sql |
| failed_summaries table (migration 20) | ✅ deployed 2026-03-16 | 20260316000020_failed_summaries.sql |
| game_odds table (migration 21) | ✅ deployed 2026-03-16 | 20260316000021_game_odds.sql |
| games.api_fixture_id (migration 22) | ✅ deployed 2026-03-17 | 20260317000022_games_api_fixture_id.sql |
| RLS fixes (migration 23) | ✅ deployed 2026-03-17 | 20260317000023_rls_fixes.sql |
| fn_auto_predict_game contrarian (migration 24) | ✅ deployed 2026-03-17 | 20260317000024_auto_predict_contrarian.sql |
| captain self-flag guard + auto-predict log (migration 25) | ✅ deployed 2026-03-17 | 20260317000025_captain_guard_and_autopred_log.sql |
| fix SECURITY DEFINER views (migration 26) | ✅ deployed 2026-03-19 | 20260319000026_fix_security_definer_views.sql |

All DB tables + views ✅ COMPLETE. Migrations 9–26 deployed and verified.

## DB Objects Summary
- `create_profile(p_username)` — atomic profile creation RPC; raises 'username_taken' or 'invalid_username'
- `delete_account()` — self-deletion RPC; raises 'account_locked' (after June 11) or 'cannot_delete_in_group'; cascades all user data
- `create_group(name)` — enforces max 3 groups, triggers invite_code + creator join
- `join_group(invite_code)` — enforces max 10 members, validates code
- `get_leaderboard()` — all users globally ranked (SECURITY DEFINER RPC); returns rank, user_id, username, champion_team, top_scorer_player, total_points, exact_scores
- `get_group_leaderboard(p_group_id)` — group members with group_rank + global_rank, membership-gated; same columns + group_rank
- `get_group_summary_data(group_id, date)` → jsonb — Edge Function prompt data (inlined leaderboard — no auth.uid() dependency; safe to call from service role)
- `get_game_prediction_distribution(game_id, group_id?)` → jsonb — team names, W/D/L counts, avg_goals (total per game), top_scores. group_id optional — filters to group members only. Call once per group + once globally for game.html display.
- `fn_calculate_points()` — trigger on games AFTER UPDATE OF score_home/score_away
- `fn_calculate_pick_points()` — trigger on games AFTER UPDATE OF knockout_winner; awards champion + top scorer 10pt; resets first (idempotent)
- `fn_auto_predict_game(game_id)` — inserts CONTRARIAN predictions at kickoff (picks least-popular W/D/L outcome, generates matching score per user; falls back to random if no predictions exist); self-unschedules; logs game_id + outcome + row count to Postgres log. Migration 24+25.
- `fn_schedule_auto_predictions()` — loops ALL games (no filter), creates/updates `auto-predict-{game_id}` cron at each game's kickoff time. Now called automatically by trigger on INSERT — no manual call needed.
- `fn_schedule_ai_summaries()` — loops ALL games, creates/updates `ai-summary-{date}` cron 150min after last KO of each day. Now called automatically by trigger on INSERT — no manual call needed.
- `fn_auto_schedule_game()` + `trg_auto_schedule_game` — AFTER INSERT trigger on games (M68, 2026-05-04). Auto-calls fn_schedule_auto_predictions + fn_schedule_ai_summaries + fn_schedule_game_sync on every game insert. Guards: fn_schedule_game_sync only fires if KO > now() AND api_fixture_id IS NOT NULL. Exception handlers prevent INSERT failure.
- `team_tournament_stats` VIEW — per team: W/D/L + stat averages (finished games only). SECURITY INVOKER. Public SELECT granted.
- `player_tournament_stats` VIEW — per player: total goals/assists/cards (sort client-side). SECURITY INVOKER. Public SELECT granted.
- `leaderboard` VIEW — internal helper for RPCs. SECURITY INVOKER. Public SELECT granted (clients use RPCs, not view directly).
- `game_odds` table — 1X2 odds (home_win, draw, away_win). draw always filled (group=draw, knockout=goes to ET). Future: over_2_5, under_2_5. Decision pending on first-game display (Option A: empty message / B: pre-tournament form / C: odds only).

## Schema Decisions (do not re-ask)
- No `status` column on games — use `score_home IS NOT NULL` for finished
- Scores = 90-min only, no ET/penalties (including knockout games)
- games.knockout_winner: NULL for group stage; actual winner for knockout (may differ from 90-min score)
- ⚠️ API SYNC RULE: score_home/score_away = 90-min only even if game goes to ET/pens. Never write ET/pens goals there.
- Prediction scoring + leaderboard always based on 90-min score only. knockout_winner used only for champion/top-scorer points.
- Champion/top-scorer points triggered by Phase 4 API sync setting games.knockout_winner on the final
- fn_calculate_pick_points: idempotent — resets all to 0 then re-awards on each knockout_winner change
- top scorer: finds MAX(total_goals) in player_tournament_stats, then awards 10pts to ALL tied players at that count (ARRAY_AGG + ANY). Migration 38 fixed old LIMIT 1 bug that only awarded one player.
- top_scorer_pick.player_name: no CHECK constraint — value sourced from API team lineups (not free text entry). Client-enforced by design.
- Auto-predict: pg_cron fires at exact kickoff → fn_auto_predict_game → self-unschedules
- Auto-predictions earn points same as manual (is_auto flag for display only)
- ⚠️ AUTO-PREDICT DESIGN (game scores): pick the LOWEST distribution outcome (contrarian/"surprise" pick)
  If most users picked home win → auto-predict picks away win or draw (whichever has fewer picks)
  Goal: users who didn't predict get the "underdog" score, not a random one
  → fn_auto_predict_game needs to query existing predictions distribution before inserting
  → If no predictions exist yet → fall back to pure random
- ⚠️ AUTO-ASSIGN DESIGN (champion + top scorer): RANDOM from full list
  Each missing user gets their own independent random pick at KO (2026-06-11T19:00:00Z)
  → fn_auto_assign_picks() — random from 48 teams / 7 players list
  → is_auto=true on both champion_pick and top_scorer_pick for display
- group_members: no leave, no remove, permanent. is_inactive flag → captain can set/unset for MEMBERS ONLY (captain cannot flag themselves — enforced at DB level via WITH CHECK AND user_id != auth.uid(), Migration 25)
- is_inactive is a DISPLAY FLAG only — dimmed on leaderboard. Does not stop auto-predict, does not remove from group, does not affect points. If captain wants full removal → contacts admin → admin runs query + deletes manually via Supabase dashboard.
- Admin query to find inactive users (all-auto predictors):
    SELECT p.username,
      COUNT(*) FILTER (WHERE pr.is_auto = false) AS manual_preds,
      COUNT(*) FILTER (WHERE pr.is_auto = true)  AS auto_preds
    FROM public.profiles p
    LEFT JOIN public.predictions pr ON pr.user_id = p.id
    GROUP BY p.id, p.username
    ORDER BY manual_preds ASC;
  Users at top (manual_preds=0) = never predicted manually = likely inactive.
- ⚠️ IDEA (no solution yet): admin alert when captain marks a member inactive — so admin is notified and can decide whether to delete. Deleting a user from a 3-person group drops it to 2 → group loses AI summary. Captain should be warned before contacting admin.
- ⚠️ GROUPLESS USERS NOTE: users can register without joining a group (arrive directly, not via invite link). They get full prediction experience (global leaderboard, earn points) but no group leaderboard and no AI summary. They count toward global prediction distribution. In practice rare — app is invite-driven. No implementation planned. Admin SQL to find them: SELECT id, username FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id = p.id);
- Groups: captain can rename until 2026-06-11T19:00:00Z (locked after, same as username rename)
- Groups: permanent (no delete). Max 3 per creator. Max 10 members incl. captain
- Username: renameable until 2026-06-11T19:00:00Z, locked after. 3-20 chars, alphanumeric+underscore, case-sensitive
- Account deletion: allowed before June 11 AND only if not in any group. Cascades all data. groups.created_by → SET NULL.
- Predictions: visible to group members only (not global) after kickoff
- Points: exact score = 3pt, correct outcome = 1pt (not additive)
- champion_pick / top_scorer_pick: upsert on conflict user_id, lock at 2026-06-11T19:00:00Z
- top_scorer_pick: player_name = display name; top_scorer_api_id (int) = exact points matching
- champion_pick.team: DB CHECK with all 48 team names
- ai_summaries: only for groups with ≥3 members; one per group per game-day (≥3 filter enforced in Edge Function, not DB)
- get_group_summary_data: SECURITY DEFINER, safe from service role — do NOT call get_group_leaderboard() from it (auth.uid()=NULL in EF context)
- API sync flow: check KO+120min → score available? done. Not available? poll every 5min (group stage + knockout 90min). Knockout ET: check +40min after ET starts, then every 5min.
- API sync writes per game: score_home/away (90-min) + went_to_extra_time + et_score_home/away + went_to_penalties + penalty_score_home/away + knockout_winner
- Nightly summary trigger: fired by API sync EF when last game of the day is confirmed finished
- et_score_home/away: score after ET (NULL if no ET). penalty_score: shootout result. Both for display only.
- AI summary additional context (future): biggest climber, perfect day, contrarian hero, champion danger zone, wisdom of crowds, auto-predict performance, top scorer leader, teams eliminated
- group_members.user_id has FK → profiles.id (added 2026-03-14 for PostgREST join support)
- predictions.user_id has FK → profiles.id (added 2026-03-15 for PostgREST join support)
- champion_pick.user_id has FK → profiles.id (added 2026-03-15 for PostgREST join support)
- top_scorer_pick.user_id has FK → profiles.id (added 2026-03-15 for PostgREST join support)
- PATTERN: every table with user_id needs FK → profiles.id (not just auth.users) for PostgREST joins
- Streak = consecutive correct/wrong W/D/L outcomes (positive/negative count)
- champion_pick + top_scorer_pick: both lock at 2026-06-11T19:00:00Z (same as first game KO)
- Points reset on score correction: trigger recalculates on every score_home/score_away update (not relevant in prod — API sets score once)

## Pending Schema
- `champion_pick.team` CHECK constraint — update to real team names once playoff spots resolve (currently includes UEFA PO-A/B/C/D + IC PO-1/2 placeholders)

## Verification Plan & Test Pages
Full plan: docs/PLAN.md → SUPERSEDED → see memory/db-phase.md (this file) + supabase/CLAUDE.md

| Test page | Feature |
|---|---|
| test/test-auth.html | F1: sign up, create_profile RPC |
| test/test-groups.html | F2: create/join groups, RLS |
| test/test-predictions.html | F3+7: predict, deadline, points, distribution, contrarian auto-predict (section 7) |
| test/test-picks.html | F5: champion + top scorer picks |
| test/test-leaderboard.html | F6: global + group leaderboard |
| test/test-ai-feed.html | F8: trigger Edge Function, view summaries |
| test/test-game-stats.html | F9: game_team_stats, views, ET/pens columns, game_odds (Part C) |
| test/test-failed-summaries.html | failed_summaries table: insert, list, resolve |
| test/test-delete-account.html | delete_account() RPC guards: in-group block, date lock, cascade |
