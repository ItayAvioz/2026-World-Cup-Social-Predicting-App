-- M101: Consolidate AI summary push notifications.
-- Before: trg_notify_ai_summary fired AFTER INSERT on ai_summaries (one push per group).
--         User in N groups received N pushes per night.
-- After:  one consolidated cron job per night at last_KO + 160min sends a single push
--         per user (union of all active members across qualifying groups for that date).

BEGIN;

DROP TRIGGER  IF EXISTS trg_notify_ai_summary ON public.ai_summaries;
DROP FUNCTION IF EXISTS public.fn_notify_ai_summary();

CREATE OR REPLACE FUNCTION public.fn_notify_ai_summary_daily(target_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT gm.user_id) INTO v_user_ids
  FROM public.ai_summaries s
  JOIN public.group_members gm ON gm.group_id = s.group_id
  WHERE s.date = target_date
    AND (gm.is_inactive IS NULL OR gm.is_inactive = false);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) = 0 THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'title', '🤖 AI Summary Ready!',
      'body',  'The nightly roast for your group is in. Who got burned?',
      'url',   '/2026-World-Cup-Social-Predicting-App/app.html#/ai-feed',
      'user_ids', v_user_ids
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notify_ai_summary_daily failed for %: %', target_date, SQLERRM;
END;
$$;

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
  v_srk        text;
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

COMMIT;
