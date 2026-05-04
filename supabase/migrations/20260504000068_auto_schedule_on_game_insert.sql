-- Migration 68: auto_schedule_on_game_insert
-- Adds AFTER INSERT trigger on games that automatically schedules:
--   - auto-predict cron (at kickoff)
--   - verify + sync crons (KO-30min and KO+120min)
--   - AI summary cron (150min after last game of the day)
-- Before this migration, all scheduling had to be called manually after
-- every game insert. Trigger is wrapped in exception handlers so a
-- scheduling failure never blocks the INSERT itself.

CREATE OR REPLACE FUNCTION fn_auto_schedule_game()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Auto-predict crons for all games (idempotent, replaces by job name)
  BEGIN
    PERFORM fn_schedule_auto_predictions();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_auto_schedule_game: fn_schedule_auto_predictions failed: %', SQLERRM;
  END;

  -- AI summary crons for all games (idempotent, replaces by job name)
  BEGIN
    PERFORM fn_schedule_ai_summaries();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_auto_schedule_game: fn_schedule_ai_summaries failed: %', SQLERRM;
  END;

  -- Verify + sync crons for this specific game.
  -- Skip if KO is in the past (can't schedule retroactively) or
  -- api_fixture_id is not yet set (knockout games inserted before setup mode).
  -- In those cases, fn_schedule_game_sync must be called manually after setup.
  IF NEW.kick_off_time > now() AND NEW.api_fixture_id IS NOT NULL THEN
    BEGIN
      PERFORM fn_schedule_game_sync(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_auto_schedule_game: fn_schedule_game_sync failed for game %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_schedule_game
  AFTER INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_schedule_game();
