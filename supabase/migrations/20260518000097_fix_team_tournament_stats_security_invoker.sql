-- ================================================================
-- Migration 97: Fix team_tournament_stats SECURITY DEFINER → SECURITY INVOKER
-- ================================================================
-- SECURITY DEFINER views run as the view creator (bypasses RLS).
-- Recreating without it so the view runs as the querying user.
-- ================================================================

DROP VIEW IF EXISTS public.team_tournament_stats;

CREATE VIEW public.team_tournament_stats
WITH (security_invoker = true)
AS
 SELECT ts.team,
    count(*) AS games_played,
    count(*) FILTER (WHERE g.team_home = ts.team AND g.score_home > g.score_away OR g.team_away = ts.team AND g.score_away > g.score_home OR g.score_home = g.score_away AND g.knockout_winner = ts.team) AS wins,
    count(*) FILTER (WHERE g.score_home = g.score_away AND g.knockout_winner IS NULL) AS draws,
    count(*) FILTER (WHERE g.team_home = ts.team AND g.score_home < g.score_away OR g.team_away = ts.team AND g.score_away < g.score_home OR g.score_home = g.score_away AND g.knockout_winner IS NOT NULL AND g.knockout_winner <> ts.team) AS losses,
    round(avg(ts.possession), 1) AS avg_possession,
    round(avg(ts.shots_total), 1) AS avg_shots_total,
    round(avg(ts.shots_on_target), 1) AS avg_shots_on_target,
    round(avg(ts.corners), 1) AS avg_corners,
    round(avg(ts.fouls), 1) AS avg_fouls,
    round(avg(ts.yellow_cards), 1) AS avg_yellow_cards,
    round(avg(ts.red_cards), 1) AS avg_red_cards,
    round(avg(ts.offsides), 1) AS avg_offsides,
    round(avg(
        CASE
            WHEN g.team_home = ts.team THEN COALESCE(g.et_score_home, g.score_home)
            ELSE COALESCE(g.et_score_away, g.score_away)
        END), 1) AS avg_goals_scored,
    round(avg(
        CASE
            WHEN g.team_home = ts.team THEN COALESCE(g.et_score_away, g.score_away)
            ELSE COALESCE(g.et_score_home, g.score_home)
        END), 1) AS avg_goals_conceded
   FROM game_team_stats ts
     JOIN games g ON g.id = ts.game_id
  WHERE g.score_home IS NOT NULL
  GROUP BY ts.team;
