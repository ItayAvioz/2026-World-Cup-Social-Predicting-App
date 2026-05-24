-- M107: fn_reschedule_game(p_game_id) — used by football-api-sync `verify` when KO moves >5min.
-- verify already re-runs fn_schedule_game_sync (sync+verify crons); this moves the OTHER two
-- per-game crons (auto-predict-{id}, ko-notif-{id}) onto the new kick_off_time so they no longer
-- fire at the old time. Mirrors fn_schedule_auto_predictions (single game) + fn_schedule_ko_notification.
-- Idempotent: cron.schedule upserts by jobname. Cron errors never abort verify (caught here).

CREATE OR REPLACE FUNCTION public.fn_reschedule_game(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_ko    timestamptz;
  v_home  text;
  v_away  text;
  v_cron  text;
BEGIN
  SELECT kick_off_time, team_home, team_away
    INTO v_ko, v_home, v_away
    FROM public.games
   WHERE id = p_game_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- auto-predict-{id} on the new KO (same cron build as fn_schedule_auto_predictions, single game)
  v_cron :=
    EXTRACT(MINUTE FROM v_ko AT TIME ZONE 'UTC')::int || ' ' ||
    EXTRACT(HOUR   FROM v_ko AT TIME ZONE 'UTC')::int || ' ' ||
    EXTRACT(DAY    FROM v_ko AT TIME ZONE 'UTC')::int || ' ' ||
    EXTRACT(MONTH  FROM v_ko AT TIME ZONE 'UTC')::int || ' *';

  PERFORM cron.schedule(
    'auto-predict-' || p_game_id::text,
    v_cron,
    format('SELECT public.fn_auto_predict_game(%L::uuid)', p_game_id)
  );

  -- ko-notif-{id} on the new KO (fn_schedule_ko_notification upserts by jobname, guards past times)
  PERFORM public.fn_schedule_ko_notification(p_game_id, v_ko, v_home, v_away);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_reschedule_game failed for %: %', p_game_id, SQLERRM;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_reschedule_game(uuid) TO service_role;
