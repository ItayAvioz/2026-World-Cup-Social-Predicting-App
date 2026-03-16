-- Migration 17: Add went_to_extra_time + went_to_penalties to games
-- Display only — not used in scoring. Populated by football API sync.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS went_to_extra_time boolean,
  ADD COLUMN IF NOT EXISTS went_to_penalties  boolean;

-- Both nullable (NULL = group stage or not yet played)
-- Only relevant for knockout games that finish level after 90 min
-- API sync sets these alongside score_home/score_away after game ends
