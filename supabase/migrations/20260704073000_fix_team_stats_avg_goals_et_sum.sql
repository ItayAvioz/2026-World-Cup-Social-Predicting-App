-- Fix team_tournament_stats.avg_goals_scored / avg_goals_conceded.
-- BUG: both used COALESCE(et_score, score). et_score is EXTRA-TIME-PERIOD-ONLY
-- (NULL if no ET), so for any ET/penalty game COALESCE returned the ET-period
-- goals (0 when ET was 0-0) INSTEAD of the 90-min score → undercounted goals
-- for the 10 teams that played an ET game (e.g. Paraguay showed 0.5 scored / 1.0
-- conceded instead of the true 0.8 / 1.3 over 4 games).
-- FIX: full-match goals = 90-min score + ET-period goals = score + COALESCE(et_score, 0).
-- Penalty shootouts are NOT goals (they only set knockout_winner) → correctly excluded.
-- Verified: score+COALESCE(et,0) reproduces the independent game_events goal tally
-- for all 48 teams; penalties excluded; non-ET teams unchanged (et_score NULL → +0).
-- Backend-only, display stat, zero scoring impact. Applied DEV + PROD 2026-07-04
-- (viewdef md5 identical both envs `9b0034eaffd947e91e7159fb9d11dde3`).
-- ONLY the two avg_goals_* CASE expressions change; W/D/L + other avgs verbatim.
-- security_invoker=true preserved (M97).
CREATE OR REPLACE VIEW public.team_tournament_stats WITH (security_invoker = true) AS
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
            WHEN g.team_home = ts.team THEN g.score_home + COALESCE(g.et_score_home, 0)
            ELSE g.score_away + COALESCE(g.et_score_away, 0)
        END), 1) AS avg_goals_scored,
    round(avg(
        CASE
            WHEN g.team_home = ts.team THEN g.score_away + COALESCE(g.et_score_away, 0)
            ELSE g.score_home + COALESCE(g.et_score_home, 0)
        END), 1) AS avg_goals_conceded
   FROM game_team_stats ts
     JOIN games g ON g.id = ts.game_id
  WHERE g.score_home IS NOT NULL
  GROUP BY ts.team;
