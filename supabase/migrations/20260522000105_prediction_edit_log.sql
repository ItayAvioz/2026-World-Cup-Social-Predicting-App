-- M105: Track every prediction edit (same-day + multiple edits per prediction).
-- Before: digest's "edits" counted only cross-day modifications (submitted earlier day,
--   changed yesterday) and could count at most 1 per prediction (table stores final row only).
--   Same-day submit+edit always showed edits=0.
-- After: append-only prediction_edit_log captures EVERY manual prediction value change.
--   Trigger logs only manual predictions and only when pred_home/pred_away actually changes
--   (ignores the score-sync points_earned bump that touches updated_at).

CREATE TABLE IF NOT EXISTS public.prediction_edit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  game_id    uuid NOT NULL,
  group_id   uuid,
  pred_home  int  NOT NULL,
  pred_away  int  NOT NULL,
  is_initial boolean NOT NULL,   -- true = first submission, false = a subsequent edit
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pred_edit_log_changed_at ON public.prediction_edit_log(changed_at);

-- Internal analytics only — no anon/authenticated access. Service role + SECURITY DEFINER bypass RLS.
ALTER TABLE public.prediction_edit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_log_prediction_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.is_auto IS TRUE THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.prediction_edit_log (user_id, game_id, group_id, pred_home, pred_away, is_initial)
    VALUES (NEW.user_id, NEW.game_id, NEW.group_id, NEW.pred_home, NEW.pred_away, true);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.pred_home IS DISTINCT FROM OLD.pred_home OR NEW.pred_away IS DISTINCT FROM OLD.pred_away THEN
      INSERT INTO public.prediction_edit_log (user_id, game_id, group_id, pred_home, pred_away, is_initial)
      VALUES (NEW.user_id, NEW.game_id, NEW.group_id, NEW.pred_home, NEW.pred_away, false);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_prediction_edit ON public.predictions;
CREATE TRIGGER trg_log_prediction_edit
AFTER INSERT OR UPDATE ON public.predictions
FOR EACH ROW EXECUTE FUNCTION public.fn_log_prediction_edit();

-- Repoint the daily digest's prediction metrics at the edit log.
-- pred_total = new manual predictions yesterday; pred_edits = edit actions yesterday (every change).
CREATE OR REPLACE FUNCTION public.fn_daily_admin_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_yesterday    date        := (now() AT TIME ZONE 'UTC')::date - 1;
  v_start        timestamptz := (v_yesterday::text || ' 00:00:00+00')::timestamptz;
  v_end          timestamptz := v_start + interval '1 day';
  v_games        jsonb; v_summ_created int; v_summ_failed int;
  v_tokens_in    bigint; v_tokens_out bigint;
  v_new_users    int; v_new_feedback int;
  v_ef_count     int; v_ef_list jsonb;
  v_active_users int; v_avg_session numeric;
  v_peak_hour    int; v_peak_active int;
  v_pred_total   int; v_pred_edits  int; v_pred_users int; v_pred_games int; v_pred_groups int;
  v_champ_total  int; v_champ_edits int; v_champ_users int; v_champ_groups int;
  v_scorer_total int; v_scorer_edits int; v_scorer_users int; v_scorer_groups int;
  v_page_views   int; v_share_clicks int;
  v_judge_runs   int;
  v_judge_v11_wins int; v_judge_v12_wins int; v_judge_v13_wins int;
  v_judge_v10_wins int; v_judge_v10b_wins int;
  v_digest jsonb; v_ef_url text; v_srk text;
