-- M125: Restore contrarian auto-predict logic (revert M123's accidental wipe of M52)
--
-- WHAT WENT WRONG
--   M123 (today, 2026-05-31 ~13:18 UTC) added a solo-user branch to fn_auto_predict_game
--   via CREATE OR REPLACE FUNCTION, but used naked `floor(random() * 6)` for both home
--   and away scores. That wiped the contrarian W/D/L-distribution logic from M52
--   (2026-04-06) for BOTH the grouped AND the ungrouped paths on both DEV and PROD.
--   M52 had ALREADY included a solo branch since 2026-04-06 — M123 was redundant + destructive.
--
-- WHAT THIS RESTORES
--   The exact M52 body verbatim. It already handles both grouped + ungrouped users with
--   the correct contrarian behavior:
--     1. Count W/D/L predictions for this game GLOBALLY (across all users + groups)
--     2. Pick the LEAST-popular outcome (tiebreak: away_win > draw > home_win)
--     3. For every missing (user × group) and every missing solo user:
--          - draw     → home = away = random 0-5
--          - home_win → home = 1-5, away = random(0..home-1)  -- strictly less
--          - away_win → away = 1-5, home = random(0..away-1)
--     4. Insert with proper group_id (NULL for solo) + ON CONFLICT skip
--     5. Self-unschedule the cron at the end
--
-- WHY APPLY TO BOTH ENVS
--   M123 was applied to BOTH DEV and PROD today, so both have the broken simple-random
--   version. This restoration brings BOTH back to the M52 contrarian + per-outcome
--   scoreline behavior — matching what Itay verified working in dev for weeks.
--
-- ON CONFLICT NOTES
--   The grouped branch uses ON CONFLICT (column list); the solo branch uses
--   ON CONFLICT ON CONSTRAINT predictions_user_game_group_unique. Both resolve to the
--   same UNIQUE NULLS NOT DISTINCT (user_id, game_id, group_id) constraint — equivalent.

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
