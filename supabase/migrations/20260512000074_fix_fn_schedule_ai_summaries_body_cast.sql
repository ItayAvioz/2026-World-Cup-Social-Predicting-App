-- Migration 74: fix fn_schedule_ai_summaries — remove ::text cast from net.http_post body
-- M73 re-introduced the ::text bug that M56 had fixed. net.http_post requires body as jsonb, not text.

CREATE OR REPLACE FUNCTION public.fn_schedule_ai_summaries()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_day       record;
  v_grp       record;
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

  -- One cron per qualifying group per distinct UTC game-day (future fire times only)
  FOR v_day IN
    SELECT
      kick_off_time::date AS game_date,
      MAX(kick_off_time)  AS last_kickoff
    FROM public.games
    GROUP BY kick_off_time::date
    ORDER BY kick_off_time::date
  LOOP
    v_fire_at := v_day.last_kickoff + interval '110 minutes';

    -- Skip dates whose fire time has already passed
    CONTINUE WHEN v_fire_at <= NOW();

    v_cron :=
      EXTRACT(MINUTE FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_fire_at AT TIME ZONE 'UTC')::int || ' *';

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
                ''Authorization'', ''Bearer '' || %L
              ),
              body := jsonb_build_object(''date'', %L, ''group_id'', %L)
            )',
          v_ef_url,
          v_srk,
          v_day.game_date,
          v_grp.id
        )
      );
    END LOOP;
  END LOOP;
END;
$$;
