-- Migration 71: backfill_sync_game_crons
-- One-time call of fn_schedule_game_sync for all existing future games with api_fixture_id.
-- M68 trigger handles new game inserts going forward.
-- Only games with kick_off_time > now() AND api_fixture_id IS NOT NULL are scheduled.

DO $$
DECLARE
  g RECORD;
BEGIN
  FOR g IN
    SELECT id FROM public.games
    WHERE api_fixture_id IS NOT NULL
      AND kick_off_time > now()
  LOOP
    BEGIN
      PERFORM public.fn_schedule_game_sync(g.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill_sync_game_crons: fn_schedule_game_sync failed for game %: %', g.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
