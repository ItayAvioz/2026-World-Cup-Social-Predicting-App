-- M135 — Fix final-scoring trigger failing under the `safeupdate` guard.
--
-- BUG: fn_calculate_pick_points() fires AFTER UPDATE OF knockout_winner on a phase='final'
-- game and resets everyone's pick points with two "zero everyone" UPDATEs that have NO WHERE
-- clause. The PostgREST/EF session connects as the `authenticator` role, which has
-- `session_preload_libraries=safeupdate` → any UPDATE/DELETE without a WHERE raises
-- "UPDATE requires a WHERE clause". So when football-api-sync sets the final's knockout_winner,
-- the trigger aborts and the WHOLE final sync rolls back — no score, no winner, and no
-- champion (10pt) / top-scorer (10pt) points are ever written.
--
-- Reproduced live on DEV via the real EF path:
--   before fix → HTTP 500 "DB update failed: UPDATE requires a WHERE clause" (winner stayed null)
--   after fix  → HTTP 200 {status:done, api_status:PEN}; knockout_winner written;
--                champion: 1 Argentina picker → 10, others → 0; top-scorer: 2 tied → 10, others → 0.
--
-- FIX: add an always-true `WHERE true` to the two zero-all resets so the guard is satisfied.
-- Behaviour is identical (still zeroes all rows). Body otherwise VERBATIM from the live
-- function (dumped via pg_get_functiondef first, per the "never CREATE OR REPLACE blindly" rule).
--
-- Applied to BOTH envs via apply_migration: DEV 20260624205202, PROD 20260624211229.
-- Final-only impact (phase='final' branch); group/R32/R16/QF/SF scoring never enters this path.

CREATE OR REPLACE FUNCTION public.fn_calculate_pick_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_max_goals      bigint;
  v_top_scorer_ids int[];
BEGIN
  IF NEW.phase = 'final'
     AND NEW.knockout_winner IS NOT NULL
     AND (OLD.knockout_winner IS NULL OR OLD.knockout_winner != NEW.knockout_winner)
  THEN
    UPDATE public.champion_pick SET points_earned = 0 WHERE true;
    UPDATE public.champion_pick SET points_earned = 10
    WHERE team = NEW.knockout_winner;

    SELECT MAX(total_goals) INTO v_max_goals
    FROM public.player_tournament_stats;

    IF v_max_goals IS NOT NULL AND v_max_goals > 0 THEN
      SELECT ARRAY_AGG(api_player_id) INTO v_top_scorer_ids
      FROM public.player_tournament_stats
      WHERE total_goals = v_max_goals;

      UPDATE public.top_scorer_pick SET points_earned = 0 WHERE true;
      UPDATE public.top_scorer_pick SET points_earned = 10
      WHERE top_scorer_api_id = ANY(v_top_scorer_ids);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
