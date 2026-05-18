-- M98: Add 'friendly' to games.phase CHECK constraint
-- Allows inserting non-WC test/warm-up games (e.g., PL) to test the sync pipeline

ALTER TABLE public.games
  DROP CONSTRAINT IF EXISTS games_phase_check;

ALTER TABLE public.games
  ADD CONSTRAINT games_phase_check
  CHECK (phase IN ('group','r32','r16','qf','sf','third','final','friendly'));
