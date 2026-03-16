-- Migration 22: Add api_fixture_id column to games
-- Required by football-api-sync Edge Function — all API sync calls use {api_fixture_id}
-- Column is nullable (no value until synced from API)

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS api_fixture_id int;

-- Index for fast lookup by fixture id (API sync will query by this)
CREATE INDEX IF NOT EXISTS idx_games_api_fixture_id
  ON public.games(api_fixture_id)
  WHERE api_fixture_id IS NOT NULL;
