# Supabase — Deployed State

## Migrations (107 local + 1 prod-only + 3 MCP-only — all deployed)

> **Tracking note**: M1–M26 applied before Supabase migration tracking began. M39–M45, M52, M95, M96 applied via Supabase dashboard (deployed, not in schema_migrations). All others tracked in DB. Stub files = comment-only, no SQL (applied via MCP without local file at the time).
> **Parity rule (post-M117)**: All NEW changes must go through `apply_migration` (writes to schema_migrations + survives pg_dump cleanly). Dashboard SQL editor for hotfixes is OK only if a migration file is also added in the same commit.

| # | File | Description |
|---|---|---|
| 1 | 20260312000001_groups.sql | groups + group_members tables |
| 2 | 20260312000002_profiles.sql | profiles table |
| 3 | 20260312000003_games.sql | games table + 104 WC games seeded |
| 4 | 20260313000004_predictions.sql | predictions table + RLS |
| 5 | 20260313000005_picks.sql | champion_pick + top_scorer_pick |
| 6 | 20260313000006_leaderboard.sql | leaderboard view + RPCs |
| 7 | 20260313000007_ai_summaries.sql | ai_summaries table |
| 8 | 20260314000008_game_stats.sql | game_team_stats + game_player_stats |
| 9 | 20260314000009_fixes.sql | misc fixes |
| 10 | 20260314000010_user_self_service.sql | delete_account + username rename RLS |
| 11 | 20260314000011_group_rename_lock.sql | group rename lock (Jun 11) |
| 12 | 20260315000012_predictions_profile_fk.sql | predictions.user_id FK → profiles |
| 13 | 20260315000013_distribution_rpc_v2.sql | get_game_prediction_distribution v2 |
| 14 | 20260315000014_picks_profile_fk.sql | picks.user_id FK → profiles |
| 15 | 20260315000015_auto_assign_picks.sql | fn_auto_assign_picks + cron |
| 16 | 20260316000016_leaderboard_top_scorer.sql | leaderboard top_scorer_player column |
| 17 | 20260316000017_games_et_penalties.sql | ET + penalty columns on games |
| 18 | 20260316000018_fix_group_summary_data.sql | fix get_group_summary_data |
| 19 | 20260316000019_games_end_result.sql | games knockout_winner + went_to_extra_time |
| 20 | 20260316000020_failed_summaries.sql | failed_summaries table |
| 21 | 20260316000021_game_odds.sql | game_odds table |
| 22 | 20260317000022_games_api_fixture_id.sql | games.api_fixture_id column |
| 23 | 20260317000023_rls_fixes.sql | RLS policy fixes |
| 24 | 20260317000024_auto_predict_contrarian.sql | fn_auto_predict_game (contrarian) |
| 25 | 20260317000025_captain_guard_and_autopred_log.sql | captain self-flag guard + auto-predict log |
| 26 | 20260319000026_fix_security_definer_views.sql | fix SECURITY DEFINER views |
| 27 | 20260326000027_api_sync_cron_infrastructure.sql | fn_schedule_game_sync + fn_schedule_retry_sync + fn_unschedule_game_sync + fn_schedule_auto_predictions |
| 28 | 20260328000028_leaderboard_group_name.sql | group name on leaderboard |
| 29 | 20260329000029_picks_per_group.sql | champion_pick + top_scorer_pick per group_id |
| 30 | 20260329000030_per_group_predictions.sql | predictions scoped per group |
| 31 | 20260329000031_leaderboard_per_group.sql | leaderboard per group |
| 33 | 20260329000033_leaderboard_all_users_and_rank_ties.sql | global leaderboard all users + RANK() ties |
| 34 | 20260329000034_global_prediction_stats_rpc.sql | global prediction distribution RPC |
| 35 | 20260329000035_global_pred_stats_all_rows.sql | global pred stats all rows |
| 36 | 20260329000036_ungrouped_predictions.sql | ungrouped user predictions |
| 37 | 20260329000037_ungrouped_picks.sql | ungrouped user picks |
| 37b | 20260329151310_fix_group_leaderboard_ambiguous_columns.sql | fix ambiguous columns in group leaderboard |
| 38 | 20260331000038_fix_top_scorer_points_ties.sql | top scorer ties: award all tied players |
| 39 | 20260401000039_qa_fixes.sql | QA round 1 fixes |
| 40 | 20260401000040_qa_fixes_round2.sql | QA round 2 fixes |
| 41 | 20260402000041_contrarian_auto_assign_picks.sql | contrarian auto-assign picks |
| 42 | 20260402000042_c1_c2_contrarian_predict_rls_fix.sql | RLS fix for contrarian predict |
| 43 | 20260402000043_max_3_groups_total_membership.sql | max 3 groups per user (created + joined) |
| 44 | 20260402000044_fn_schedule_ai_summaries_vault.sql | fn_schedule_ai_summaries (reads vault) |
| 45 | 20260402000045_teams_and_players_tables.sql | teams + top_scorer_candidates tables |
| 46 | 20260403000046_stats_enrichment.sql | game stats enrichment columns |
| 47 | 20260403000047_odds_champion.sql | champion odds table |
| 48 | 20260405000048_odds_cleanup.sql | odds cleanup |
| 49 | 20260405000049_avg_offsides_tournament_stats.sql | avg offsides in tournament stats |
| 50 | 20260405000050_game_events.sql | game_events table (goals + red cards) |
| 51 | 20260405000051_top_scorer_api_id_not_null.sql | top_scorer_candidates.api_player_id |
| 51b | 20260405120733_passes_stats.sql | passes_total + passes_accuracy in game_team_stats |
| 52 | 20260406000052_global_auto_predict_counts.sql | global auto-predict counts |
| 53 | 20260410000053_prompt_versions.sql | prompt_versions table |
| 54 | 20260410000054_ai_summaries_llm_fields.sql | ai_summaries LLM fields |
| 55 | 20260410000055_prompt_versions_llm_fields.sql | prompt_versions LLM test fields |
| 56 | 20260412000056_fix_fn_schedule_ai_summaries_body_type.sql | fix net.http_post body ::text bug in fn_schedule_ai_summaries |
| 57 | 20260421000057_ai_summaries_display_data.sql | ai_summaries.display_data jsonb column |
| 58 | 20260422172100_fn_schedule_auto_predict_all_games.sql | fn_schedule_auto_predictions to cover ALL games — stub, reverted by M59 |
| 59 | 20260422000059_revert_fn_schedule_ai_summaries.sql | revert fn_schedule_ai_summaries to correct version |
| 60 | 20260503000060_feedback.sql | feedback table + RLS + storage bucket |
| 60b | 20260503082239_feedback_bucket_public.sql | feedback storage bucket made public — stub |
| 60c | 20260503083901_feedback_view.sql | admin feedback view — stub |
| 61 | 20260504000061_admin_notifications.sql | ef_errors + app_events + fn_notify_admin + digest cron + notify-admin EF trigger |
| 62 | 20260504000062_judge_llm.sql | ai_judge_runs table + agent_slot on prompt_versions + ai_summaries judge cols + v11/v12/v13 prompts |
| 62b | 20260504132006_judge_test_anon_access.sql | anon access for judge LLM test — stub |
| 63 | 20260504000063_judge_v10_baseline.sql | baseline slot + v10→baseline + winner_agent 1–4 |
| 63b | 20260504134747_prompt_fixes_v2.sql | v11/v12/v13 prompt patches — stub, reverted by M64b |
| 64 | 20260504000064_prompt_v2.sql | candidate_4 slot + winner_agent 1–5 + v10B/v11-main-2/v12-picks-2/v13-unique-2 prompts |
| 64b | 20260504144115_revert_prompt_fixes_v2.sql | revert prompt patches — stub |
| 65 | 20260504000066_prompt_v3.sql | champion confusion guard + v12 direction synonym fix patches |
| 68 | 20260504000068_auto_schedule_on_game_insert.sql | trg_auto_schedule_game: AFTER INSERT on games auto-schedules all crons |
| 69 | 20260505000069_ai_summaries_winner_score.sql | ai_summaries.winner_score + version_tag backfilled into ai_judge_runs.candidates |
| 70 | 20260505000070_ai_judge_scores_view.sql | ai_judge_scores view: one row per agent per run (group_name, date, slot, version_tag, scores, is_winner) |
| 71 | 20260505000071_backfill_sync_game_crons.sql | one-time backfill: fn_schedule_game_sync for all existing future games with api_fixture_id (M68 covers new inserts) |
| 72 | 20260506000072_v13_template_opener_fix.sql | v13-unique-2 prompt: ban verbatim "not just this group" opener in GLOBAL TOP RULE + quality check |
| 73 | 20260510000073_fn_schedule_ai_summaries_per_group.sql | fn_schedule_ai_summaries: one cron per qualifying group per date (Option B fix for 120s timeout) |
| 74 | 20260512000074_fix_fn_schedule_ai_summaries_body_cast.sql | fix fn_schedule_ai_summaries: remove ::text cast from net.http_post body (M73 re-introduced M56 bug) |
| 83 | 20260514000083_fix_fn_schedule_ai_summaries_timing.sql | fix fn_schedule_ai_summaries: restore 150min delay (M73 regressed to 110 — fires before score sync at KO+120) |
| 76 | 20260512000076_daily_digest_enhanced_stats.sql | fn_daily_admin_digest: per-game manual/auto split + auto_exact/auto_correct, outcomes from total, share_click tracking, peak hour in Israel time, v10B wins |
| 77 | 20260512000077_trivia_schema.sql | trivia_questions + trivia_answers tables + RLS |
| 78 | 20260512000078_trivia_rpc.sql | submit_trivia_answer SECURITY DEFINER RPC |
| 79 | 20260512000079_leaderboard_trivia.sql | leaderboard + trivia points — **SUPERSEDED by M81, do NOT apply** |
| 80 | 20260512000080_trivia_questions_seed.sql | 40 trivia questions seeded — Jun 11–Jul 20, 22:00 Israel time (19:00 UTC) |
| 81 | 20260512000081_leaderboard_trivia_auto.sql | leaderboard trivia auto-guard — activates when final game knockout_winner is set |
| 82 | 20260513000082_fix_team_tournament_stats_et.sql | team_tournament_stats view: W/D/L uses knockout_winner for ET/PEN games; avg_goals uses COALESCE(et_score, score) for full-match count |
| 84 | 20260517000084_daily_digest_unique_users.sql | fn_daily_admin_digest: add unique user counts for prediction_submit + pick_submit |
| 85 | 20260517000085_daily_digest_pred_pick_breakdown.sql | fn_daily_admin_digest: predictions from DB table (new/edits/users/games); picks split champion vs top scorer |
| 86 | 20260517000086_daily_digest_pred_unique_user_game.sql | fn_daily_admin_digest: predictions count DISTINCT (user_id, game_id) — superseded by M87 |
| 87 | 20260517000087_daily_digest_revert_to_per_group_counts.sql | fn_daily_admin_digest: revert M86 — raw rows per user per group (stub) |
| 88 | 20260517000088_daily_digest_fix_auto_correct_filter.sql | fn_daily_admin_digest: fix auto_correct filter dropped in M87 (stub) |
| 89 | 20260517000089_daily_digest_pred_groups_count.sql | fn_daily_admin_digest: predictions add unique groups; display total · users · games · groups (stub) |
| 90 | 20260517000090_daily_digest_edits_and_picks_breakdown.sql | fn_daily_admin_digest: add edits to predictions; champion+top scorer picks show total · edits · users · groups (stub) |
| 91 | *(MCP-only, no local file)* | push_subscriptions table + RLS (user_id, endpoint, p256dh, auth; UNIQUE user_id,endpoint) |
| 92 | *(MCP-only, no local file)* | fn_notify_ko + fn_schedule_ko_notification + fn_notify_trivia + trivia-push-daily cron (0 19 * * * UTC) |
| 93 | *(MCP-only, no local file)* | fn_notify_ai_summary trigger function + trg_notify_ai_summary AFTER INSERT on ai_summaries |
| 94 | 20260517000094_trivia_security_hardening.sql | Trivia security: trivia_secrets table (RLS enabled, no SELECT policy) stores correct_option+explanation; trivia_questions drops those cols; RLS time-locked (available_from <= now()); submit_trivia_answer updated to JOIN trivia_secrets |
| 95 | 20260518000095_security_rls_view_fixes.sql | Security: feedback SELECT restricted to service_role only; ai_judge_scores view: REVOKE SELECT from anon+authenticated; team_tournament_stats left as-is (frontend depends on it) |
| 96 | 20260518000096_security_revoke_views_prompts.sql | Security: feedback_readable view REVOKE from anon+authenticated; prompt_versions anon read policy dropped (service role only) |
| 97 | 20260518000097_fix_team_tournament_stats_security_invoker.sql | Fix team_tournament_stats: recreated with security_invoker=true (was SECURITY DEFINER — bypassed RLS) |
| 98 | 20260518000098_add_friendly_phase.sql | games.phase CHECK constraint: add 'friendly' value for non-WC test/warm-up games |
| 99 | 20260518000099_add_ko_notif_to_auto_schedule_trigger.sql | trg_auto_schedule_game: add fn_schedule_ko_notification call on INSERT (was missing — backfilled 2 May 19 friendlies) |
| 100 | 20260519000100_add_get_my_trivia_result_rpc.sql | get_my_trivia_result(question_id) SECURITY DEFINER RPC — returns correct_option+explanation from trivia_secrets ONLY if user has answered (cross-device result display fix) |
| 101 | 20260520000101_consolidate_ai_summary_push.sql | Drop trg_notify_ai_summary + fn_notify_ai_summary (per-group push on INSERT). Add fn_notify_ai_summary_daily(date) — one push per user (DISTINCT across all qualifying groups). fn_schedule_ai_summaries: also schedule `ai-summary-push-{date}` cron at last_KO+160min (10min after per-group jobs). User in N groups now gets 1 push, not N. |
| 102 | 20260520000102_trivia_missed_as_wrong.sql | Trivia: missed questions count as wrong. fn_auto_miss_trivia(question_id) inserts trivia_answers(selected_option='miss', is_correct=false, points_earned=0) for every user registered before available_from. fn_schedule_trivia_miss schedules `trivia-miss-{id[:8]}` cron at available_until. trg_schedule_trivia_miss AFTER INSERT auto-schedules for new questions. Backfill: 42 currently-future questions scheduled (2 test + 40 tournament Jun 11–Jul 20). |
| 103 | 20260521000103_dashboard_payload.sql | `get_dashboard_payload()` RPC: one JSONB return consolidates 13 Dashboard queries into 1. Plain SQL (no SECURITY DEFINER), runs as caller — RLS unchanged. Returns groups, leaderboard, group_ranks (LATERAL get_group_leaderboard), champion_picks, top_scorer_picks, predictions, finished_games (limit 150, ≥ 2026-04-11), team_stats, team_recent_games, day_games, day_date, day_preds. Frontend: Dashboard.jsx replaced 7 useEffects with 1 RPC call. |
| 104 | 20260521000104_push_subscriptions_cleanup.sql | Push subs cleanup: `fn_cleanup_push_subscriptions()` keeps latest 2 rows per user_id (primary + rotation-transition backup). One-time backfill pruned Dani 7→2. Daily cron `cleanup-push-subs-daily` at 03:00 UTC. Pairs with send-push v8 TTL:60 — together prune stale APNS tokens that Apple rotates silently every 1-2 weeks. |
| 105 | 20260522000105_prediction_edit_log.sql | `prediction_edit_log` table (append-only, RLS on, no anon/auth SELECT) + `trg_log_prediction_edit` AFTER INSERT/UPDATE on predictions → logs every MANUAL prediction value change (is_initial flag; ignores score-sync updated_at bumps via IS DISTINCT FROM check). `fn_daily_admin_digest` prediction block repointed at the log: pred_total=new submissions, pred_edits=every edit action (same-day + multiple-per-prediction now counted; old cross-day heuristic only counted ≤1 cross-day edit). notify-admin EF unchanged (same JSON keys). |
| 106 | 20260522000106_pick_edit_log.sql | Same as M105 for picks. Generic `pick_edit_log` table (pick_type 'champion'|'top_scorer', value text, RLS on) + `trg_log_champion_pick_edit` (logs team changes) + `trg_log_top_scorer_pick_edit` (logs player_name changes). `fn_daily_admin_digest` champ + scorer blocks repointed at pick_edit_log: champ/scorer total=new, edits=every change. Only meaningful until June 11 pick deadline (locked after). notify-admin EF unchanged. |
| 107 | 20260524000107_fn_reschedule_game.sql | EF-audit fix #2. `fn_reschedule_game(p_game_id)` (SECURITY DEFINER) re-schedules `auto-predict-{id}` (mirrors fn_schedule_auto_predictions, single game) + `ko-notif-{id}` (via fn_schedule_ko_notification) onto the new kick_off_time. Called by football-api-sync v35 `verify` when KO moves >5min — verify already re-ran fn_schedule_game_sync but left these two crons on the old time. Idempotent (cron.schedule upserts by jobname); own EXCEPTION→WARNING so it never aborts verify. |
| 108 | 20260524000108_scheduler_vault_inline.sql | EF-audit fix #25 (security). `fn_schedule_ai_summaries` + `fn_schedule_af_odds_sync`: stop baking the service-role JWT into `cron.job.command`; use inline `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_service_role_key')` at fire time (the fn_schedule_game_sync pattern). ONLY the key injection changed — 150-min delay, jsonb body (no ::text), per-group loop, jobname format, +160min push job all preserved. Migration re-runs both fns to regenerate future jobs. Follow-up: 96 dead past-date `ai-summary-%` jobs (with baked keys, never fire) unscheduled → **0 baked JWTs remain in cron.job** (272 ai-summary + af-odds now inline). |
| 109 | 20260524000109_fn_notify_trivia_guard.sql | EF-audit fix (trivia push bug). `fn_notify_trivia()` wrapped in `IF EXISTS (SELECT 1 FROM trivia_questions WHERE available_from <= now() AND available_until > now())`. Before: `trivia-push-daily` (0 19 * * *, no end) POSTed "Trivia Time!" every night unconditionally → endless spam after 2026-07-21 + gap-day false pushes. Now a no-op when nothing is open; data-driven so test questions still fire. Verified: open_now=0 → fn_notify_trivia() queued 0 pushes. net.http_post body/title/url unchanged. |
| 110 | 20260525000110_ai_summary_matchday_boundary.sql | AI-summary "match-day" boundary 00:00 UTC → **07:30 UTC** (10:30 Israel). `fn_schedule_ai_summaries` groups by `(kick_off_time - interval '7.5 hours')::date` so a US match-night (afternoon → 04:00 UTC late games) stays in ONE summary instead of splitting at 03:00 Israel. Verified: 05:00–13:00 UTC has ZERO fixtures; latest knockout KO=03:00 UTC, latest group KO=04:00 UTC. ONLY the grouping key changed — MAX(kick_off) + 150/160 fire/push delays unchanged (90-min score is written during ET at KO+120, so ET/pens never delay the summary). Must pair with nightly-summary EF day-window (07:30) + M111. Not re-run (new grouping applies on next scheduler run / WC setup). |
| 111 | 20260525000111_digest_matchday_boundary.sql | `fn_daily_admin_digest`: align to the 07:30 match-day. (a) window starts 07:30 UTC (was 00:00); (b) summaries/tokens counted by `ai_summaries.date` (was `generated_at`) — fixes "game shown but 0 summaries/0 tokens" (summary generated 00:00 UTC next day fell outside the old window). Run time 08:00 UTC + v_yesterday calc unchanged. Verified via manual trigger 2026-05-25 18:01 UTC: digest for 2026-05-24 = 1 game + 8 summaries + 44,915/1,932 tokens together (email sent OK). |
| 112 | 20260525000112_dashboard_matchday_boundary.sql | `get_dashboard_payload`: align Dashboard "today's games" to the 07:30-UTC match-day (matches M110/M111). Was 00:00 UTC cut → a US match-night straddling midnight split, so users could MISS predicting the late games. 5 day-grouping date expressions → `((kick_off_time AT TIME ZONE 'UTC') - interval '7.5 hours')::date` (TZ-independent; DB tz=UTC). Everything else (leaderboard/picks/predictions/finished_games/RLS) untouched — read-only STABLE RPC, dashboard-only. Verified: Haiti–Scotland 01:00 UTC Jun 14 now groups into Jun 13 night; live RPC day_date=2026-06-11 with 2 games (opener + late 02:00 game) + leaderboard 40 rows intact. No frontend change. |
| 113 | 20260527000113_group_summary_matchday_boundary.sql | `get_group_summary_data`: align to the 07:30-UTC match-day (**5th and final place** — this builds the AI-summary LLM payload). It still used `g.kick_off_time::date = p_date` (00:00 cut), so for a midnight-straddling match-night the roast covered only the games whose UTC calendar date == p_date (e.g. 26/5 summary had Sao Paulo but dropped Estudiantes at 00:30 UTC 27/5) — even though the EF window saw both. Fixed 2 date exprs (games list + per-member predictions) → `((g.kick_off_time AT TIME ZONE 'UTC') - interval '7.5 hours')::date = p_date`. Sweep confirmed it was the ONLY fn left on the 00:00 cut. Verified: re-ran 26/5 summary for all 8 groups → payload now has 2 games (Sao Paulo + Estudiantes). |
| 114 | 20260528000114_backfill_ai_summary_global_ranks.sql | One-time backfill: rewrites `ai_summaries.display_data.global_ranks` AND `input_json.leaderboard[].global_rank` for **every existing row** from the canonical `get_leaderboard()`. Fixes historical rank values that were wrong due to the JS 1000-row cap bug (root cause + permanent fix shipped in nightly-summary EF v35 — RPC replaces JS recompute). Roast TEXT untouched. Idempotent. Verified: Test3/2026-05-27 went from stored Itay=1/zac=14/bob=16 → live 2/15/20 ✓. |
| 115 | 20260530000115_top_scorer_candidates_add_position_and_apiid_unique.sql | top_scorer_candidates schema update for bulk seed (both dev + prod): ADD COLUMN position (nullable, stores api-football Attacker/Midfielder/Defender/Goalkeeper). DROP CONSTRAINT name UNIQUE (1383 WC2026 players have 11 name collisions). ADD CONSTRAINT api_player_id UNIQUE (natural key, NOT NULL since M51). Pairs with football-api-sync v4 (setup_lineups onConflict→api_player_id) + supabase/migrations-prod/20260530000002 (prod-only reseed with all 1383 players + position). |
| 116 | 20260530000116_ai_summary_schedule_daily_safety_cron.sql | Daily safety cron `ai-summary-schedule-daily` @ **14:00 UTC = 17:00 Israel**. Empirically confirmed gap: `fn_schedule_ai_summaries` only fires on game INSERT (via trg_auto_schedule_game), but groups + group_members have NO trigger. INSERTing a group + 3 members creates 0 ai-summary crons → group-stage AI summaries permanently lost for groups formed after all games inserted. 14:00 UTC fires BEFORE earliest WC group-stage KO (16:00 UTC = 19:00 Israel) → user rule: group created **before 17:00 Israel** gets same-day roast; **after 17:00** gets next day onwards. Applied to both dev + prod. Idempotent. |
| 117 | 20260530000117_fix_player_tournament_stats_security_invoker.sql | Closes last dev↔prod parity gap from 2026-05-30 audit. M97 had fixed only `team_tournament_stats`; `player_tournament_stats` was fixed dashboard-direct on dev (no migration file) → prod pg_dump captured the pre-fix state. M117 recreates the view `WITH (security_invoker = true)`. Body is verbatim from `pg_get_viewdef` on dev — zero new SQL. Applied to BOTH dev (formally tracked now) + prod via `apply_migration`. Idempotent (DROP IF EXISTS + CREATE). Closes Supabase advisor `security_definer_view` ERROR on prod. |
| 118 | 20260530000118_fix_judge_scores_and_feedback_readable_security_invoker.sql | Same fix for the last 2 SECURITY DEFINER views (Supabase dashboard "UNRESTRICTED" badge). M95/M96 had revoked SELECT from anon+authenticated but did NOT add `security_invoker=true` → views still ran as creator. M118 recreates both `ai_judge_scores` + `feedback_readable` WITH `security_invoker = true` (verbatim view bodies from `pg_get_viewdef`), then re-applies the M95/M96 SELECT revoke. After this: all 4 public-schema views are `security_invoker=true`; zero `security_definer_view` advisor errors on either env; UNRESTRICTED badge clears in Studio. Applied to BOTH dev + prod via `apply_migration`. |
| 119 | 20260530000119_prompt_versions_active_partial_unique_index.sql | Adds `prompt_versions_active_idx` (partial UNIQUE on `is_active` WHERE `is_active=true`) to prod. Gap found in 3rd-pass parity re-audit (2026-05-30): dev had it, prod did not (origin: dashboard/pre-tracking). Enforces "at most one active prompt at any time" — protects nightly-summary EF fallback `.eq('is_active',true).single()`. `IF NOT EXISTS` idempotent; dev was a no-op, prod actually created the index. Applied via `apply_migration` to both envs (formal tracking). |
| 120 (PROD ONLY) | **migrations-prod/**20260530000120_seed_prompt_versions.sql | Seeds prod's empty `prompt_versions` table with the 5 runtime-essential rows copied verbatim from dev: `v10` (baseline, is_active=true — judge-fail fallback + legacy single-prompt fallback), `v11-main-2` (main), `v12-picks-2` (candidate_2), `v13-unique-2` (candidate_3), `v10B` (candidate_4). Generated via Postgres `format(%L)` on dev → SQL-safe escaping guaranteed. Other 14 dev rows (3 older v*-2 ancestors + 11 historical no-slot R&D archive) intentionally NOT copied — never selected at runtime. Without this row set, `nightly-summary` EF returns `no_active_prompt` and no roasts generate. `ON CONFLICT (version_tag) DO UPDATE` idempotent. PROD-ONLY because dev already has these 5 (plus the 14-row archive). Applied via 5 sequential `execute_sql` INSERTs (file too large for single tool call). |

## Edge Functions

| Function | Version | Status | Notes |
|---|---|---|---|
| football-api-sync | **v36** (dev) / **v4** (prod, see note) | ✅ ACTIVE | Modes: probe, probe_date, probe_ns, verify, sync, sync_stats, sync_af_odds, setup, setup_lineups, snap_stats, probe_stats, probe_odds, **bootstrap_squads** (PROD ONLY — added 2026-05-30 for prod seed). Full mode reference: `supabase/functions/football-api-sync/README.md`. **PROD v4 (2026-05-30):** setup_lineups `onConflict: 'name'` → `'api_player_id'` + adds `position: 'Attacker'` on new forward inserts (pairs with M115 schema change). **PROD v3 (2026-05-30):** added `bootstrap_squads` — one-time mode that pulls all 48 WC2026 teams + 1383 players from api-football (`/teams?league=1&season=2026` + `/players/squads?team=X` × 48). Returns raw JSON; SQL-driven seed reads from `net._http_response`. Used for prod seed (see `supabase/migrations-prod/20260530000001` + `20260530000002`). **NOT deployed to dev** — dev still has v36 baseline (without bootstrap_squads). Dev keeps its 27 M45 stars unless we deploy this function to dev too. **v36 (2026-05-28):** defensive `.range(0, 99999)` on `handleSetup` (games — all rows) + `handleSyncStats` (games — finished, no upper bound) to bypass Supabase JS-client 1000-row default cap as data grows season-to-season. No behavior change today. **v35 (2026-05-24, EF-audit fixes #5/#3/#2):** local source now == deployed (probe_date/probe_ns folded into local — no more drift); `sync` terminal-status handler (PST/SUSP/ABD/CANC/AWD/WO/INT → unschedule + reportEfError, no infinite +5min loop) + KO+6h hard-stop safety net; `verify` >5min KO change also calls `fn_reschedule_game` (M107). |
| nightly-summary | **v35** (was v34) | ✅ ACTIVE | Single-group mode: accepts group_id in body, skips loop. Per-group cron architecture (M73). **v35 (2026-05-28, rank bug fix):** Global rank no longer re-implemented in JS — pulled from canonical `get_leaderboard()` RPC. Eliminates Supabase JS-client 1000-row cap (which silently truncated `predictions` at 1934 scored rows → ranks went wrong, e.g. Test3 stored Itay=1 vs true 2). Also removes the duplicate leaderboard formula (drift hazard). Defensive `.range(0,99999)` on remaining JS-driver queries (`games` match-day, `groups`, `predictions` by game_id IN). **v34 (2026-05-25):** day-window for "that day's games" shifted **00:00 → 07:30 UTC** (`dayStart/dayEnd`, lines ~576–579) to match the M110 match-day boundary. **v33 (2026-05-24, EF-audit fix):** hard group failure logs `ef_errors('group_failed')`; judge-fail fallback ships **agent 4 = baseline (v10-baseline)**. |
| sync-odds | **v23** (was v19) | ✅ ACTIVE | Champion odds via TheOddsAPI William Hill. Audited 2026-05-23: deployed == local. External cron-job.org 07:00 UTC trigger (not pg_cron). |
| notify-admin | **v12** (was v9) | ✅ ACTIVE | predictions total·edits·users·games·groups from DB; champion+top scorer picks total·edits·users·groups; M84–M90. Audited 2026-05-23: deployed == local. ⚠️ FROM_ADDRESS still `onboarding@resend.dev` (Resend sandbox). |
| send-push | **v9** (was v8) | ✅ ACTIVE | **v9 (2026-05-24, EF-audit fix #19):** non-410/404 failures + whole-batch catch now log `ef_errors('push-send')` → admin email + digest (a total push outage is no longer silent). Send logic, TTL:60, urgency:high, allSettled, 410/404 pruning all unchanged. v8 (2026-05-21): **`urgency:'high'` + `TTL:60` + Promise.allSettled parallel sends**. Fixes iOS PWA silent overnight drops (APNS deprioritizes low-urgency pushes on locked devices) + dead-endpoint pruning (Apple rotates PWA tokens silently every 1-2 weeks without 410 unless TTL is short). Bulk-deletes 410/404 subs at end. v7: default URL `/2026-World-Cup-Social-Predicting-App/` prefix. v6: icon-notif+badge ?v=3. Web Push via npm:web-push; VAPID private key from vault `Notification_Key`. |

## Key pg_cron Jobs

| Job | Schedule | Purpose |
|---|---|---|
| af-odds-daily | 07:15 UTC daily | API Football odds for upcoming games |
| trivia-push-daily | 0 19 * * * UTC | Push notification: trivia question now open (22:00 Israel time) |
| trivia-miss-{question_id[:8]} | at each question's available_until | Auto-insert miss row for users who didn't answer (M102) |
| ko-notif-{game_id} | KO-15min | Push notification: kickoff soon (102 crons backfilled 2026-05-17) |
| admin-daily-digest | 08:00 UTC daily | Admin email digest |
| auto-assign-picks | 19:00 Jun 11 2026 | Auto-assign champion + top scorer at deadline |
| auto-predict-{game_id} | at each game's KO | fn_auto_predict_game for users who didn't submit |
| verify-game-{game_id} | KO-30min | Verify API kick-off time matches DB |
| sync-game-{game_id} | KO+120min | Write score + stats (football-api-sync mode=sync) |
| ai-summary-{date}-{group_id[:8]} | last_KO+150min | Nightly AI summary — one job per qualifying group per date (M73, timing fixed M83) |
| ai-summary-push-{date} | last_KO+160min | Consolidated AI summary push — one push per user (DISTINCT across all groups) (M101) |
| cleanup-push-subs-daily | 03:00 UTC daily | Prune push_subscriptions to latest 2 per user — fights APNS silent token rotation (M104) |
| ai-summary-schedule-daily | **14:00 UTC daily (17:00 Israel)** | Safety: runs fn_schedule_ai_summaries to catch any new qualifying groups (≥3 members). Closes the gap that groups + group_members have no trigger; fn only fires on game INSERT otherwise. Fires BEFORE earliest WC group-stage KO (16:00 UTC) → groups created before 17:00 Israel get same-day roast. (M116) |

## Auto-Scheduling (M68 — 2026-05-04)

`trg_auto_schedule_game` fires AFTER INSERT on games and automatically calls all scheduling functions. No manual step required when adding games.

**Exception**: if a game is inserted with `api_fixture_id = NULL` (e.g. knockout matchup known before API mapping), `fn_schedule_game_sync` is skipped. Call it manually after running `football-api-sync mode=setup`.

### Knockout insertion = Option C (per-round, not TBD up-front)

**Decision 2026-05-30:** Knockout games are inserted ONLY when their matchup is confirmed, with real `team_home`/`team_away`/`api_fixture_id` all set in the same INSERT. Do NOT pre-seed 32 `'TBD' vs 'TBD'` rows.

**Why:** trg_auto_schedule_game bakes team names into the `ko-notif-{id}` cron command string at INSERT time. A TBD row creates a stale "TBD vs TBD" push cron. There is NO trigger on UPDATE of `team_home/team_away/api_fixture_id`, so updating a TBD row later does NOT refresh the cron — would require manual `fn_reschedule_game(id)` + `fn_schedule_game_sync(id)` per game.

**Insert early!** Don't wait for the previous round to officially end — insert each KO row the moment its TWO teams are mathematically confirmed (often before the last group game of MD3). Group→R32 and R32→R16 gaps are <24h, so early insertion is critical.

**Backup plan (Option A — not yet implemented):** if Option C becomes operationally painful, add an UPDATE trigger that auto-calls `fn_reschedule_game` + `fn_schedule_game_sync` on team/api_fixture_id changes. Full snippet in `memory/feedback_knockout_insert_strategy.md`. Apply via its own migration and to both dev + prod simultaneously.

## Vault Secrets

| Name | Purpose |
|---|---|
| app_edge_function_url | Base URL for EF calls from pg_cron |
| app_service_role_key | Service role key for EF auth from pg_cron |
| FOOTBALL_API_KEY | (EF secret) api-football.com |
| AI_Summary_GPT_Key | (EF secret) OpenAI key for nightly-summary |
| theoddsapi | (EF secret) TheOddsAPI key for champion odds |

## Pending

- Verify custom Resend domain — currently sending from onboarding@resend.dev (may go to spam). Update FROM_ADDRESS in notify-admin EF once domain verified.
- Clean up test data: "The Legends" group + test games/fake scores.
- **[GO-LIVE] Guard `fn_notify_trivia()`** — the `trivia-push-daily` cron (jobid 17327, `0 19 * * *`, always active, no end date) sends the "🧠 Trivia Time!" push every night **with no question check**. Questions only exist Jun 11–Jul 20, so it pushes to an empty page before launch AND forever after Jul 20. Keep as-is during EF testing; before go-live add a live-question guard (`IF NOT EXISTS (SELECT 1 FROM trivia_questions WHERE available_from <= now() AND available_until > now()) THEN RETURN; END IF;`) at the top of the function — self-stops after the last question, leave the cron active. Full snippet in memory `trivia-feature.md`.
- **[GO-LIVE] Delete test trivia questions** — 6 `[TEST]` rows (question_date 2026-05-18 … 2026-05-23) plus the older 2026-05-12 test question must be deleted before launch.
- ✅ PR #1 merged (2026-05-05) — feature/judge-llm fully merged into main.
