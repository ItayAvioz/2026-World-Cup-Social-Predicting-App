-- Knockout bracket scoring: award "reached round R" from the WINNER of the round-(R-1)
-- game (games.knockout_winner), instead of "team appears in a round-R fixture".
--
-- WHY: a team advances the moment it WINS its game, but the next round's fixtures are only
-- inserted later (operationally). The old model counted a team as "reached the QF" only once
-- a QF fixture containing it existed, so bracket points/colors sat at 0 during a round even
-- though results were in. New model reads the prior round's knockout_winner → points + green/
-- red/gold update the instant each game finishes.
--
-- EQUIVALENCE: mathematically identical once all fixtures exist (a round-R fixture's two teams
-- ARE the round-(R-1) winners) — this only makes it update EARLIER. Round sizes/bonuses/max 83
-- unchanged. 'third' (3rd-place game) reachers = the two SF LOSERS. champion/third_winner
-- winner-picks UNCHANGED (still judged on the final/3rd-place game's knockout_winner).
--
-- Both leaderboard RPCs call fn_knockout_points unchanged (still gated to 2026-07-20).
-- Client mirror updated in src/features/knockout-prediction/scoring.js (knockoutReached +
-- knockoutEliminated) — verified client==server at partial (12) and complete (78) DEV states.
-- Applied BOTH envs 2026-07-04, md5 identical `25cc51218f72715a60964a5752adf1f8`.
CREATE OR REPLACE FUNCTION public.fn_knockout_points(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH actual AS (
    -- reached QF = winners of R16 games
    SELECT 'qf'::text AS round, knockout_winner AS team
      FROM public.games WHERE phase = 'r16' AND knockout_winner IS NOT NULL
    UNION ALL
    -- reached SF = winners of QF games
    SELECT 'sf', knockout_winner
      FROM public.games WHERE phase = 'qf' AND knockout_winner IS NOT NULL
    UNION ALL
    -- reached Final = winners of SF games
    SELECT 'final', knockout_winner
      FROM public.games WHERE phase = 'sf' AND knockout_winner IS NOT NULL
    UNION ALL
    -- reached 3rd-place game = LOSERS of SF games
    SELECT 'third', CASE WHEN team_home = knockout_winner THEN team_away ELSE team_home END
      FROM public.games WHERE phase = 'sf' AND knockout_winner IS NOT NULL
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
