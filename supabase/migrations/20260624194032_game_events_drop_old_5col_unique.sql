-- M134 — cleanup: drop the now-unused 5-col unique constraint on game_events.
-- Applied to PROD 2026-06-24 AFTER football-api-sync v20 was deployed (and dev earlier).
--
-- The live EF now upserts events with the 6-col onConflict (game_events_uniq), so nothing
-- references the old 5-col target anymore. Removing it matches dev exactly and avoids the
-- overly-strict 5-col rule rejecting valid sudden-death same-player shootout kicks.
-- Non-destructive: drops a constraint only — no rows, columns, or data affected.

ALTER TABLE public.game_events
  DROP CONSTRAINT IF EXISTS game_events_game_id_team_player_name_event_type_minute_key;
