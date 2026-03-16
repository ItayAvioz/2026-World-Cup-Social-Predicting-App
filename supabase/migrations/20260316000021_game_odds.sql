-- Migration 21: game_odds table
-- Pre-game betting odds per game, written by football API sync
-- Used on game.html to show 1X2 odds before kickoff
--
-- 1X2 rules:
--   home_win = home wins in 90 min
--   draw     = draw after 90 min (group stage: actual draw; knockout: goes to ET)
--   away_win = away wins in 90 min
--   draw is always filled — same format for group stage AND knockout games
--
-- ⚠️ FUTURE IDEAS (not yet implemented):
--   over_2_5    decimal(6,2)  -- over 2.5 total goals
--   under_2_5   decimal(6,2)  -- under 2.5 total goals

CREATE TABLE IF NOT EXISTS public.game_odds (
  game_id    uuid         NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  source     text         NOT NULL DEFAULT 'football-api',
  home_win   decimal(6,2) NOT NULL,   -- e.g. 2.50
  draw       decimal(6,2) NOT NULL,   -- e.g. 3.20  (group: draw; knockout: goes to ET)
  away_win   decimal(6,2) NOT NULL,   -- e.g. 2.80
  updated_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, source)
);

-- Index for bulk reads (all odds for upcoming games)
CREATE INDEX IF NOT EXISTS game_odds_game_idx ON public.game_odds (game_id);

-- RLS: public read (same as game_team_stats), service role only for writes
ALTER TABLE public.game_odds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_odds: public read"
  ON public.game_odds FOR SELECT
  USING (true);

-- INSERT / UPDATE / DELETE: service role only (football API sync)