BEGIN
  SELECT jsonb_agg(row_to_json(t)) INTO v_games FROM (
    SELECT g.team_home, g.team_away, g.score_home, g.score_away,
      COUNT(p.id) AS total_preds,
      COUNT(*) FILTER (WHERE p.is_auto = false OR p.is_auto IS NULL) AS manual_preds,
      COUNT(*) FILTER (WHERE p.is_auto = true) AS auto_preds,
      COUNT(*) FILTER (WHERE p.pred_home = g.score_home AND p.pred_away = g.score_away) AS exact_total,
      COUNT(*) FILTER (WHERE
        (p.pred_home > p.pred_away AND g.score_home > g.score_away) OR
        (p.pred_home = p.pred_away AND g.score_home = g.score_away) OR
        (p.pred_home < p.pred_away AND g.score_home < g.score_away)) AS correct_outcome_total,
      COUNT(*) FILTER (WHERE p.is_auto = true AND p.pred_home = g.score_home AND p.pred_away = g.score_away) AS auto_exact,
      COUNT(*) FILTER (WHERE p.is_auto = true AND (
        (p.pred_home > p.pred_away AND g.score_home > g.score_away) OR
        (p.pred_home = p.pred_away AND g.score_home = g.score_away) OR
        (p.pred_home < p.pred_away AND g.score_home < g.score_away))) AS auto_correct
    FROM public.games g LEFT JOIN public.predictions p ON p.game_id = g.id
    WHERE g.kick_off_time >= v_start AND g.kick_off_time < v_end
      AND g.score_home IS NOT NULL AND g.score_away IS NOT NULL
    GROUP BY g.id, g.team_home, g.team_away, g.score_home, g.score_away
    ORDER BY g.kick_off_time
  ) t;

  SELECT COUNT(*), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0)
  INTO v_summ_created, v_tokens_in, v_tokens_out
  FROM public.ai_summaries WHERE generated_at >= v_start AND generated_at < v_end;

  SELECT COUNT(*) INTO v_summ_failed FROM public.failed_summaries WHERE created_at >= v_start AND created_at < v_end;

  SELECT COUNT(*) INTO v_new_users FROM public.profiles pr JOIN auth.users au ON au.id = pr.id
  WHERE au.created_at >= v_start AND au.created_at < v_end;

  SELECT COUNT(*) INTO v_new_feedback FROM public.feedback WHERE created_at >= v_start AND created_at < v_end;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object('ef_name',ef_name,'error_type',error_type,'error_msg',LEFT(error_msg,120)) ORDER BY created_at DESC),'[]'::jsonb)
  INTO v_ef_count, v_ef_list FROM public.ef_errors WHERE created_at >= now() - interval '24 hours';

  WITH session_durations AS (
    SELECT user_id, session_id, COUNT(*) * 15.0 AS seconds
    FROM public.app_events WHERE event_type = 'heartbeat' AND created_at >= v_start AND created_at < v_end
    GROUP BY user_id, session_id HAVING COUNT(*) >= 2
  ), user_totals AS (
    SELECT user_id, SUM(seconds) AS total_seconds FROM session_durations GROUP BY user_id
  )
  SELECT COUNT(*), AVG(total_seconds) INTO v_active_users, v_avg_session FROM user_totals;

  SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Jerusalem')::int, COUNT(DISTINCT user_id)::int
  INTO v_peak_hour, v_peak_active
  FROM public.app_events WHERE created_at >= v_start AND created_at < v_end
  GROUP BY 1 ORDER BY 2 DESC LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE event_type='share_click'),
    COUNT(*) FILTER (WHERE event_type='page_view')
  INTO v_share_clicks, v_page_views
  FROM public.app_events WHERE created_at >= v_start AND created_at < v_end;

  -- Predictions — from prediction_edit_log (M105): counts every manual edit action, same-day included.
  SELECT
    COUNT(*) FILTER (WHERE is_initial),
    COUNT(*) FILTER (WHERE NOT is_initial),
    COUNT(DISTINCT user_id),
    COUNT(DISTINCT game_id),
    COUNT(DISTINCT group_id)
  INTO v_pred_total, v_pred_edits, v_pred_users, v_pred_games, v_pred_groups
  FROM public.prediction_edit_log
  WHERE changed_at >= v_start AND changed_at < v_end;

  -- Champion picks (unchanged cross-day heuristic)
  SELECT
    COUNT(*) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND (
      (submitted_at >= v_start AND submitted_at < v_end) OR
      (updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start)
    )),
    COUNT(*) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND
      updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start),
    COUNT(DISTINCT user_id) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND (
      (submitted_at >= v_start AND submitted_at < v_end) OR
      (updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start)
    )),
    COUNT(DISTINCT group_id) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND (
      (submitted_at >= v_start AND submitted_at < v_end) OR
      (updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start)
    ))
  INTO v_champ_total, v_champ_edits, v_champ_users, v_champ_groups
  FROM public.champion_pick;

  -- Top scorer picks (unchanged cross-day heuristic)
  SELECT
    COUNT(*) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND (
      (submitted_at >= v_start AND submitted_at < v_end) OR
      (updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start)
    )),
    COUNT(*) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND
      updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start),
    COUNT(DISTINCT user_id) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND (
      (submitted_at >= v_start AND submitted_at < v_end) OR
      (updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start)
    )),
    COUNT(DISTINCT group_id) FILTER (WHERE (is_auto = false OR is_auto IS NULL) AND (
      (submitted_at >= v_start AND submitted_at < v_end) OR
      (updated_at >= v_start AND updated_at < v_end AND submitted_at < v_start)
    ))
  INTO v_scorer_total, v_scorer_edits, v_scorer_users, v_scorer_groups
  FROM public.top_scorer_pick;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE winner_agent = 1),
    COUNT(*) FILTER (WHERE winner_agent = 2),
    COUNT(*) FILTER (WHERE winner_agent = 3),
    COUNT(*) FILTER (WHERE winner_agent = 4),
    COUNT(*) FILTER (WHERE winner_agent = 5)
  INTO v_judge_runs, v_judge_v11_wins, v_judge_v12_wins, v_judge_v13_wins, v_judge_v10_wins, v_judge_v10b_wins
  FROM public.ai_judge_runs WHERE date = v_yesterday;

  v_digest := jsonb_build_object(
    'digest_date', v_yesterday::text, 'games', COALESCE(v_games,'[]'::jsonb),
    'summaries_created', v_summ_created, 'summaries_failed', v_summ_failed,
    'tokens_in_total', v_tokens_in, 'tokens_out_total', v_tokens_out,
    'new_users', v_new_users, 'new_feedback', v_new_feedback,
    'ef_errors_count', v_ef_count, 'ef_errors_list', v_ef_list,
    'active_users', COALESCE(v_active_users,0), 'avg_session_seconds', COALESCE(v_avg_session,0),
    'peak_hour', v_peak_hour, 'peak_active_users', COALESCE(v_peak_active,0),
    'pred_total',   COALESCE(v_pred_total,0),
    'pred_edits',   COALESCE(v_pred_edits,0),
    'pred_users',   COALESCE(v_pred_users,0),
    'pred_games',   COALESCE(v_pred_games,0),
    'pred_groups',  COALESCE(v_pred_groups,0),
    'champ_total',  COALESCE(v_champ_total,0),
    'champ_edits',  COALESCE(v_champ_edits,0),
    'champ_users',  COALESCE(v_champ_users,0),
    'champ_groups', COALESCE(v_champ_groups,0),
    'scorer_total',  COALESCE(v_scorer_total,0),
    'scorer_edits',  COALESCE(v_scorer_edits,0),
    'scorer_users',  COALESCE(v_scorer_users,0),
    'scorer_groups', COALESCE(v_scorer_groups,0),
    'share_clicks', COALESCE(v_share_clicks,0), 'page_views', COALESCE(v_page_views,0),
    'judge_runs', COALESCE(v_judge_runs,0),
    'judge_v11_wins', COALESCE(v_judge_v11_wins,0),
    'judge_v12_wins', COALESCE(v_judge_v12_wins,0),
    'judge_v13_wins', COALESCE(v_judge_v13_wins,0),
    'judge_v10_wins', COALESCE(v_judge_v10_wins,0),
    'judge_v10b_wins', COALESCE(v_judge_v10b_wins,0)
  );

  SELECT decrypted_secret INTO v_ef_url FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';
  SELECT decrypted_secret INTO v_srk    FROM vault.decrypted_secrets WHERE name = 'app_service_role_key';
  IF v_ef_url IS NULL OR v_srk IS NULL THEN RAISE WARNING 'fn_daily_admin_digest: vault secrets missing'; RETURN; END IF;

  PERFORM net.http_post(
    url     := v_ef_url || '/notify-admin',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_srk),
    body    := jsonb_build_object('type','daily_digest','data',v_digest)
  );
  RAISE LOG 'fn_daily_admin_digest: digest sent for %', v_yesterday;
END;
$function$;
