-- Migration 13: get_game_prediction_distribution v2
-- Returns: team names, W/D/L counts + percentages, goals/game distribution array, top scores with %
-- Optional p_group_id filters to group members only
-- Call once per group + once globally for game.html display

DROP FUNCTION IF EXISTS public.get_game_prediction_distribution(uuid);
DROP FUNCTION IF EXISTS public.get_game_prediction_distribution(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_game_prediction_distribution(
  p_game_id  uuid,
  p_group_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_team_home  text;
  v_team_away  text;
  v_total      int;
  v_home_win   int;
  v_draw       int;
  v_away_win   int;
  v_exact      int;
  v_goals_dist jsonb;
  v_top_scores jsonb;
BEGIN
  SELECT team_home, team_away INTO v_team_home, v_team_away
  FROM public.games WHERE id = p_game_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pred_home > pred_away),
    COUNT(*) FILTER (WHERE pred_home = pred_away),
    COUNT(*) FILTER (WHERE pred_home < pred_away),
    COUNT(*) FILTER (WHERE points_earned = 3)
  INTO v_total, v_home_win, v_draw, v_away_win, v_exact
  FROM public.predictions p
  WHERE p.game_id = p_game_id
    AND (p_group_id IS NULL OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = p_group_id AND gm.user_id = p.user_id
    ));

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'team_home', v_team_home, 'team_away', v_team_away,
      'total', 0, 'home_win', 0, 'draw', 0, 'away_win', 0,
      'home_win_pct', 0, 'draw_pct', 0, 'away_win_pct', 0,
      'exact_count', 0, 'goals_distribution', '[]'::jsonb, 'top_scores', '[]'::jsonb
    );
  END IF;

  -- Goals per game distribution
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'goals', total_goals,
      'count', cnt,
      'pct',   ROUND(cnt * 100.0 / v_total, 1)
    ) ORDER BY total_goals
  ), '[]'::jsonb)
  INTO v_goals_dist
  FROM (
    SELECT (pred_home + pred_away) AS total_goals, COUNT(*) AS cnt
    FROM public.predictions p
    WHERE p.game_id = p_game_id
      AND (p_group_id IS NULL OR EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id AND gm.user_id = p.user_id
      ))
    GROUP BY total_goals
  ) gd;

  -- Top 5 scorelines with %
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('score', score, 'count', cnt, 'pct', ROUND(cnt * 100.0 / v_total, 1))
    ORDER BY cnt DESC
  ), '[]'::jsonb)
  INTO v_top_scores
  FROM (
    SELECT pred_home::text || '-' || pred_away::text AS score, COUNT(*) AS cnt
    FROM public.predictions p
    WHERE p.game_id = p_game_id
      AND (p_group_id IS NULL OR EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id AND gm.user_id = p.user_id
      ))
    GROUP BY pred_home, pred_away
    ORDER BY cnt DESC
    LIMIT 5
  ) ts;

  RETURN jsonb_build_object(
    'team_home',          v_team_home,
    'team_away',          v_team_away,
    'total',              v_total,
    'home_win',           v_home_win,
    'draw',               v_draw,
    'away_win',           v_away_win,
    'home_win_pct',       ROUND(v_home_win  * 100.0 / v_total, 1),
    'draw_pct',           ROUND(v_draw      * 100.0 / v_total, 1),
    'away_win_pct',       ROUND(v_away_win  * 100.0 / v_total, 1),
    'exact_count',        v_exact,
    'goals_distribution', v_goals_dist,
    'top_scores',         v_top_scores
  );
END;
$$;
