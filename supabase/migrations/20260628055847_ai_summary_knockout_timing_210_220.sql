-- M137 — Knockout-day AI-summary timing: +150→+210 (generation) and +160→+220 (push).
--
-- WHY: fn_schedule_ai_summaries fires the per-group summary at last_kickoff+150min and the
-- daily push at +160min. Group stage has no ET/penalties so +150 was always safe, but a
-- knockout game going to ET+penalties ends ~last_KO+165 and knockout_winner lands later →
-- the summary/push could fire BEFORE that day's final scores/winner were written. Bumping to
-- +210/+220 leaves a comfortable margin after even the longest last game of the day.
--
-- ONLY the two interval literals change (v_fire_at 150→210, v_push_at 160→220); body otherwise
-- VERBATIM from the live function (dumped via pg_get_functiondef first, per the
-- "never CREATE OR REPLACE blindly" rule). Verified by a subagent diff = PASS (exactly those
-- two changes, everything else byte-identical).
--
-- Applied to BOTH envs (DEV + PROD) 2026-06-28, then `SELECT fn_schedule_ai_summaries()` was
-- run on each to REGENERATE all future-date crons in place (same job names → upsert, no delete,
-- no duplicates) with the new +210/+220 timing — confirmed on the R32 match-days (Jun28 gen 22:30
-- /push 22:40, Jun29 04:30/04:40, Jun30 04:30/04:40, Jul3 05:00/05:10). One re-run updates BOTH
-- the generation and the push crons. DEV+PROD md5 identical = 1c54ff164ff34c2bfcf9e494ee685073.
-- Reminder for future game inserts: after adding games, the re-run (or the daily safety cron
-- ai-summary-schedule-daily) picks up the new timing automatically.

CREATE OR REPLACE FUNCTION public.fn_schedule_ai_summaries()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_day        record;
  v_grp        record;
  v_fire_at    timestamptz;
  v_push_at    timestamptz;
  v_cron       text;
  v_push_cron  text;
  v_job_name   text;
  v_push_job   text;
  v_ef_url     text;
BEGIN
  SELECT decrypted_secret INTO v_ef_url
  FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

  FOR v_day IN
    SELECT
      (kick_off_time - interval '7.5 hours')::date AS game_date,
      MAX(kick_off_time)                           AS last_kickoff
    FROM public.games
    GROUP BY (kick_off_time - interval '7.5 hours')::date
    ORDER BY (kick_off_time - interval '7.5 hours')::date
  LOOP
    v_fire_at := v_day.last_kickoff + interval '210 minutes';
    v_push_at := v_day.last_kickoff + interval '220 minutes';

    CONTINUE WHEN v_fire_at <= NOW();

    v_cron :=
      EXTRACT(MINUTE FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_fire_at AT TIME ZONE 'UTC')::int || ' *';

    v_push_cron :=
      EXTRACT(MINUTE FROM v_push_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_push_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_push_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_push_at AT TIME ZONE 'UTC')::int || ' *';

    FOR v_grp IN
      SELECT g.id
      FROM public.groups g
      JOIN public.group_members gm ON gm.group_id = g.id
      WHERE NOT gm.is_inactive
      GROUP BY g.id
      HAVING COUNT(gm.user_id) >= 3
    LOOP
      v_job_name := 'ai-summary-' || v_day.game_date::text || '-' || left(v_grp.id::text, 8);

      PERFORM cron.schedule(
        v_job_name,
        v_cron,
        format(
          'SELECT net.http_post(
              url := %L || ''/nightly-summary'',
              headers := jsonb_build_object(
                ''Content-Type'', ''application/json'',
                ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''app_service_role_key'')
              ),
              body := jsonb_build_object(''date'', %L, ''group_id'', %L)
            )',
          v_ef_url,
          v_day.game_date,
          v_grp.id
        )
      );
    END LOOP;

    v_push_job := 'ai-summary-push-' || v_day.game_date::text;

    PERFORM cron.schedule(
      v_push_job,
      v_push_cron,
      format(
        'SELECT public.fn_notify_ai_summary_daily(%L::date)',
        v_day.game_date
      )
    );
  END LOOP;
END;
$function$;
