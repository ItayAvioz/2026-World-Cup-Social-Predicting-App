# Supabase — Deployed State

## Migrations (95 local + 3 MCP-only — all deployed)

> **Tracking note**: M1–M26 applied before Supabase migration tracking began. M39–M45, M52 applied via Supabase dashboard (deployed, not in schema_migrations). All others tracked in DB. Stub files = comment-only, no SQL (applied via MCP without local file at the time).

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
| 103 | 103_dashboard_payload.sql | `get_dashboard_payload()` RPC: one JSONB return consolidates 13 Dashboard queries into 1. Plain SQL (no SECURITY DEFINER), runs as caller — RLS unchanged. Returns groups, leaderboard, group_ranks (LATERAL get_group_leaderboard), champion_picks, top_scorer_picks, predictions, finished_games (limit 150, ≥ 2026-04-11), team_stats, team_recent_games, day_games, day_date, day_preds. Frontend: Dashboard.jsx replaced 7 useEffects with 1 RPC call. |
| 104 | 20260521000104_push_subscriptions_cleanup.sql | Push subs cleanup: `fn_cleanup_push_subscriptions()` keeps latest 2 rows per user_id (primary + rotation-transition backup). One-time backfill pruned Dani 7→2. Daily cron `cleanup-push-subs-daily` at 03:00 UTC. Pairs with send-push v8 TTL:60 — together prune stale APNS tokens that Apple rotates silently every 1-2 weeks. |
| 105 | 20260522000105_prediction_edit_log.sql | `prediction_edit_log` table (append-only, RLS on, no anon/auth SELECT) + `trg_log_prediction_edit` AFTER INSERT/UPDATE on predictions → logs every MANUAL prediction value change (is_initial flag; ignores score-sync updated_at bumps via IS DISTINCT FROM check). `fn_daily_admin_digest` prediction block repointed at the log: pred_total=new submissions, pred_edits=every edit action (same-day + multiple-per-prediction now counted; old cross-day heuristic only counted ≤1 cross-day edit). Champion/top-scorer picks still use old heuristic. notify-admin EF unchanged (same JSON keys). |

## Edge Functions

| Function | Version | Status | Notes |
|---|---|---|---|
| football-api-sync | v29 | ✅ ACTIVE | Modes: probe, verify, sync, sync_stats, sync_af_odds, setup, setup_lineups, snap_stats, probe_stats, probe_odds |
| nightly-summary | v25 (Supabase v29) | ✅ ACTIVE | Single-group mode: accepts group_id in body, skips loop. Per-group cron architecture (M73). |
| sync-odds | v19 | ✅ ACTIVE | Champion odds via TheOddsAPI William Hill |
| notify-admin | v9 | ✅ ACTIVE | v9: predictions total·edits·users·games·groups from DB; champion+top scorer picks total·edits·users·groups; M84–M90 |
| send-push | v8 | ✅ ACTIVE | v8 (2026-05-21): **`urgency:'high'` + `TTL:60` + Promise.allSettled parallel sends**. Fixes iOS PWA silent overnight drops (APNS deprioritizes low-urgency pushes on locked devices) + dead-endpoint pruning (Apple rotates PWA tokens silently every 1-2 weeks without 410 unless TTL is short). Bulk-deletes 410/404 subs at end. v7: default URL `/2026-World-Cup-Social-Predicting-App/` prefix. v6: icon-notif+badge ?v=3. Web Push via npm:web-push; VAPID private key from vault `Notification_Key`. |

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

## Auto-Scheduling (M68 — 2026-05-04)

`trg_auto_schedule_game` fires AFTER INSERT on games and automatically calls all scheduling functions. No manual step required when adding games.

**Exception**: if a game is inserted with `api_fixture_id = NULL` (e.g. knockout matchup known before API mapping), `fn_schedule_game_sync` is skipped. Call it manually after running `football-api-sync mode=setup`.

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
- ✅ PR #1 merged (2026-05-05) — feature/judge-llm fully merged into main.
