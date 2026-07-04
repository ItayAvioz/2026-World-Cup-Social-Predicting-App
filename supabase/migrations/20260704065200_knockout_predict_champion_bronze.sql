-- Knockout bracket predict — add two single-team WINNER picks on top of the
-- existing "team reaches a round" model:
--   * champion      = correct Final winner        → +10 pts
--   * third_winner  = correct 3rd-place-play-off winner → +5 pts
-- Also moves the entry lock from 15:00Z (18:00 Israel) to 17:00Z (20:00 Israel).
-- Applied to DEV (ftryuvfdihmhlzvbpfeu) + PROD (asugxlvgcmkxspzokydk) 2026-07-04.
-- fn_knockout_points is called by both leaderboard RPCs, so the new points fold
-- into the leaderboard from the same 2026-07-20 gate — no leaderboard-RPC change.

-- 1) Allow the two new pick rounds
ALTER TABLE public.knockout_pick DROP CONSTRAINT knockout_pick_round_check;
ALTER TABLE public.knockout_pick ADD CONSTRAINT knockout_pick_round_check
  CHECK (round = ANY (ARRAY['qf','sf','final','third','champion','third_winner']));

-- 2) Replace save RPC: new lock 17:00Z + champion/third_winner params.
--    Drop old 4-arg to avoid overload ambiguity; the two new params default to
--    '{}' so a stale 4-arg client call still works during the SW rollout.
DROP FUNCTION IF EXISTS public.save_knockout_picks(text[],text[],text[],text[]);

CREATE OR REPLACE FUNCTION public.save_knockout_picks(
  p_qf text[], p_sf text[], p_final text[], p_third text[],
  p_champion text[] DEFAULT '{}', p_third_winner text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  -- Entries close: Jul 4 20:00 Israel (IDT, UTC+3) = 17:00 UTC.
  v_lock constant timestamptz := '2026-07-04T17:00:00Z';
  v_bad  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF now() >= v_lock THEN
    RAISE EXCEPTION 'predictions_locked';
  END IF;

  IF COALESCE(array_length(p_qf,1),0)           > 8
  OR COALESCE(array_length(p_sf,1),0)           > 4
  OR COALESCE(array_length(p_final,1),0)        > 2
  OR COALESCE(array_length(p_third,1),0)        > 2
  OR COALESCE(array_length(p_champion,1),0)     > 1
  OR COALESCE(array_length(p_third_winner,1),0) > 1 THEN
    RAISE EXCEPTION 'invalid_pick' USING HINT = 'too many teams for a round';
  END IF;

  SELECT t INTO v_bad
  FROM unnest(p_qf || p_sf || p_final || p_third || p_champion || p_third_winner) AS t
  WHERE t NOT IN (SELECT name FROM public.teams)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_pick' USING HINT = 'unknown team: ' || v_bad;
  END IF;

  DELETE FROM public.knockout_pick WHERE user_id = v_uid;
  INSERT INTO public.knockout_pick (user_id, round, team)
  SELECT DISTINCT v_uid, z.round, z.team
  FROM (
    SELECT 'qf'           AS round, unnest(p_qf)           AS team
    UNION ALL SELECT 'sf',           unnest(p_sf)
    UNION ALL SELECT 'final',        unnest(p_final)
    UNION ALL SELECT 'third',        unnest(p_third)
    UNION ALL SELECT 'champion',     unnest(p_champion)
    UNION ALL SELECT 'third_winner', unnest(p_third_winner)
  ) z;

  RETURN jsonb_build_object(
    'ok', true, 'qf', p_qf, 'sf', p_sf, 'final', p_final, 'third', p_third,
    'champion', p_champion, 'third_winner', p_third_winner
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_knockout_picks(text[],text[],text[],text[],text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_knockout_picks(text[],text[],text[],text[],text[],text[]) TO authenticated;

-- 3) Scoring: add +10 correct champion (Final winner) + +5 correct 3rd-place winner.
CREATE OR REPLACE FUNCTION public.fn_knockout_points(p_user uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH actual AS (
    SELECT phase AS round, team_home AS team FROM public.games
      WHERE phase IN ('qf','sf','final','third') AND team_home <> 'TBD'
    UNION
    SELECT phase, team_away FROM public.games
      WHERE phase IN ('qf','sf','final','third') AND team_away <> 'TBD'
  ),
  hits AS (
    SELECT kp.round, count(*) AS h
    FROM public.knockout_pick kp
    JOIN actual a ON a.round = kp.round AND a.team = kp.team
    WHERE kp.user_id = p_user
    GROUP BY kp.round
  ),
  reach AS (
    SELECT COALESCE(SUM(
      2 * h
      + CASE
          WHEN round = 'qf'    AND h = 8 THEN 12
          WHEN round = 'sf'    AND h = 4 THEN 10
          WHEN round = 'final' AND h = 2 THEN 8
          WHEN round = 'third' AND h = 2 THEN 6
          ELSE 0
        END), 0)::int AS pts
    FROM hits
  ),
  champ AS (
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.knockout_pick kp
      JOIN public.games g ON g.phase = 'final' AND g.knockout_winner = kp.team
      WHERE kp.user_id = p_user AND kp.round = 'champion'
    ) THEN 10 ELSE 0 END AS pts
  ),
  tw AS (
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.knockout_pick kp
      JOIN public.games g ON g.phase = 'third' AND g.knockout_winner = kp.team
      WHERE kp.user_id = p_user AND kp.round = 'third_winner'
    ) THEN 5 ELSE 0 END AS pts
  )
  SELECT (SELECT pts FROM reach) + (SELECT pts FROM champ) + (SELECT pts FROM tw);
$function$;
