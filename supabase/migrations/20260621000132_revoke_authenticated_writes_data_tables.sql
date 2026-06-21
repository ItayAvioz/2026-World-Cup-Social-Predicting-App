-- ================================================================
-- Migration 132: Lock read-only data tables from `authenticated` writes
-- ================================================================
-- Final hardening after M130 (column locks on client tables) + M131 (global
-- anon write revoke). The 18 tables below are NEVER written directly by the
-- app/client — they are populated by Edge Functions (service_role) or by
-- SECURITY DEFINER RPCs/triggers. They still carried Supabase's default
-- `GRANT INSERT/UPDATE/DELETE TO authenticated`, blocked today ONLY by RLS
-- (no write policy). Removing the grant gives a SECOND independent lock so a
-- future RLS misconfig can't let a logged-in user rewrite scores/stats/odds
-- and corrupt the leaderboard.
--
-- SAFE — verified:
--   * Frontend writes ONLY the 9 client tables (predictions, *_pick, groups,
--     group_members, profiles, feedback, app_events, push_subscriptions) —
--     those keep their M130 grants and are NOT touched here.
--   * Edge Functions write these via service_role (bypasses these grants+RLS).
--   * Triggers that write during a client action are SECURITY DEFINER and run
--     as owner: fn_log_prediction_edit / fn_log_champion_pick_edit /
--     fn_log_top_scorer_pick_edit (→ *_edit_log), fn_creator_joins_group, etc.
--     So revoking authenticated INSERT on the *_edit_log tables does NOT break
--     prediction/pick editing.
--   * submit_trivia_answer (DEFINER RPC) writes trivia_answers as owner.
--   * SELECT is PRESERVED (app reads games/stats/teams/candidates/etc.).
--
-- After this, these 18 tables are writable ONLY by service_role (+ owner).
-- Applied to BOTH dev + prod. Idempotent. SELECT + authenticated grants on the
-- 9 client tables untouched. No ALTER DEFAULT PRIVILEGES for authenticated
-- (future client-writable tables legitimately need authenticated writes).
-- ================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.games,
  public.game_team_stats,
  public.game_player_stats,
  public.game_events,
  public.game_odds,
  public.champion_odds,
  public.teams,
  public.top_scorer_candidates,
  public.ai_summaries,
  public.ai_judge_runs,
  public.ef_errors,
  public.failed_summaries,
  public.prediction_edit_log,
  public.pick_edit_log,
  public.prompt_versions,
  public.trivia_questions,
  public.trivia_secrets,
  public.trivia_answers
FROM authenticated;
