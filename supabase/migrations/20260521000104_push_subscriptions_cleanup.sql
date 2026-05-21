-- M103: Clean up stale push_subscriptions + daily cleanup cron.
-- Apple PWA APNS tokens rotate silently every 1-2 weeks without 410 Gone responses.
-- Dani had 7 stacked iOS subs — most are dead but the EF still tries them, wasting APNS budget
-- and exposing single-push architectures (M101) to silent drops.
-- Strategy: keep latest 2 subscriptions per user (primary + rotation-transition backup).
-- Daily cron prunes new accumulations.

CREATE OR REPLACE FUNCTION public.fn_cleanup_push_subscriptions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
    FROM public.push_subscriptions
  )
  DELETE FROM public.push_subscriptions
  WHERE id IN (SELECT id FROM ranked WHERE rn > 2);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'fn_cleanup_push_subscriptions deleted % stale rows', v_deleted;
END;
$$;

-- One-time backfill: prune existing stacked subs (e.g. Dani 7 → 2)
SELECT public.fn_cleanup_push_subscriptions();

-- Daily cleanup at 03:00 UTC
SELECT cron.schedule(
  'cleanup-push-subs-daily',
  '0 3 * * *',
  'SELECT public.fn_cleanup_push_subscriptions()'
);
