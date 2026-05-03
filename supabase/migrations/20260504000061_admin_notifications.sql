-- M61: Admin email notification system
-- Creates:
--   1. ef_errors table + RLS
--   2. app_events table + RLS
--   3. fn_notify_admin(p_type, p_data) — pg_net HTTP helper
--   4. 4 AFTER INSERT triggers: profiles, feedback, failed_summaries, ef_errors
--   5. fn_daily_admin_digest() — queries yesterday's data, fires daily_digest email
--   6. pg_cron job: admin-daily-digest at 08:00 UTC daily

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ef_errors
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.ef_errors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ef_name     text        NOT NULL,
  error_type  text        NOT NULL,
  error_msg   text        NOT NULL,
  context     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ef_errors_created_at ON public.ef_errors (created_at DESC);
CREATE INDEX idx_ef_errors_ef_name    ON public.ef_errors (ef_name, created_at DESC);

ALTER TABLE public.ef_errors ENABLE ROW LEVEL SECURITY;
-- No client policies — EFs write via service_role (bypasses RLS)

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. app_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.app_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,
  page        text,
  session_id  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_events_created_at    ON public.app_events (created_at DESC);
CREATE INDEX idx_app_events_user_session  ON public.app_events (user_id, session_id, created_at);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_events: authenticated insert own"
  ON public.app_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fn_notify_admin
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_notify_admin(
  p_type text,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ef_url text;
  v_srk    text;
BEGIN
  SELECT decrypted_secret INTO v_ef_url
    FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

  SELECT decrypted_secret INTO v_srk
    FROM vault.decrypted_secrets WHERE name = 'app_service_role_key';

  IF v_ef_url IS NULL OR v_srk IS NULL THEN
    RAISE WARNING 'fn_notify_admin: vault secrets missing, notification skipped (type=%)', p_type;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_ef_url || '/notify-admin',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_srk
               ),
    body    := jsonb_build_object('type', p_type, 'data', p_data)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_notify_admin(text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. Trigger: profiles → new_user
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_trigger_notify_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_notify_admin(
    'new_user',
    jsonb_build_object(
      'id',         NEW.id,
      'username',   NEW.username,
      'created_at', now()
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_user
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_trigger_notify_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. Trigger: feedback → feedback
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_trigger_notify_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_notify_admin(
    'feedback',
    row_to_json(NEW)::jsonb
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_feedback
  AFTER INSERT ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.fn_trigger_notify_feedback();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4c. Trigger: failed_summaries → failed_summary
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_trigger_notify_failed_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_notify_admin(
    'failed_summary',
    jsonb_build_object(
      'group_id',  NEW.group_id,
      'date',      NEW.date,
      'content',   NEW.content,
      'error_msg', NEW.error_msg,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_failed_summary
  AFTER INSERT ON public.failed_summaries
  FOR EACH ROW EXECUTE FUNCTION public.fn_trigger_notify_failed_summary();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4d. Trigger: ef_errors → ef_error
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_trigger_notify_ef_error()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_notify_admin(
    'ef_error',
    row_to_json(NEW)::jsonb
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_ef_error
  AFTER INSERT ON public.ef_errors
  FOR EACH ROW EXECUTE FUNCTION public.fn_trigger_notify_ef_error();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. fn_daily_admin_digest
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_daily_admin_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yesterday    date        := (now() AT TIME ZONE 'UTC')::date - 1;
  v_start        timestamptz := (v_yesterday::text || ' 00:00:00+00')::timestamptz;
  v_end          timestamptz := v_start + interval '1 day';

  v_games        jsonb;
  v_summ_created int;
  v_summ_failed  int;
  v_tokens_in    bigint;
  v_tokens_out   bigint;
  v_new_users    int;
  v_new_feedback int;
  v_ef_count     int;
  v_ef_list      jsonb;

  -- usage
  v_active_users   int;
  v_avg_session    numeric;
  v_peak_hour      int;
  v_peak_active    int;
  v_pred_actions   int;
  v_pick_actions   int;
  v_page_views     int;

  v_digest   jsonb;
  v_ef_url   text;
  v_srk      text;
BEGIN
  -- ── Per-game stats ──────────────────────────────────────────────────────────
  SELECT jsonb_agg(row_to_json(t))
  INTO v_games
  FROM (
    SELECT
      g.team_home,
      g.team_away,
      g.score_home,
      g.score_away,
      COUNT(p.id)                                                            AS total_preds,
      COUNT(*) FILTER (WHERE p.pred_home = g.score_home
                         AND p.pred_away = g.score_away)                    AS exact,
      COUNT(*) FILTER (WHERE
        (p.pred_home > p.pred_away AND g.score_home > g.score_away) OR
        (p.pred_home = p.pred_away AND g.score_home = g.score_away) OR
        (p.pred_home < p.pred_away AND g.score_home < g.score_away))        AS correct_outcome,
      COUNT(*) FILTER (WHERE p.is_auto = true)                              AS auto_preds
    FROM public.games g
    LEFT JOIN public.predictions p ON p.game_id = g.id
    WHERE g.kick_off_time >= v_start
      AND g.kick_off_time <  v_end
      AND g.score_home IS NOT NULL
      AND g.score_away IS NOT NULL
    GROUP BY g.id, g.team_home, g.team_away, g.score_home, g.score_away
    ORDER BY g.kick_off_time
  ) t;

  -- ── AI summaries ────────────────────────────────────────────────────────────
  SELECT
    COUNT(*),
    COALESCE(SUM(prompt_tokens),     0),
    COALESCE(SUM(completion_tokens), 0)
  INTO v_summ_created, v_tokens_in, v_tokens_out
  FROM public.ai_summaries
  WHERE generated_at >= v_start AND generated_at < v_end;

  SELECT COUNT(*) INTO v_summ_failed
  FROM public.failed_summaries
  WHERE created_at >= v_start AND created_at < v_end;

  -- ── New users (use auth.users.created_at — profiles has no timestamp) ───────
  SELECT COUNT(*) INTO v_new_users
  FROM public.profiles pr
  JOIN auth.users au ON au.id = pr.id
  WHERE au.created_at >= v_start AND au.created_at < v_end;

  -- ── Feedback ─────────────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_new_feedback
  FROM public.feedback
  WHERE created_at >= v_start AND created_at < v_end;

  -- ── EF errors ────────────────────────────────────────────────────────────────
  SELECT
    COUNT(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'ef_name',    ef_name,
          'error_type', error_type,
          'error_msg',  LEFT(error_msg, 120)
        ) ORDER BY created_at DESC
      ),
      '[]'::jsonb
    )
  INTO v_ef_count, v_ef_list
  FROM public.ef_errors
  WHERE created_at >= now() - interval '24 hours';

  -- ── App usage ─────────────────────────────────────────────────────────────────
  -- Active users + avg engaged session time (sessions ≥ 2 heartbeats only)
  WITH session_durations AS (
    SELECT
      user_id,
      session_id,
      EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) AS seconds
    FROM public.app_events
    WHERE event_type = 'heartbeat'
      AND created_at >= v_start
      AND created_at <  v_end
    GROUP BY user_id, session_id
    HAVING COUNT(*) >= 2  -- exclude single-heartbeat (< 15s) sessions
  ),
  user_totals AS (
    SELECT user_id, SUM(seconds) AS total_seconds
    FROM session_durations
    GROUP BY user_id
  )
  SELECT
    COUNT(*),
    AVG(total_seconds)
  INTO v_active_users, v_avg_session
  FROM user_totals;

  -- Peak hour
  SELECT
    EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int,
    COUNT(DISTINCT user_id)::int
  INTO v_peak_hour, v_peak_active
  FROM public.app_events
  WHERE created_at >= v_start AND created_at < v_end
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 1;

  -- Action counts
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'prediction_submit'),
    COUNT(*) FILTER (WHERE event_type = 'pick_submit'),
    COUNT(*) FILTER (WHERE event_type = 'page_view')
  INTO v_pred_actions, v_pick_actions, v_page_views
  FROM public.app_events
  WHERE created_at >= v_start AND created_at < v_end;

  -- ── Build digest payload ──────────────────────────────────────────────────────
  v_digest := jsonb_build_object(
    'digest_date',         v_yesterday::text,
    'games',               COALESCE(v_games, '[]'::jsonb),
    'summaries_created',   v_summ_created,
    'summaries_failed',    v_summ_failed,
    'tokens_in_total',     v_tokens_in,
    'tokens_out_total',    v_tokens_out,
    'new_users',           v_new_users,
    'new_feedback',        v_new_feedback,
    'ef_errors_count',     v_ef_count,
    'ef_errors_list',      v_ef_list,
    'active_users',        COALESCE(v_active_users, 0),
    'avg_session_seconds', COALESCE(v_avg_session,  0),
    'peak_hour',           v_peak_hour,
    'peak_active_users',   COALESCE(v_peak_active,  0),
    'prediction_actions',  COALESCE(v_pred_actions, 0),
    'pick_actions',        COALESCE(v_pick_actions, 0),
    'page_views',          COALESCE(v_page_views,   0)
  );

  -- ── Send via notify-admin EF ──────────────────────────────────────────────────
  SELECT decrypted_secret INTO v_ef_url
    FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';
  SELECT decrypted_secret INTO v_srk
    FROM vault.decrypted_secrets WHERE name = 'app_service_role_key';

  IF v_ef_url IS NULL OR v_srk IS NULL THEN
    RAISE WARNING 'fn_daily_admin_digest: vault secrets missing, digest skipped';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_ef_url || '/notify-admin',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_srk
               ),
    body    := jsonb_build_object('type', 'daily_digest', 'data', v_digest)
  );

  RAISE LOG 'fn_daily_admin_digest: digest sent for %', v_yesterday;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_daily_admin_digest() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. pg_cron job — daily digest at 08:00 UTC
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-daily-digest') THEN
    PERFORM cron.unschedule('admin-daily-digest');
  END IF;
END;
$$;

SELECT cron.schedule(
  'admin-daily-digest',
  '0 8 * * *',
  'SELECT public.fn_daily_admin_digest()'
);
