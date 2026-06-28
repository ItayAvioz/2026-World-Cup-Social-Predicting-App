-- ================================================================
-- Migration 130: Lock client-writable columns (points_earned exploit fix)
-- ================================================================
-- ROOT CAUSE: Supabase's default `GRANT ALL ... TO anon, authenticated`
-- gave every client TABLE-WIDE INSERT/UPDATE/DELETE on every table, with
-- no column restriction. RLS only guards WHICH ROWS a user may touch, not
-- WHICH COLUMNS. So a logged-in user could PATCH their own prediction row's
-- server-owned `points_earned` directly via the REST API and award themself
-- points (observed: Yovich set points_earned=3 on an unplayed game).
--
-- FIX: revoke the blanket write grants on the 9 client-writable tables, then
-- re-grant only the SAFE columns the app actually writes. Scoring columns
-- (points_earned, is_auto) become server-only. RLS policies are UNCHANGED.
-- Server-side writers are unaffected: all write RPCs are SECURITY DEFINER
-- (create_group/create_profile/join_group/delete_account/submit_trivia_answer),
-- the scoring triggers (fn_calculate_points/fn_calculate_pick_points) run as
-- owner, and Edge Functions use service_role (bypasses these grants + RLS).
--
-- Verified against live frontend payloads (every write sends only granted
-- columns) and live schema. Applied to BOTH dev + prod. Idempotent.
-- anon scope = these 9 tables only (tight blast radius); the remaining tables
-- are already write-denied by absent anon RLS policies. Global anon hardening
-- deferred to a separate follow-up.
-- ================================================================

-- ---- anon: no writes on any of the 9 client-writable tables ----
REVOKE INSERT, UPDATE, DELETE ON
  public.predictions, public.champion_pick, public.top_scorer_pick,
  public.groups, public.group_members, public.profiles,
  public.feedback, public.app_events, public.push_subscriptions
FROM anon;

-- ---- authenticated: drop table-wide write, re-grant safe columns ----
REVOKE INSERT, UPDATE, DELETE ON
  public.predictions, public.champion_pick, public.top_scorer_pick,
  public.groups, public.group_members, public.profiles,
  public.feedback, public.app_events, public.push_subscriptions
FROM authenticated;

-- predictions — only predicted score + identity keys.
-- Blocks points_earned, is_auto (server-owned). UPDATE list mirrors INSERT
-- because the app's upsert (onConflict user_id,game_id,group_id) issues
-- ON CONFLICT DO UPDATE SET on every payload column.
GRANT INSERT (user_id, game_id, group_id, pred_home, pred_away) ON public.predictions TO authenticated;
GRANT UPDATE (user_id, game_id, group_id, pred_home, pred_away) ON public.predictions TO authenticated;

-- champion_pick — team only (blocks points_earned, is_auto)
GRANT INSERT (user_id, group_id, team) ON public.champion_pick TO authenticated;
GRANT UPDATE (user_id, group_id, team) ON public.champion_pick TO authenticated;

-- top_scorer_pick — player only (blocks points_earned, is_auto)
GRANT INSERT (user_id, group_id, player_name, top_scorer_api_id) ON public.top_scorer_pick TO authenticated;
GRANT UPDATE (user_id, group_id, player_name, top_scorer_api_id) ON public.top_scorer_pick TO authenticated;

-- groups — rename only (creation via create_group SECURITY DEFINER RPC).
-- Protects invite_code, created_by, id.
GRANT UPDATE (name) ON public.groups TO authenticated;

-- group_members — captain inactive-flag only (join via join_group RPC).
GRANT UPDATE (is_inactive) ON public.group_members TO authenticated;

-- profiles — username only (creation via create_profile RPC).
GRANT UPDATE (username) ON public.profiles TO authenticated;

-- feedback — insert only.
GRANT INSERT (user_id, category, priority, message, screenshot_url) ON public.feedback TO authenticated;

-- app_events — insert only.
GRANT INSERT (user_id, event_type, page, session_id) ON public.app_events TO authenticated;

-- push_subscriptions — own-row lifecycle (RLS ALL policy); safe columns + DELETE.
GRANT INSERT (user_id, endpoint, p256dh, auth) ON public.push_subscriptions TO authenticated;
GRANT UPDATE (user_id, endpoint, p256dh, auth) ON public.push_subscriptions TO authenticated;
GRANT DELETE ON public.push_subscriptions TO authenticated;
