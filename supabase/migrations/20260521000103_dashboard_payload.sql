-- M103: get_dashboard_payload() — consolidates Dashboard's 13 separate queries
-- into one RPC. Returns a single JSONB so the Dashboard mounts with one round-trip.
--
-- Runs with caller privileges (no SECURITY DEFINER) — every subquery is filtered
-- by the same RLS as the existing per-query calls in Dashboard.jsx.

CREATE OR REPLACE FUNCTION public.get_dashboard_payload()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid := auth.uid();
  v_today             date := (now() AT TIME ZONE 'UTC')::date;
  v_groups            jsonb;
  v_leaderboard       jsonb;
  v_group_ranks       jsonb;
  v_champion_picks    jsonb;
  v_top_scorer_picks  jsonb;
  v_predictions       jsonb;
  v_finished_games    jsonb;
  v_team_stats        jsonb;
  v_team_recent_games jsonb;
  v_day_games         jsonb;
  v_day_preds         jsonb;
  v_day_date          date;
  v_champ_teams       text[];
  v_day_game_ids      uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 1. User's groups (RLS filters to memberships)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.created_at), '[]'::jsonb)
  INTO v_groups
  FROM groups g
  WHERE EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = v_user_id);

  -- 2. Global leaderboard
  SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  INTO v_leaderboard
  FROM get_leaderboard() l;

  -- 3. Per-group ranks for current user (one LATERAL call per group)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'groupId',    g.id,
    'groupName',  g.name,
    'groupRank',  gl.group_rank,
    'globalRank', gl.global_rank
  ) ORDER BY g.created_at), '[]'::jsonb)
  INTO v_group_ranks
  FROM groups g
  JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = v_user_id
  LEFT JOIN LATERAL (
    SELECT group_rank, global_rank
    FROM get_group_leaderboard(g.id)
    WHERE user_id = v_user_id
    LIMIT 1
  ) gl ON true;

  -- 4. Champion picks
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team', team, 'group_id', group_id, 'is_auto', is_auto
  )), '[]'::jsonb)
  INTO v_champion_picks
  FROM champion_pick WHERE user_id = v_user_id;

  -- 5. Top scorer picks
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_name', player_name, 'group_id', group_id, 'is_auto', is_auto
  )), '[]'::jsonb)
  INTO v_top_scorer_picks
  FROM top_scorer_pick WHERE user_id = v_user_id;

  -- 6. User's predictions (only their own — same RLS as today)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'game_id',       game_id,
    'group_id',      group_id,
    'pred_home',     pred_home,
    'pred_away',     pred_away,
    'points_earned', points_earned,
    'is_auto',       is_auto
  )), '[]'::jsonb)
  INTO v_predictions
  FROM predictions WHERE user_id = v_user_id;

  -- 7. Finished games >= 2026-04-11 (matches Dashboard's stats window)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',            id,
    'score_home',    score_home,
    'score_away',    score_away,
    'kick_off_time', kick_off_time
  ) ORDER BY kick_off_time, id DESC), '[]'::jsonb)
  INTO v_finished_games
  FROM (
    SELECT id, score_home, score_away, kick_off_time
    FROM games
    WHERE score_home IS NOT NULL
      AND kick_off_time >= '2026-04-11T00:00:00Z'::timestamptz
    ORDER BY kick_off_time, id DESC
    LIMIT 150
  ) fg;

  -- 8. Champion teams (deduped) for team stats + streak calc
  SELECT array_agg(DISTINCT champion_team)
  INTO v_champ_teams
  FROM jsonb_to_recordset(v_leaderboard) AS x(champion_team text)
  WHERE champion_team IS NOT NULL;

  IF v_champ_teams IS NOT NULL AND array_length(v_champ_teams, 1) > 0 THEN
    -- 9. team_tournament_stats for those teams
    SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    INTO v_team_stats
    FROM team_tournament_stats s
    WHERE team = ANY(v_champ_teams);

    -- 10. Finished games involving any champion team (for streaks)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'team_home',     team_home,
      'team_away',     team_away,
      'score_home',    score_home,
      'score_away',    score_away,
      'kick_off_time', kick_off_time
    ) ORDER BY kick_off_time DESC), '[]'::jsonb)
    INTO v_team_recent_games
    FROM games
    WHERE score_home IS NOT NULL
      AND (team_home = ANY(v_champ_teams) OR team_away = ANY(v_champ_teams));
  ELSE
    v_team_stats        := '[]'::jsonb;
    v_team_recent_games := '[]'::jsonb;
  END IF;

  -- 11. Day games — today if any unfinished, else next future day
  IF EXISTS (
    SELECT 1 FROM games
    WHERE kick_off_time::date = v_today AND score_home IS NULL
  ) THEN
    v_day_date := v_today;
  ELSE
    SELECT MIN(kick_off_time::date)
    INTO v_day_date
    FROM games
    WHERE kick_off_time::date > v_today;
  END IF;

  IF v_day_date IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',                    id,
      'team_home',             team_home,
      'team_away',             team_away,
      'kick_off_time',         kick_off_time,
      'score_home',            score_home,
      'score_away',            score_away,
      'phase',                 phase,
      'went_to_extra_time',    went_to_extra_time,
      'et_score_home',         et_score_home,
      'et_score_away',         et_score_away,
      'went_to_penalties',     went_to_penalties,
      'penalty_score_home',    penalty_score_home,
      'penalty_score_away',    penalty_score_away
    ) ORDER BY kick_off_time), '[]'::jsonb)
    INTO v_day_games
    FROM games
    WHERE kick_off_time::date = v_day_date;
  ELSE
    v_day_games := '[]'::jsonb;
  END IF;

  -- 12. User's predictions for day games
  IF jsonb_array_length(v_day_games) > 0 THEN
    SELECT array_agg((g->>'id')::uuid)
    INTO v_day_game_ids
    FROM jsonb_array_elements(v_day_games) g;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'game_id',   game_id,
      'group_id',  group_id,
      'pred_home', pred_home,
      'pred_away', pred_away
    )), '[]'::jsonb)
    INTO v_day_preds
    FROM predictions
    WHERE user_id = v_user_id AND game_id = ANY(v_day_game_ids);
  ELSE
    v_day_preds := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'groups',            v_groups,
    'leaderboard',       v_leaderboard,
    'group_ranks',       v_group_ranks,
    'champion_picks',    v_champion_picks,
    'top_scorer_picks',  v_top_scorer_picks,
    'predictions',       v_predictions,
    'finished_games',    v_finished_games,
    'team_stats',        v_team_stats,
    'team_recent_games', v_team_recent_games,
    'day_games',         v_day_games,
    'day_date',          v_day_date,
    'day_preds',         v_day_preds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_payload() TO authenticated;
