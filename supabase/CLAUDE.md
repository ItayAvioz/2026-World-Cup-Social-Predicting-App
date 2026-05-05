# Supabase — Deployed State

## Migrations (68 deployed)

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
| 59 | 20260422000059_revert_fn_schedule_ai_summaries.sql | revert fn_schedule_ai_summaries to correct version |
| 60 | 20260503000060_feedback.sql | feedback table + RLS + storage bucket |
| 61 | 20260504000061_admin_notifications.sql | ef_errors + app_events + fn_notify_admin + digest cron + notify-admin EF trigger |
| 62 | (MCP) judge_test_anon_access | anon access for judge LLM test |
| 63 | (MCP) prompt_fixes_v2 | v11/v12/v13 prompt patches |
| 64 | (MCP) revert_prompt_fixes_v2 | revert prompt patches |
| 65 | (MCP) agent_slot + ai_judge_runs | judge LLM schema: agent_slot, ai_judge_runs, ai_summaries judge cols, v11/v12/v13 prompts |
| 66 | (MCP) baseline_slot | baseline slot + v10→baseline + winner_agent 1–4 |
| 67 | (MCP) candidate_4_slot | candidate_4 slot + winner_agent 1–5 + v10B/v11-main-2/v12-picks-2/v13-unique-2 prompts |
| 68 | 20260504000068_auto_schedule_on_game_insert.sql | trg_auto_schedule_game: AFTER INSERT on games auto-schedules all crons |
| 69 | 20260505000069_ai_summaries_winner_score.sql | ai_summaries.winner_score + version_tag backfilled into ai_judge_runs.candidates |
| 70 | 20260505000070_ai_judge_scores_view.sql | ai_judge_scores view: one row per agent per run (group_name, date, slot, version_tag, scores, is_winner) |

## Edge Functions

| Function | Version | Status | Notes |
|---|---|---|---|
| football-api-sync | v29 | ✅ ACTIVE | Modes: probe, verify, sync, sync_stats, sync_af_odds, setup, setup_lineups, snap_stats, probe_stats, probe_odds |
| nightly-summary | v23 (Supabase v27) | ✅ ACTIVE | 5-agent parallel + gpt-4o judge; candidates include version_tag; ai_summaries includes winner_score |
| sync-odds | v19 | ✅ ACTIVE | Champion odds via TheOddsAPI William Hill |
| notify-admin | v3 | ✅ ACTIVE | Resend gateway, 5 alert types + daily digest |

## Key pg_cron Jobs

| Job | Schedule | Purpose |
|---|---|---|
| af-odds-daily | 07:15 UTC daily | API Football odds for upcoming games |
| admin-daily-digest | 08:00 UTC daily | Admin email digest |
| auto-assign-picks | 19:00 Jun 11 2026 | Auto-assign champion + top scorer at deadline |
| auto-predict-{game_id} | at each game's KO | fn_auto_predict_game for users who didn't submit |
| verify-game-{game_id} | KO-30min | Verify API kick-off time matches DB |
| sync-game-{game_id} | KO+120min | Write score + stats (football-api-sync mode=sync) |
| ai-summary-{date} | last_KO+150min | Nightly AI summary per group |

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
- Merge PR #1 (Judge LLM feature/judge-llm branch).
