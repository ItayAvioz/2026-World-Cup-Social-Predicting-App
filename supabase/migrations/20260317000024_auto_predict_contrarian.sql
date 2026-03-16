-- Migration 24: Rewrite fn_auto_predict_game with contrarian logic
-- Design: pick the LEAST popular W/D/L outcome from existing predictions
--   so auto-predicted users get the "underdog/surprise" score, not a random one
-- Fallback: if no predictions exist yet → pure random (same as before)
-- Tiebreak priority for least-popular: away_win > draw > home_win (most surprising first)
-- Score generation per outcome:
--   home_win  → pred_away = random(0-2), pred_home = pred_away + 1 + random(0-2)
--   draw      → v_base = random(0-4), pred_home = pred_away = v_base
--   away_win  → pred_home = random(0-2), pred_away = pred_home + 1 + random(0-2)
-- Each missing user gets their own independently rolled score within the chosen outcome

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

    -- Apply tiebreak: away_win first, then draw, then home_win
    IF v_away_wins = v_min_count THEN
      v_outcome := 'away_win';
    ELSIF v_draws = v_min_count THEN
      v_outcome := 'draw';
    ELSE
      v_outcome := 'home_win';
    END IF;
  END IF;

  -- Insert a prediction for every profile that has not yet predicted this game
  -- Each user gets independently rolled scores within the chosen outcome
  FOR rec IN
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.predictions pr
      WHERE pr.user_id = p.id AND pr.game_id = p_game_id
    )
  LOOP
    IF v_outcome = 'home_win' THEN
      v_pred_away := floor(random() * 3)::int;              -- 0, 1, or 2
      v_pred_home := v_pred_away + 1 + floor(random() * 3)::int;  -- away + 1 to 3
    ELSIF v_outcome = 'draw' THEN
      v_base      := floor(random() * 5)::int;              -- 0 to 4
      v_pred_home := v_base;
      v_pred_away := v_base;
    ELSE  -- away_win
      v_pred_home := floor(random() * 3)::int;              -- 0, 1, or 2
      v_pred_away := v_pred_home + 1 + floor(random() * 3)::int;  -- home + 1 to 3
    END IF;

    INSERT INTO public.predictions (user_id, game_id, pred_home, pred_away, is_auto)
    VALUES (rec.user_id, p_game_id, v_pred_home, v_pred_away, true);
  END LOOP;

  -- Unschedule this job so it only runs once
  PERFORM cron.unschedule('auto-predict-' || p_game_id::text);
END;
$$;
