-- M115: top_scorer_candidates schema update (2026-05-30)
--
-- Context: bootstrap_squads EF mode pulls all 1383 WC2026 players from api-football
-- (was only ~30 hardcoded star strikers before). With 1383 players across 48 squads,
-- name collisions are real (11 distinct dup names) and the old `name UNIQUE` constraint
-- would silently drop those rows on bulk insert.
--
-- This migration:
--   1. ADD COLUMN position — stores api-football's position label
--      (Attacker | Midfielder | Defender | Goalkeeper). Nullable so existing
--      rows + manual additions don't need backfill.
--   2. DROP CONSTRAINT name UNIQUE — name is no longer a natural key.
--   3. ADD CONSTRAINT api_player_id UNIQUE — api-football's player ID is the
--      natural key (NOT NULL since M51). Per-fixture setup_lineups EF + bulk
--      bootstrap_squads both now upsert ON CONFLICT (api_player_id).
--
-- Frontend impact: none. Picks.jsx reads (name, team_name, flag_code, api_player_id);
-- it doesn't enforce name uniqueness in queries.
--
-- Pairs with: football-api-sync EF v4 (setup_lineups onConflict: 'api_player_id')
-- + supabase/migrations-prod/20260530000002_*_all_players.sql (prod-only bulk seed).

ALTER TABLE public.top_scorer_candidates ADD COLUMN IF NOT EXISTS position text;

ALTER TABLE public.top_scorer_candidates DROP CONSTRAINT IF EXISTS top_scorer_candidates_name_key;

ALTER TABLE public.top_scorer_candidates
  ADD CONSTRAINT top_scorer_candidates_api_player_id_key UNIQUE (api_player_id);

COMMENT ON COLUMN public.top_scorer_candidates.position IS 'Player position from api-football: Attacker | Midfielder | Defender | Goalkeeper';
