-- Migration 18: Fix get_group_summary_data — inline leaderboard query
-- Bug: internally called get_group_leaderboard() which checks auth.uid()
-- When called from Edge Function (service_role, no JWT) → auth.uid() = NULL → not_a_member error
-- Fix: inline the leaderboard ranking logic directly (no auth check needed — fn is SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.get_group_summary_data(p_group_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_games        jsonb;
  v_members      jsonb;
  v_leaderboard  jsonb;
BEGIN
  -- Games played on this date
  SELECT jsonb_agg(jsonb_build_object(
    'team_home',   g.team_home,
    'team_away',   g.team_away,
    'score_home',  g.score_home,
    'score_away',  g.score_away,
    'phase',       g.phase
  ) ORDER BY g.kick_off_time)
  INTO v_games
  FROM public.games g
  WHERE g.kick_off_time::date = p_date
    AND g.score_home IS NOT NULL;

  -- Per-member stats: predictions for this day + streak + exact score total
  SELECT jsonb_agg(member_data ORDER BY member_data->>'username')
  INTO v_members
  FROM (
    SELECT jsonb_build_object(
      'username',         p.username,
      'user_id',          p.id,

      -- Predictions for today's games
      'predictions',      (
        SELECT jsonb_agg(jsonb_build_object(
          'game_id',      pr.game_id,
          'pred_home',    pr.pred_home,
          'pred_away',    pr.pred_away,
          'points',       pr.points_earned,
          'is_auto',      pr.is_auto
        ))
        FROM public.predictions pr
        JOIN public.games g ON g.id = pr.game_id
        WHERE pr.user_id = p.id
          AND g.kick_off_time::date = p_date
          AND g.score_home IS NOT NULL
      ),

      -- Total exact scores ever
      'total_exact_scores', (
        SELECT COUNT(*)
        FROM public.predictions pr
        WHERE pr.user_id = p.id
          AND pr.points_earned = 3
      ),

      -- Current streak: positive = consecutive correct W/D/L, negative = consecutive wrong
      'current_streak', (
        WITH recent AS (
          SELECT
            pr.points_earned,
            ROW_NUMBER() OVER (ORDER BY g.kick_off_time DESC) AS rn
          FROM public.predictions pr
          JOIN public.games g ON g.id = pr.game_id
          WHERE pr.user_id = p.id
            AND g.score_home IS NOT NULL
          ORDER BY g.kick_off_time DESC
        ),
        streak_calc AS (
          SELECT
            CASE WHEN (SELECT points_earned FROM recent WHERE rn = 1) >= 1
              THEN  (SELECT COUNT(*) FROM recent r
                     WHERE r.rn <= (
                       SELECT COALESCE(MIN(r2.rn) - 1, (SELECT MAX(rn) FROM recent))
                       FROM recent r2
                       WHERE r2.rn > 0 AND r2.points_earned = 0
                     ) AND r.points_earned >= 1)
              ELSE -(SELECT COUNT(*) FROM recent r
                     WHERE r.rn <= (
                       SELECT COALESCE(MIN(r2.rn) - 1, (SELECT MAX(rn) FROM recent))
                       FROM recent r2
                       WHERE r2.rn > 0 AND r2.points_earned >= 1
                     ) AND r.points_earned = 0)
            END AS streak
        )
        SELECT streak FROM streak_calc
      )
    ) AS member_data
    FROM public.profiles p
    JOIN public.group_members gm ON gm.user_id = p.id
    WHERE gm.group_id = p_group_id
  ) sub;

  -- Group leaderboard — inlined (no auth.uid() check needed, fn is SECURITY DEFINER)
  SELECT jsonb_agg(jsonb_build_object(
    'group_rank',   ranked.group_rank,
    'username',     ranked.username,
    'total_points', ranked.total_points,
    'exact_scores', ranked.exact_scores
  ) ORDER BY ranked.group_rank)
  INTO v_leaderboard
  FROM (
    SELECT
      RANK() OVER (ORDER BY g.total_points DESC, g.exact_scores DESC, g.username ASC) AS group_rank,
      g.username,
      g.total_points,
      g.exact_scores
    FROM (
      SELECT
        p.username,
        COALESCE(SUM(pr.points_earned), 0)
          + COALESCE(cp.points_earned, 0)
          + COALESCE(ts.points_earned, 0)          AS total_points,
        COUNT(*) FILTER (WHERE pr.points_earned = 3) AS exact_scores
      FROM public.profiles p
      JOIN public.group_members gm ON gm.user_id = p.id
      LEFT JOIN public.predictions     pr ON pr.user_id = p.id
      LEFT JOIN public.champion_pick   cp ON cp.user_id = p.id
      LEFT JOIN public.top_scorer_pick ts ON ts.user_id = p.id
      WHERE gm.group_id = p_group_id
      GROUP BY p.id, p.username, cp.points_earned, ts.points_earned
    ) g
  ) ranked;

  RETURN jsonb_build_object(
    'group_id',    p_group_id,
    'date',        p_date,
    'games',       COALESCE(v_games, '[]'::jsonb),
    'members',     COALESCE(v_members, '[]'::jsonb),
    'leaderboard', COALESCE(v_leaderboard, '[]'::jsonb)
  );
END;
$$;
