-- Migration 25: Captain self-flag DB guard + fn_auto_predict_game logging
--
-- Fix 1: group_members UPDATE policy — captain cannot flag themselves as inactive
--   Currently UI-only (button hidden). Adding DB-level enforcement for defense in depth.
--   WITH CHECK now includes: AND user_id != auth.uid()
--   Effect: direct API call by captain to mark themselves inactive → 42501 RLS error
--
-- Fix 2: fn_auto_predict_game — add row count logging
--   Adds RAISE LOG so Postgres logs show: game_id, outcome chosen, rows inserted
--   Useful during tournament operations to confirm cron jobs fired correctly

-- ─── Fix 1: captain self-flag guard ───────────────────────────────────────
DROP POLICY IF EXISTS "group_members: captain can update" ON public.group_members;
DROP POLICY IF EXISTS "group_members_captain_update"      ON public.group_members;

CREATE POLICY "group_members: captain can update"
  ON public.group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id AND g.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id AND g.created_by = auth.uid()
    )
    AND user_id != auth.uid()  -- captain cannot mark themselves as inactive
  );

-- ─── Fix 2: fn_auto_predict_game with logging ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_predict_game(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_home_wins   int;
  v_draws       int;
  v_away_wins   int;
  v_total       int;
  v_outcome     text;  -- 'home_win' | 'draw' | 'away_win'
  v_min_count   int;
  v_pred_home   int;
  v_pred_away   int;
  v_base        int;
  v_inserted    int := 0;
  rec           record;
BEGIN
  -- Count existing W/D/L predictions for this game
  SELECT
    COUNT(*) FILTER (WHERE pred_home > pred_away),
    COUNT(*) FILTER (WHERE pred_home = pred_away),
    COUNT(*) FILTER (WHERE pred_home < pred_away),
    COUNT(*)
  INTO v_home_wins, v_draws, v_away_wins, v_total
  FROM public.predictions
  WHERE game_id = p_game_id;

  -- Determine contrarian outcome (least popular)
  -- Tiebreak: away_win > draw > home_win (most surprising first)
  IF v_total = 0 THEN
    -- No predictions yet — fall back to random outcome
    v_outcome := CASE floor(random() * 3)::int
      WHEN 0 THEN 'home_win'
      WHEN 1 THEN 'draw'
      ELSE 'away_win'
    END;
  ELSE
    v_min_count := LEAST(v_home_wins, v_draws, v_away_wins);

    IF v_away_wins = v_min_count THEN
      v_outcome := 'away_win';
    ELSIF v_draws = v_min_count THEN
      v_outcome := 'draw';
    ELSE
      v_outcome := 'home_win';
    END IF;
  END IF;

  -- Insert a prediction for every profile that has not yet predicted this game
  FOR rec IN
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.predictions pr
      WHERE pr.user_id = p.id AND pr.game_id = p_game_id
    )
  LOOP
    IF v_outcome = 'home_win' THEN
      v_pred_away := floor(random() * 3)::int;
      v_pred_home := v_pred_away + 1 + floor(random() * 3)::int;
    ELSIF v_outcome = 'draw' THEN
      v_base      := floor(random() * 5)::int;
      v_pred_home := v_base;
      v_pred_away := v_base;
    ELSE  -- away_win
      v_pred_home := floor(random() * 3)::int;
      v_pred_away := v_pred_home + 1 + floor(random() * 3)::int;
    END IF;

    INSERT INTO public.predictions (user_id, game_id, pred_home, pred_away, is_auto)
    VALUES (rec.user_id, p_game_id, v_pred_home, v_pred_away, true);

    v_inserted := v_inserted + 1;
  END LOOP;

  -- Log outcome for ops visibility (visible in Postgres logs / Supabase log drain)
  RAISE LOG 'auto-predict game=%  existing_preds=%  outcome=%  inserted=%',
    p_game_id, v_total, v_outcome, v_inserted;

  -- Unschedule this job so it only runs once
  PERFORM cron.unschedule('auto-predict-' || p_game_id::text);
END;
$$;
