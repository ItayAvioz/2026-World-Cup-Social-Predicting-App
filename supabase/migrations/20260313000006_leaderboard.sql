-- ================================================================
-- WORLDCUP 2026 — Feature: Leaderboard
-- Objects: leaderboard view + get_leaderboard() + get_group_leaderboard()
-- ================================================================


-- ----------------------------------------------------------------
-- 1. BASE VIEW — full global leaderboard (SECURITY INVOKER)
--    Not queried directly by clients — used by the RPC functions below
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id                                                          AS user_id,
  p.username,
  cp.team                                                       AS champion_team,
  COALESCE(SUM(pr.points_earned), 0)
    + COALESCE(cp.points_earned, 0)
    + COALESCE(ts.points_earned, 0)                             AS total_points,
  COUNT(*) FILTER (WHERE pr.points_earned = 3)                  AS exact_scores,
  RANK() OVER (
    ORDER BY
      COALESCE(SUM(pr.points_earned), 0)
        + COALESCE(cp.points_earned, 0)
        + COALESCE(ts.points_earned, 0) DESC,
      COUNT(*) FILTER (WHERE pr.points_earned = 3) DESC,
      p.username ASC
  )                                                             AS rank
FROM public.profiles p
LEFT JOIN public.predictions     pr ON pr.user_id = p.id
LEFT JOIN public.champion_pick   cp ON cp.user_id = p.id
LEFT JOIN public.top_scorer_pick ts ON ts.user_id = p.id
GROUP BY p.id, p.username, cp.team, cp.points_earned, ts.points_earned;


-- ----------------------------------------------------------------
-- 2. RPC — get_leaderboard()
--    Returns all users ranked globally.
--    SECURITY DEFINER bypasses predictions RLS so all rows are aggregated.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_leaderboard()
RETURNS TABLE (
  rank          bigint,
  user_id       uuid,
  username      text,
  champion_team text,
  total_points  bigint,
  exact_scores  bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    RANK() OVER (
      ORDER BY
        COALESCE(SUM(pr.points_earned), 0)
          + COALESCE(cp.points_earned, 0)
          + COALESCE(ts.points_earned, 0) DESC,
        COUNT(*) FILTER (WHERE pr.points_earned = 3) DESC,
        p.username ASC
    )                                                           AS rank,
    p.id                                                        AS user_id,
    p.username,
    cp.team                                                     AS champion_team,
    COALESCE(SUM(pr.points_earned), 0)
      + COALESCE(cp.points_earned, 0)
      + COALESCE(ts.points_earned, 0)                           AS total_points,
    COUNT(*) FILTER (WHERE pr.points_earned = 3)                AS exact_scores
  FROM public.profiles p
  LEFT JOIN public.predictions     pr ON pr.user_id = p.id
  LEFT JOIN public.champion_pick   cp ON cp.user_id = p.id
  LEFT JOIN public.top_scorer_pick ts ON ts.user_id = p.id
  GROUP BY p.id, p.username, cp.team, cp.points_earned, ts.points_earned
  ORDER BY rank, p.username ASC;
$$;


-- ----------------------------------------------------------------
-- 3. RPC — get_group_leaderboard(p_group_id)
--    Returns members of one group ranked within the group.
--    Also includes each member's global rank.
--    Raises error if caller is not a member of the group.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_group_leaderboard(p_group_id uuid)
RETURNS TABLE (
  group_rank    bigint,
  global_rank   bigint,
  user_id       uuid,
  username      text,
  champion_team text,
  total_points  bigint,
  exact_scores  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Verify caller is a member of this group
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING HINT = 'You are not a member of this group';
  END IF;

  RETURN QUERY
  WITH global AS (
    -- Compute global scores for all users
    SELECT
      p.id                                                        AS user_id,
      p.username,
      cp.team                                                     AS champion_team,
      COALESCE(SUM(pr.points_earned), 0)
        + COALESCE(cp.points_earned, 0)
        + COALESCE(ts.points_earned, 0)                           AS total_points,
      COUNT(*) FILTER (WHERE pr.points_earned = 3)                AS exact_scores
    FROM public.profiles p
    LEFT JOIN public.predictions     pr ON pr.user_id = p.id
    LEFT JOIN public.champion_pick   cp ON cp.user_id = p.id
    LEFT JOIN public.top_scorer_pick ts ON ts.user_id = p.id
    GROUP BY p.id, p.username, cp.team, cp.points_earned, ts.points_earned
  ),
  ranked AS (
    -- Add global rank
    SELECT
      g.*,
      RANK() OVER (
        ORDER BY g.total_points DESC, g.exact_scores DESC, g.username ASC
      ) AS global_rank
    FROM global g
  )
  SELECT
    RANK() OVER (
      ORDER BY r.total_points DESC, r.exact_scores DESC, r.username ASC
    )                   AS group_rank,
    r.global_rank,
    r.user_id,
    r.username,
    r.champion_team,
    r.total_points,
    r.exact_scores
  FROM ranked r
  INNER JOIN public.group_members gm ON gm.user_id = r.user_id
  WHERE gm.group_id = p_group_id
  ORDER BY group_rank, r.username ASC;
END;
$$;
