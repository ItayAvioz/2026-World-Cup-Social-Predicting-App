-- Migration 19: Add end-game result columns to games
-- For knockout games: store full result beyond 90-min score
-- Display: prediction | 90-min score | end game score (ET or pens)

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS et_score_home      int,   -- score after extra time (NULL if no ET)
  ADD COLUMN IF NOT EXISTS et_score_away      int,   -- score after extra time (NULL if no ET)
  ADD COLUMN IF NOT EXISTS penalty_score_home int,   -- penalty shootout score (NULL if no pens)
  ADD COLUMN IF NOT EXISTS penalty_score_away int;   -- penalty shootout score (NULL if no pens)

-- Notes:
-- went_to_extra_time = true  → et_score_home/away will be set
-- went_to_penalties  = true  → penalty_score_home/away will be set
-- knockout_winner            → always set for knockout games (actual winner after ET/pens)
-- score_home/score_away      → 90-min score ONLY, never changes
-- API sync writes all columns together when game fully ends
