-- M109: guard fn_notify_trivia() so it only pushes when a question is actually open.
-- The trivia-push-daily cron (0 19 * * *) runs forever with no end; before this, fn_notify_trivia
-- POSTed "Trivia Time!" every night unconditionally → endless spam after the last question
-- (2026-07-21) + false pushes on any gap day. The EXISTS guard makes the cron a no-op when nothing
-- is open, and naturally fires for test questions too (data-driven, no hard-coded dates).
-- ONLY the IF EXISTS wrapper is added — the net.http_post (title/body/url) is unchanged.

CREATE OR REPLACE FUNCTION public.fn_notify_trivia()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trivia_questions
    WHERE available_from <= now() AND available_until > now()
  ) THEN
    PERFORM net.http_post(
      url := 'https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/send-push',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"title":"🧠 Trivia Time!","body":"Tonight''s question is now open. Can you get it right?","url":"/2026-World-Cup-Social-Predicting-App/app.html#/trivia"}'::jsonb
    );
  END IF;
END;
$function$;
