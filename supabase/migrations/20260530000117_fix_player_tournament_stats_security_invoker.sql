-- M117: Fix player_tournament_stats SECURITY DEFINER -> SECURITY INVOKER
--
-- Closes the last parity gap found in the 2026-05-30 dev<->prod audit:
--   - Dev had this fix applied via dashboard SQL editor (no migration file)
--   - Prod was cut over via pg_dump BEFORE the dashboard fix landed on dev
--   - Result: dev reloptions=[security_invoker=true]; prod reloptions=null
--
-- M97 had already fixed team_tournament_stats the same way. This mirrors that
-- fix for player_tournament_stats.
--
-- Impact: minor (the view exposes public WC tournament data — same data the
-- Game.jsx top-scorer leaderboard shows). Closes a Supabase security advisor
-- "security_definer_view" ERROR on prod.
--
-- View body is a verbatim copy of dev's pg_get_viewdef('public.player_tournament_stats') output.
-- Applied to both dev (formally — was previously dashboard-only) and prod.

DROP VIEW IF EXISTS public.player_tournament_stats;

CREATE VIEW public.player_tournament_stats
WITH (security_invoker = true)
AS
 SELECT ps.api_player_id,
    ps.player_name,
    ps.team,
    sum(ps.goals) AS total_goals,
    sum(ps.assists) AS total_assists,
    sum(ps.yellow_cards) AS total_yellow_cards,
    sum(ps.red_cards) AS total_red_cards,
    count(*) AS games_played
   FROM game_player_stats ps
     JOIN games g ON g.id = ps.game_id
  WHERE g.score_home IS NOT NULL
  GROUP BY ps.api_player_id, ps.player_name, ps.team
  ORDER BY (sum(ps.goals)) DESC, (sum(ps.assists)) DESC;
