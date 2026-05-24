-- M108 (#25): stop baking the service-role JWT into cron.job.command.
-- fn_schedule_game_sync already looks the key up inline at fire time; this brings
-- fn_schedule_ai_summaries + fn_schedule_af_odds_sync to the same pattern.
-- ONLY the key-injection changes. Preserved exactly: 150-min delay, jsonb body (NO ::text),
-- per-group loop, jobname format, last_KO+160min push job, af-odds 07:15 schedule.
-- The two re-runs at the bottom regenerate FUTURE jobs so the plaintext key is scrubbed from
-- cron.job.command now (past-date jobs never fire and are cleaned up at fresh-production setup).

-- ── fn_schedule_ai_summaries: inline key, drop baked v_srk ──
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
      kick_off_time::date AS game_date,
      MAX(kick_off_time)  AS last_kickoff
    FROM public.games
    GROUP BY kick_off_time::date
    ORDER BY kick_off_time::date
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

-- ── fn_schedule_af_odds_sync: inline key (v_key kept only for the existence guard) ──
CREATE OR REPLACE FUNCTION public.fn_schedule_af_odds_sync()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_url text; v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'app_service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'Vault secrets missing';
  END IF;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'af-odds-daily';
  PERFORM cron.schedule(
    'af-odds-daily', '15 7 * * *',
    format($sql$SELECT net.http_post(url:=%L,body:='{"mode":"sync_af_odds"}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_service_role_key')));$sql$,
    v_url||'/football-api-sync')
  );
END;$function$;

-- Regenerate currently-scheduled jobs so the plaintext key is scrubbed from cron.job.command.
SELECT public.fn_schedule_af_odds_sync();
SELECT public.fn_schedule_ai_summaries();
