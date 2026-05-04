-- M63: Add v10 as baseline agent in Judge LLM system
-- · Add 'baseline' to agent_slot CHECK on prompt_versions
-- · Move v10 from agent_slot='main' → agent_slot='baseline'
-- · Update winner_agent CHECK on ai_judge_runs and ai_summaries (1→4)
-- · Update fn_daily_admin_digest to include v10-baseline wins

-- ─── Constraints ─────────────────────────────────────────────────────────────

ALTER TABLE public.prompt_versions
  DROP CONSTRAINT IF EXISTS prompt_versions_agent_slot_check;
ALTER TABLE public.prompt_versions
  ADD CONSTRAINT prompt_versions_agent_slot_check
  CHECK (agent_slot IN ('baseline','main','candidate_2','candidate_3'));

UPDATE public.prompt_versions
  SET agent_slot = 'baseline'
  WHERE id = 'e7593ac1-0290-4cfb-95c3-7d9c38b3a925';

ALTER TABLE public.ai_judge_runs
  DROP CONSTRAINT IF EXISTS ai_judge_runs_winner_agent_check;
ALTER TABLE public.ai_judge_runs
  ADD CONSTRAINT ai_judge_runs_winner_agent_check
  CHECK (winner_agent BETWEEN 1 AND 4);

ALTER TABLE public.ai_summaries
  DROP CONSTRAINT IF EXISTS ai_summaries_winner_agent_check;
ALTER TABLE public.ai_summaries
  ADD CONSTRAINT ai_summaries_winner_agent_check
  CHECK (winner_agent BETWEEN 1 AND 4);

-- ─── fn_daily_admin_digest (add v10-baseline wins) ───────────────────────────

CREATE OR REPLACE FUNCTION public.fn_daily_admin_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_pred_actions int; v_pick_actions int; v_page_views int;
  v_judge_runs   int;
  v_judge_v11_wins int; v_judge_v12_wins int; v_judge_v13_wins int; v_judge_v10_wins int;
  v_digest jsonb; v_ef_url text; v_srk text;
BEGIN
  SELECT jsonb_agg(row_to_json(t)) INTO v_games FROM (
    SELECT g.team_home, g.team_away, g.score_home, g.score_away,
      COUNT(p.id) AS total_preds,
      COUNT(*) FILTER (WHERE p.pred_home = g.score_home AND p.pred_away = g.score_away) AS exact,
      COUNT(*) FILTER (WHERE
        (p.pred_home > p.pred_away AND g.score_home > g.score_away) OR
        (p.pred_home = p.pred_away AND g.score_home = g.score_away) OR
        (p.pred_home < p.pred_away AND g.score_home < g.score_away)) AS correct_outcome,
      COUNT(*) FILTER (WHERE p.is_auto = true) AS auto_preds
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
    SELECT user_id, session_id, EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) AS seconds
    FROM public.app_events WHERE event_type = 'heartbeat' AND created_at >= v_start AND created_at < v_end
    GROUP BY user_id, session_id HAVING COUNT(*) >= 2
  ), user_totals AS (
    SELECT user_id, SUM(seconds) AS total_seconds FROM session_durations GROUP BY user_id
  )
  SELECT COUNT(*), AVG(total_seconds) INTO v_active_users, v_avg_session FROM user_totals;

  SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int, COUNT(DISTINCT user_id)::int
  INTO v_peak_hour, v_peak_active
  FROM public.app_events WHERE created_at >= v_start AND created_at < v_end
  GROUP BY 1 ORDER BY 2 DESC LIMIT 1;

  SELECT COUNT(*) FILTER (WHERE event_type='prediction_submit'),
         COUNT(*) FILTER (WHERE event_type='pick_submit'),
         COUNT(*) FILTER (WHERE event_type='page_view')
  INTO v_pred_actions, v_pick_actions, v_page_views
  FROM public.app_events WHERE created_at >= v_start AND created_at < v_end;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE winner_agent = 1),
    COUNT(*) FILTER (WHERE winner_agent = 2),
    COUNT(*) FILTER (WHERE winner_agent = 3),
    COUNT(*) FILTER (WHERE winner_agent = 4)
  INTO v_judge_runs, v_judge_v11_wins, v_judge_v12_wins, v_judge_v13_wins, v_judge_v10_wins
  FROM public.ai_judge_runs WHERE date = v_yesterday;

  v_digest := jsonb_build_object(
    'digest_date', v_yesterday::text, 'games', COALESCE(v_games,'[]'::jsonb),
    'summaries_created', v_summ_created, 'summaries_failed', v_summ_failed,
    'tokens_in_total', v_tokens_in, 'tokens_out_total', v_tokens_out,
    'new_users', v_new_users, 'new_feedback', v_new_feedback,
    'ef_errors_count', v_ef_count, 'ef_errors_list', v_ef_list,
    'active_users', COALESCE(v_active_users,0), 'avg_session_seconds', COALESCE(v_avg_session,0),
    'peak_hour', v_peak_hour, 'peak_active_users', COALESCE(v_peak_active,0),
    'prediction_actions', COALESCE(v_pred_actions,0), 'pick_actions', COALESCE(v_pick_actions,0),
    'page_views', COALESCE(v_page_views,0),
    'judge_runs', COALESCE(v_judge_runs,0),
    'judge_v11_wins', COALESCE(v_judge_v11_wins,0),
    'judge_v12_wins', COALESCE(v_judge_v12_wins,0),
    'judge_v13_wins', COALESCE(v_judge_v13_wins,0),
    'judge_v10_wins', COALESCE(v_judge_v10_wins,0)
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
$$;
