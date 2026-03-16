-- ================================================================
-- WORLDCUP 2026 — Feature: Game Stats (Football API)
-- Tables: game_team_stats, game_player_stats
-- Views:  team_tournament_stats, player_tournament_stats
-- ================================================================


-- ----------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------

CREATE TABLE public.game_team_stats (
  game_id         uuid  NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  team            text  NOT NULL,
  possession      int   CHECK (possession BETWEEN 0 AND 100),
  shots_total     int,
  shots_on_target int,
  corners         int,
  fouls           int,
  yellow_cards    int,
  red_cards       int,
  offsides        int,
  PRIMARY KEY (game_id, team)
);

CREATE INDEX game_team_stats_team_idx ON public.game_team_stats (team);


CREATE TABLE public.game_player_stats (
  game_id        uuid  NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  api_player_id  int   NOT NULL,
  player_name    text  NOT NULL,
  team           text  NOT NULL,
  minutes_played int,
  goals          int   NOT NULL DEFAULT 0,
  assists        int   NOT NULL DEFAULT 0,
  yellow_cards   int   NOT NULL DEFAULT 0,
  red_cards      int   NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, api_player_id)
);

CREATE INDEX game_player_stats_player_idx ON public.game_player_stats (api_player_id);
CREATE INDEX game_player_stats_team_idx   ON public.game_player_stats (team);


-- ----------------------------------------------------------------
-- 2. RLS — public read, service role only for writes
-- ----------------------------------------------------------------

ALTER TABLE public.game_team_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_team_stats: public read"
  ON public.game_team_stats FOR SELECT
  USING (true);

CREATE POLICY "game_player_stats: public read"
  ON public.game_player_stats FOR SELECT
  USING (true);

-- INSERT / UPDATE / DELETE: service role only (football API sync)


-- ----------------------------------------------------------------
-- 3. VIEW — team_tournament_stats
--    Aggregates all finished games per team.
--    Used for pre-game comparison on game.html.
--    Shows averages (not totals) + W/D/L counts.
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW public.team_tournament_stats AS
SELECT
  ts.team,
  COUNT(*)                                                    AS games_played,
  COUNT(*) FILTER (WHERE
    (g.team_home = ts.team AND g.score_home > g.score_away)
    OR (g.team_away = ts.team AND g.score_away > g.score_home)
  )                                                           AS wins,
  COUNT(*) FILTER (WHERE g.score_home = g.score_away)        AS draws,
  COUNT(*) FILTER (WHERE
    (g.team_home = ts.team AND g.score_home < g.score_away)
    OR (g.team_away = ts.team AND g.score_away < g.score_home)
  )                                                           AS losses,
  ROUND(AVG(ts.possession),    1)                             AS avg_possession,
  ROUND(AVG(ts.shots_total),   1)                             AS avg_shots_total,
  ROUND(AVG(ts.shots_on_target), 1)                           AS avg_shots_on_target,
  ROUND(AVG(ts.corners),       1)                             AS avg_corners,
  ROUND(AVG(ts.fouls),         1)                             AS avg_fouls,
  ROUND(AVG(ts.yellow_cards),  1)                             AS avg_yellow_cards,
  ROUND(AVG(ts.red_cards),     1)                             AS avg_red_cards,
  ROUND(AVG(
    CASE WHEN g.team_home = ts.team THEN g.score_home ELSE g.score_away END
  ), 1)                                                       AS avg_goals_scored,
  ROUND(AVG(
    CASE WHEN g.team_home = ts.team THEN g.score_away ELSE g.score_home END
  ), 1)                                                       AS avg_goals_conceded
FROM public.game_team_stats ts
JOIN public.games g ON g.id = ts.game_id
WHERE g.score_home IS NOT NULL   -- finished games only
GROUP BY ts.team;


-- ----------------------------------------------------------------
-- 4. VIEW — player_tournament_stats
--    Aggregates all games per player across the tournament.
--    Used for top scorer tracking + top_scorer_pick points.
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW public.player_tournament_stats AS
SELECT
  ps.api_player_id,
  ps.player_name,
  ps.team,
  SUM(ps.goals)         AS total_goals,
  SUM(ps.assists)       AS total_assists,
  SUM(ps.yellow_cards)  AS total_yellow_cards,
  SUM(ps.red_cards)     AS total_red_cards,
  COUNT(*)              AS games_played
FROM public.game_player_stats ps
JOIN public.games g ON g.id = ps.game_id
WHERE g.score_home IS NOT NULL   -- finished games only
GROUP BY ps.api_player_id, ps.player_name, ps.team
ORDER BY total_goals DESC, total_assists DESC;
