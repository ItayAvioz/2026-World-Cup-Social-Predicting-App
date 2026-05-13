-- Migration 83: fix fn_schedule_ai_summaries — restore 150 min delay (M73 regressed to 110)
-- Score sync runs at KO+120min. 110min fires 10min before scores land → games_not_finished.
-- M56/M59 correctly used 150min. M73 broke it. This restores the correct value.

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

  FOR v_day IN
    SELECT
      kick_off_time::date AS game_date,
      MAX(kick_off_time)  AS last_kickoff
    FROM public.games
    GROUP BY kick_off_time::date
    ORDER BY kick_off_time::date
  LOOP
    v_fire_at := v_day.last_kickoff + interval '150 minutes';

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
