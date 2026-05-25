-- M110: shift the AI-summary "match-day" boundary from 00:00 UTC (03:00 Israel) to 07:30 UTC (10:30 Israel).
-- WHY: WC games run in US time zones; late games kick off up to 04:00 UTC. With a 00:00 UTC cut a single
-- match-night split across two daily summaries, and a late game's summary landed in the next day's digest.
-- The 05:00–13:00 UTC window has ZERO fixtures (verified), so 07:30 UTC cleanly groups a whole match-night
-- (afternoon → 04:00 UTC late games) into ONE summary. Latest knockout KO = 03:00 UTC, latest (group) KO =
-- 04:00 UTC; latest summary fires ~06:30 UTC — all before the 07:30 cut and the 08:00 digest.
-- ONLY the grouping key changes here: MAX(kick_off_time) and the +150/+160 fire/push delays are unchanged
-- (the 90-min score is written during ET at KO+120, so ET/pens never delay the summary).

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
    v_fire_at := v_day.last_kickoff + interval '150 minutes';
    v_push_at := v_day.last_kickoff + interval '160 minutes';

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
