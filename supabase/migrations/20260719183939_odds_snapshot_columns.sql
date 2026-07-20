-- M142: odds snapshot columns on predictions + champion_pick (nullable, no write grants — trigger-stamped only).
-- Applied to DEV via MCP apply_migration 2026-07-19 (version 20260719183939).
ALTER TABLE public.predictions
  ADD COLUMN odds_home_win numeric,
  ADD COLUMN odds_draw numeric,
  ADD COLUMN odds_away_win numeric,
  ADD COLUMN odds_source text,
  ADD COLUMN odds_captured_at timestamptz;
ALTER TABLE public.champion_pick
  ADD COLUMN odds_value numeric,
  ADD COLUMN odds_bookmaker text,
  ADD COLUMN odds_captured_at timestamptz;
GRANT SELECT (odds_home_win, odds_draw, odds_away_win, odds_source, odds_captured_at) ON public.predictions TO authenticated;
GRANT SELECT (odds_value, odds_bookmaker, odds_captured_at) ON public.champion_pick TO authenticated;
