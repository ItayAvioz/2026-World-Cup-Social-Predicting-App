-- ================================================================
-- WORLDCUP 2026 — Feature: AI Summaries
-- Table: ai_summaries
-- Scheduling: one cron job per game-day, fires 110min after last kickoff
-- ================================================================


-- ----------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------

CREATE TABLE public.ai_summaries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  date              date        NOT NULL,   -- UTC date of the games covered
  content           text        NOT NULL,
  games_count       int         NOT NULL,   -- number of games played that day
  model             text        NOT NULL,   -- e.g. 'claude-sonnet-4-6'
  prompt_tokens     int,
  completion_tokens int,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, date)
);

CREATE INDEX ai_summaries_group_date_idx ON public.ai_summaries (group_id, date DESC);


-- ----------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------

ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;

-- Group members can read their group's summaries
CREATE POLICY "ai_summaries: members can select"
  ON public.ai_summaries FOR SELECT
  USING (public.is_group_member(group_id, auth.uid()));

-- Service role only for writes (Edge Function) — no client INSERT/UPDATE/DELETE


-- ----------------------------------------------------------------
-- 3. HELPER — build per-user stats for Edge Function prompt
--    Called by the Edge Function to get structured group data for a given date
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_group_summary_data(
  p_group_id  uuid,
  p_date      date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_games        jsonb;
  v_members      jsonb;
  v_leaderboard  jsonb;
BEGIN
  -- Games played on this date
  SELECT jsonb_agg(jsonb_build_object(
    'team_home',   g.team_home,
    'team_away',   g.team_away,
    'score_home',  g.score_home,
    'score_away',  g.score_away,
    'phase',       g.phase
  ) ORDER BY g.kick_off_time)
  INTO v_games
  FROM public.games g
  WHERE g.kick_off_time::date = p_date
    AND g.score_home IS NOT NULL;

  -- Per-member stats: predictions for this day + streak + exact score total
  SELECT jsonb_agg(member_data ORDER BY member_data->>'username')
  INTO v_members
  FROM (
    SELECT jsonb_build_object(
      'username',         p.username,
      'user_id',          p.id,

      -- Predictions for today's games
      'predictions',      (
        SELECT jsonb_agg(jsonb_build_object(
          'game_id',      pr.game_id,
          'pred_home',    pr.pred_home,
          'pred_away',    pr.pred_away,
          'points',       pr.points_earned,
          'is_auto',      pr.is_auto
        ))
        FROM public.predictions pr
        JOIN public.games g ON g.id = pr.game_id
        WHERE pr.user_id = p.id
          AND g.kick_off_time::date = p_date
          AND g.score_home IS NOT NULL
      ),

      -- Total exact scores ever
      'total_exact_scores', (
        SELECT COUNT(*)
        FROM public.predictions pr
        WHERE pr.user_id = p.id
          AND pr.points_earned = 3
      ),

      -- Current streak: positive = consecutive correct W/D/L, negative = consecutive wrong
      -- Computed from most recent finished games, ordered desc
      'current_streak', (
        WITH recent AS (
          SELECT
            pr.points_earned,
            ROW_NUMBER() OVER (ORDER BY g.kick_off_time DESC) AS rn
          FROM public.predictions pr
          JOIN public.games g ON g.id = pr.game_id
          WHERE pr.user_id = p.id
            AND g.score_home IS NOT NULL
          ORDER BY g.kick_off_time DESC
        ),
        streak_calc AS (
          -- Find how far back the current streak runs
          SELECT
            CASE WHEN (SELECT points_earned FROM recent WHERE rn = 1) >= 1
              THEN  (SELECT COUNT(*) FROM recent r
                     WHERE r.rn <= (
                       SELECT COALESCE(MIN(r2.rn) - 1, (SELECT MAX(rn) FROM recent))
                       FROM recent r2
                       WHERE r2.rn > 0 AND r2.points_earned = 0
                     ) AND r.points_earned >= 1)
              ELSE -(SELECT COUNT(*) FROM recent r
                     WHERE r.rn <= (
                       SELECT COALESCE(MIN(r2.rn) - 1, (SELECT MAX(rn) FROM recent))
                       FROM recent r2
                       WHERE r2.rn > 0 AND r2.points_earned >= 1
                     ) AND r.points_earned = 0)
            END AS streak
        )
        SELECT streak FROM streak_calc
      )
    ) AS member_data
    FROM public.profiles p
    JOIN public.group_members gm ON gm.user_id = p.id
    WHERE gm.group_id = p_group_id
  ) sub;

  -- Current group leaderboard
  SELECT jsonb_agg(jsonb_build_object(
    'group_rank',     gl.group_rank,
    'username',       gl.username,
    'total_points',   gl.total_points,
    'exact_scores',   gl.exact_scores
  ) ORDER BY gl.group_rank)
  INTO v_leaderboard
  FROM public.get_group_leaderboard(p_group_id) gl;

  RETURN jsonb_build_object(
    'group_id',   p_group_id,
    'date',       p_date,
    'games',      COALESCE(v_games, '[]'::jsonb),
    'members',    COALESCE(v_members, '[]'::jsonb),
    'leaderboard', COALESCE(v_leaderboard, '[]'::jsonb)
  );
END;
$$;


-- ----------------------------------------------------------------
-- 4. HELPER — W/D/L + score distribution per game (global across all users)
--    Called by Edge Function for prediction distribution stats
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_game_prediction_distribution(p_game_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_build_object(
    'total',        COUNT(*),
    'home_win',     COUNT(*) FILTER (WHERE pred_home > pred_away),
    'draw',         COUNT(*) FILTER (WHERE pred_home = pred_away),
    'away_win',     COUNT(*) FILTER (WHERE pred_home < pred_away),
    'exact_count',  COUNT(*) FILTER (WHERE points_earned = 3),
    'top_scores',   (
      SELECT jsonb_agg(s ORDER BY s->>'count' DESC)
      FROM (
        SELECT jsonb_build_object(
          'score', pred_home::text || '-' || pred_away::text,
          'count', COUNT(*)
        ) AS s
        FROM public.predictions
        WHERE game_id = p_game_id
        GROUP BY pred_home, pred_away
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) top
    )
  )
  FROM public.predictions
  WHERE game_id = p_game_id;
$$;


-- ----------------------------------------------------------------
-- 5. SCHEDULE — one cron job per game-day, fires 110min after last kickoff
--    Run once after games table is seeded
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_schedule_ai_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_day       record;
  v_fire_at   timestamptz;
  v_cron      text;
  v_job_name  text;
BEGIN
  -- One cron per distinct UTC game-day, based on last kickoff + 110 min
  FOR v_day IN
    SELECT
      kick_off_time::date AS game_date,
      MAX(kick_off_time)  AS last_kickoff
    FROM public.games
    GROUP BY kick_off_time::date
    ORDER BY kick_off_time::date
  LOOP
    v_fire_at  := v_day.last_kickoff + interval '110 minutes';
    v_job_name := 'ai-summary-' || v_day.game_date::text;

    v_cron :=
      EXTRACT(MINUTE FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_fire_at AT TIME ZONE 'UTC')::int || ' *';

    PERFORM cron.schedule(
      v_job_name,
      v_cron,
      -- Calls the Edge Function via pg_net (wired up in the Edge Function session)
      format(
        'SELECT net.http_post(
            url := current_setting(''app.edge_function_url'') || ''/nightly-summary'',
            headers := jsonb_build_object(
              ''Content-Type'', ''application/json'',
              ''Authorization'', ''Bearer '' || current_setting(''app.service_role_key'')
            ),
            body := jsonb_build_object(''date'', %L)::text
          )',
        v_day.game_date
      )
    );
  END LOOP;
END;
$$;

-- NOTE: Do NOT call fn_schedule_ai_summaries() here.
-- Call it manually after the Edge Function URL and service role key
-- are set as Supabase secrets / app.settings in a new session.
