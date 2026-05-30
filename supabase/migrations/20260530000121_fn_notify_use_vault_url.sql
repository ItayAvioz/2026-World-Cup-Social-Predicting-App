-- M121: fn_notify_ko / fn_notify_trivia / fn_notify_ai_summary_daily
--       switch to vault-stored EF URL + root-relative click paths
--
-- Closes the last "intentional divergence" from the 2026-05-30 parity audit:
--   - Dev had these 3 fns hardcoding 'https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/send-push'
--     and '/2026-World-Cup-Social-Predicting-App/app.html#/...' (GitHub Pages subpath).
--   - Prod already used the vault pattern (vault.decrypted_secrets WHERE name='app_edge_function_url')
--     and root-relative '/app.html#/...' paths.
--
-- After M121:
--   - Both envs use the SAME function body.
--   - URLs are env-aware via vault (dev's vault → dev EF, prod's vault → prod EF).
--   - Click paths are root-relative ('/app.html#/...') matching the post-cutover gh-pages structure
--     (no more /2026-World-Cup-Social-Predicting-App/ subpath).
--
-- Hotfixes to any of these functions can now be applied to BOTH envs from a single
-- migration file -- no more "remember to swap the URL before deploying to prod".
--
-- Safe to re-run (CREATE OR REPLACE). No data changes.

CREATE OR REPLACE FUNCTION public.fn_notify_ko(p_home text, p_away text, p_job_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_ef_url text;
BEGIN
  SELECT decrypted_secret INTO v_ef_url FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

  PERFORM net.http_post(
    url := v_ef_url || '/send-push',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'title', '⚽ Kickoff in 15 minutes!',
      'body', p_home || ' vs ' || p_away,
      'url', '/app.html#/dashboard'
    )
  );
  PERFORM cron.unschedule(p_job_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_trivia()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_ef_url text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trivia_questions
    WHERE available_from <= now() AND available_until > now()
  ) THEN
    SELECT decrypted_secret INTO v_ef_url FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

    PERFORM net.http_post(
      url := v_ef_url || '/send-push',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object(
        'title', '🧠 Trivia Time!',
        'body',  'Tonight''s question is now open. Can you get it right?',
        'url',   '/app.html#/trivia'
      )
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_ai_summary_daily(target_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_user_ids uuid[];
  v_ef_url   text;
BEGIN
  SELECT array_agg(DISTINCT gm.user_id) INTO v_user_ids
  FROM public.ai_summaries s
  JOIN public.group_members gm ON gm.group_id = s.group_id
  WHERE s.date = target_date
    AND (gm.is_inactive IS NULL OR gm.is_inactive = false);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_ef_url FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

  PERFORM net.http_post(
    url := v_ef_url || '/send-push',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'title', '🤖 AI Summary Ready!',
      'body',  'The nightly roast for your group is in. Who got burned?',
      'url',   '/app.html#/ai-feed',
      'user_ids', v_user_ids
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notify_ai_summary_daily failed for %: %', target_date, SQLERRM;
END;
$function$;
