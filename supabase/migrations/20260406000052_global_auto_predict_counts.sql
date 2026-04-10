-- Migration 52: Fix auto-predict + auto-assign picks to use global counts (all users, not per group)
-- fn_auto_predict_game: W/D/L count is now global across all predictions for the game
-- fn_auto_assign_picks: champion + top scorer least-picked count is now global across all groups

CREATE OR REPLACE FUNCTION public.fn_auto_predict_game(p_game_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_combo   record;
  v_user_id uuid;
  v_home    int;
  v_away    int;
  v_hw      bigint;
  v_dr      bigint;
  v_aw      bigint;
  v_min_val bigint;
  v_outcome text;
BEGIN
  -- Count W/D/L globally across ALL users for this game
  SELECT
    COUNT(*) FILTER (WHERE pred_home > pred_away),
    COUNT(*) FILTER (WHERE pred_home = pred_away),
    COUNT(*) FILTER (WHERE pred_home < pred_away)
  INTO v_hw, v_dr, v_aw
  FROM public.predictions
  WHERE game_id = p_game_id;

  v_min_val := LEAST(v_hw, v_dr, v_aw);
  IF    v_aw = v_min_val THEN v_outcome := 'away_win';
  ELSIF v_dr = v_min_val THEN v_outcome := 'draw';
  ELSE                        v_outcome := 'home_win';
  END IF;

  -- GROUPED USERS
  FOR v_combo IN
    SELECT DISTINCT gm.user_id, gm.group_id
    FROM public.group_members gm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.predictions pr
      WHERE pr.user_id  = gm.user_id
        AND pr.game_id  = p_game_id
        AND pr.group_id = gm.group_id
    )
  LOOP
    IF v_outcome = 'draw' THEN
      v_home := floor(random() * 6)::int;
      v_away := v_home;
    ELSIF v_outcome = 'home_win' THEN
      v_home := floor(random() * 5)::int + 1;
      v_away := floor(random() * v_home)::int;
    ELSE
      v_away := floor(random() * 5)::int + 1;
      v_home := floor(random() * v_away)::int;
    END IF;

    INSERT INTO public.predictions (user_id, game_id, group_id, pred_home, pred_away, is_auto)
    VALUES (v_combo.user_id, p_game_id, v_combo.group_id, v_home, v_away, true)
    ON CONFLICT (user_id, game_id, group_id) DO NOTHING;
  END LOOP;

  -- UNGROUPED USERS
  FOR v_user_id IN
    SELECT p.id FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.user_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.predictions pr
        WHERE pr.user_id = p.id AND pr.game_id = p_game_id AND pr.group_id IS NULL
      )
  LOOP
    IF v_outcome = 'draw' THEN
      v_home := floor(random() * 6)::int;
      v_away := v_home;
    ELSIF v_outcome = 'home_win' THEN
      v_home := floor(random() * 5)::int + 1;
      v_away := floor(random() * v_home)::int;
    ELSE
      v_away := floor(random() * 5)::int + 1;
      v_home := floor(random() * v_away)::int;
    END IF;

    INSERT INTO public.predictions (user_id, game_id, group_id, pred_home, pred_away, is_auto)
    VALUES (v_user_id, p_game_id, NULL, v_home, v_away, true)
    ON CONFLICT ON CONSTRAINT predictions_user_game_group_unique DO NOTHING;
  END LOOP;

  PERFORM cron.unschedule('auto-predict-' || p_game_id::text);
END;
$$;


CREATE OR REPLACE FUNCTION public.fn_auto_assign_picks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_combo    record;
  v_uid      uuid;
  v_champion text;
  v_player   record;
BEGIN
  -- CHAMPION PICKS — grouped users
  FOR v_combo IN
    SELECT gm.user_id, gm.group_id
    FROM public.group_members gm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.champion_pick cp
      WHERE cp.user_id = gm.user_id AND cp.group_id = gm.group_id
    )
  LOOP
    SELECT t.name INTO v_champion
    FROM public.teams t
    LEFT JOIN (
      SELECT team, COUNT(*) AS cnt
      FROM public.champion_pick
      GROUP BY team  -- global across all groups
    ) cc ON cc.team = t.name
    WHERE t.is_tbd = false
    ORDER BY COALESCE(cc.cnt, 0) ASC, random()
    LIMIT 1;

    INSERT INTO public.champion_pick (user_id, group_id, team, is_auto)
    VALUES (v_combo.user_id, v_combo.group_id, v_champion, true)
    ON CONFLICT ON CONSTRAINT champion_pick_user_group_unique DO NOTHING;
  END LOOP;

  -- CHAMPION PICKS — ungrouped users
  FOR v_uid IN
    SELECT p.id FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.group_members WHERE user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.champion_pick WHERE user_id = p.id AND group_id IS NULL)
  LOOP
    SELECT t.name INTO v_champion
    FROM public.teams t
    LEFT JOIN (
      SELECT team, COUNT(*) AS cnt FROM public.champion_pick
      GROUP BY team  -- global
    ) cc ON cc.team = t.name
    WHERE t.is_tbd = false
    ORDER BY COALESCE(cc.cnt, 0) ASC, random()
    LIMIT 1;

    INSERT INTO public.champion_pick (user_id, group_id, team, is_auto)
    VALUES (v_uid, NULL, v_champion, true)
    ON CONFLICT ON CONSTRAINT champion_pick_user_group_unique DO NOTHING;
  END LOOP;

  -- TOP SCORER PICKS — grouped users
  FOR v_combo IN
    SELECT gm.user_id, gm.group_id
    FROM public.group_members gm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.top_scorer_pick ts
      WHERE ts.user_id = gm.user_id AND ts.group_id = gm.group_id
    )
  LOOP
    SELECT tsc.name, tsc.api_player_id INTO v_player
    FROM public.top_scorer_candidates tsc
    LEFT JOIN (
      SELECT player_name, COUNT(*) AS cnt FROM public.top_scorer_pick
      GROUP BY player_name  -- global across all groups
    ) pc ON pc.player_name = tsc.name
    WHERE tsc.is_active = true
    ORDER BY COALESCE(pc.cnt, 0) ASC, random()
    LIMIT 1;

    INSERT INTO public.top_scorer_pick (user_id, group_id, player_name, top_scorer_api_id, is_auto)
    VALUES (v_combo.user_id, v_combo.group_id, v_player.name, v_player.api_player_id, true)
    ON CONFLICT ON CONSTRAINT top_scorer_pick_user_group_unique DO NOTHING;
  END LOOP;

  -- TOP SCORER PICKS — ungrouped users
  FOR v_uid IN
    SELECT p.id FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.group_members WHERE user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.top_scorer_pick WHERE user_id = p.id AND group_id IS NULL)
  LOOP
    SELECT tsc.name, tsc.api_player_id INTO v_player
    FROM public.top_scorer_candidates tsc
    LEFT JOIN (
      SELECT player_name, COUNT(*) AS cnt FROM public.top_scorer_pick
      GROUP BY player_name  -- global
    ) pc ON pc.player_name = tsc.name
    WHERE tsc.is_active = true
    ORDER BY COALESCE(pc.cnt, 0) ASC, random()
    LIMIT 1;

    INSERT INTO public.top_scorer_pick (user_id, group_id, player_name, top_scorer_api_id, is_auto)
    VALUES (v_uid, NULL, v_player.name, v_player.api_player_id, true)
    ON CONFLICT ON CONSTRAINT top_scorer_pick_user_group_unique DO NOTHING;
  END LOOP;
END;
$$;
