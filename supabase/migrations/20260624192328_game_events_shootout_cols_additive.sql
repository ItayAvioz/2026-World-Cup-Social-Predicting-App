-- M133 — penalty-shootout + missed-penalty capture: additive schema prep.
-- Applied to PROD 2026-06-24 (and dev, as 3 finer-grained migrations during iteration —
-- shootout_cols + event_type_add_shootout + add_missed_penalty_type — same end state).
--
-- Additive on purpose: keeps the existing 5-col unique constraint in place so the live
-- football-api-sync v18 (5-col onConflict) keeps writing events with no broken window.
-- The 5-col constraint is dropped in the follow-up migration (20260624194032) AFTER the
-- new EF v19/v20 (6-col onConflict) is deployed.

ALTER TABLE public.game_events ADD COLUMN IF NOT EXISTS comments text;
ALTER TABLE public.game_events ADD COLUMN IF NOT EXISTS sort_order smallint;

-- New 6-col unique index (adds minute_extra) used by the new EF's onConflict.
-- NULLS NOT DISTINCT (PG15+) so in-play events with NULL minute_extra stay idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS game_events_uniq
  ON public.game_events (game_id, team, player_name, event_type, minute, minute_extra) NULLS NOT DISTINCT;

-- Widen event_type CHECK to allow the new shootout + missed-penalty types.
ALTER TABLE public.game_events DROP CONSTRAINT game_events_event_type_check;
ALTER TABLE public.game_events ADD CONSTRAINT game_events_event_type_check
  CHECK (event_type = ANY (ARRAY['goal'::text, 'red_card'::text, 'pen_shootout_scored'::text, 'pen_shootout_missed'::text, 'missed_penalty'::text]));
