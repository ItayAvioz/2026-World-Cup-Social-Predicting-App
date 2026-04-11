-- Fix fn_schedule_ai_summaries: body must be jsonb, not text, for net.http_post
-- Bug: body := jsonb_build_object(...)::text was causing silent SQL type error
--      net.http_post expects body as jsonb; ::text cast broke the call entirely

CREATE OR REPLACE FUNCTION public.fn_schedule_ai_summaries()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_day       record;
  v_fire_at   timestamptz;
  v_cron      text;
  v_job_name  text;
  v_ef_url    text;
  v_srk       text;
BEGIN
  SELECT decrypted_secret INTO v_ef_url
  FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

  SELECT decrypted_secret INTO v_srk
  FROM vault.decrypted_secrets WHERE name = 'app_service_role_key';

  FOR v_day IN
    SELECT
      kick_off_time::date AS game_date,
      MAX(kick_off_time)  AS last_kickoff
    FROM public.games
    GROUP BY kick_off_time::date
    ORDER BY kick_off_time::date
  LOOP
    v_fire_at  := v_day.last_kickoff + interval '150 minutes';
    v_job_name := 'ai-summary-' || v_day.game_date::text;

    v_cron :=
      EXTRACT(MINUTE FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_fire_at AT TIME ZONE 'UTC')::int || ' *';

    PERFORM cron.schedule(
      v_job_name,
      v_cron,
      format(
        'SELECT net.http_post(
            url := %L || ''/nightly-summary'',
            headers := jsonb_build_object(
              ''Content-Type'', ''application/json'',
              ''Authorization'', ''Bearer '' || %L
            ),
            body := jsonb_build_object(''date'', %L)
          )',
        v_ef_url,
        v_srk,
        v_day.game_date
      )
    );
  END LOOP;
END;
$$;
