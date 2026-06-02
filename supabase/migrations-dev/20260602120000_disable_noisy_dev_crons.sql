-- target: dev-only
-- Disable all noisy dev cron jobs (push / OpenAI / api-football / odds / admin digest) so the DEV project makes ZERO external calls while it is used only for screen-recording demos. Keeps DB-only jobs (auto-predict, auto-assign-picks, cleanup-push-subs-daily).

-- 1) Admin daily digest email (notify-admin EF → Resend)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'admin-daily-digest';
END $$;

-- 2) Push / EF / API / odds scheduling jobs:
--    ai-summary daily (OpenAI + push), ai-summary-push, ai-summary-schedule-daily
--    (regenerator), ko-notif (push), trivia (push), af-odds-daily (odds API),
--    verify-game + sync-game (api-football). Pattern-based + idempotent — operates
--    only on currently-active matching jobs, so re-running is a safe no-op.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE active AND (
         jobname LIKE 'ai-summary-push-%'
      OR jobname LIKE 'ai-summary-2026-%'
      OR jobname = 'ai-summary-schedule-daily'
      OR jobname LIKE '%ko-notif%'
      OR jobname LIKE 'trivia%'
      OR jobname = 'af-odds-daily'
      OR jobname LIKE 'verify-game-%'
      OR jobname LIKE '%sync%'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;
