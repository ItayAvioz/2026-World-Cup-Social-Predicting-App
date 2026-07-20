-- M143: odds snapshot stamping. INSERT always stamps; UPDATE re-stamps ONLY on a genuine pick change
-- (no-op resave keeps the locked snapshot; bulk points_earned UPDATEs never fire these).
-- Applied to DEV via MCP apply_migration 2026-07-19 (version 20260719184014).
CREATE OR REPLACE FUNCTION public.fn_stamp_prediction_odds()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  BEGIN
    SELECT home_win, draw, away_win, source INTO v
    FROM public.game_odds
    WHERE game_id = NEW.game_id
    ORDER BY updated_at DESC, (source = 'bet365') DESC
    LIMIT 1;
    IF FOUND THEN
      NEW.odds_home_win := v.home_win;
      NEW.odds_draw     := v.draw;
      NEW.odds_away_win := v.away_win;
      NEW.odds_source   := v.source;
    ELSE
      NEW.odds_home_win := NULL;
      NEW.odds_draw     := NULL;
      NEW.odds_away_win := NULL;
      NEW.odds_source   := 'unavailable';
    END IF;
    NEW.odds_captured_at := now();
  EXCEPTION WHEN OTHERS THEN
    -- never block a prediction write over odds stamping
    IF TG_OP = 'INSERT' AND NEW.odds_source IS NULL THEN
      NEW.odds_source := 'unavailable';
      NEW.odds_captured_at := now();
    END IF;
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_predictions_odds_snapshot_ins
BEFORE INSERT ON public.predictions
FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_prediction_odds();

CREATE TRIGGER trg_predictions_odds_snapshot_upd
BEFORE UPDATE OF pred_home, pred_away ON public.predictions
FOR EACH ROW
WHEN (NEW.pred_home IS DISTINCT FROM OLD.pred_home OR NEW.pred_away IS DISTINCT FROM OLD.pred_away)
EXECUTE FUNCTION public.fn_stamp_prediction_odds();

CREATE OR REPLACE FUNCTION public.fn_stamp_champion_pick_odds()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_odds numeric;
BEGIN
  BEGIN
    SELECT odds INTO v_odds
    FROM public.champion_odds
    WHERE team_name = NEW.team AND bookmaker = 'William Hill'
    ORDER BY updated_at DESC
    LIMIT 1;
    IF FOUND AND v_odds IS NOT NULL THEN
      NEW.odds_value := v_odds;
      NEW.odds_bookmaker := 'William Hill';
    ELSE
      NEW.odds_value := NULL;
      NEW.odds_bookmaker := 'unavailable';
    END IF;
    NEW.odds_captured_at := now();
  EXCEPTION WHEN OTHERS THEN
    IF TG_OP = 'INSERT' AND NEW.odds_bookmaker IS NULL THEN
      NEW.odds_bookmaker := 'unavailable';
      NEW.odds_captured_at := now();
    END IF;
  END;
  RETURN NEW;
END $$;

-- names sort AFTER trg_champion_pick_group_check so validation runs first
CREATE TRIGGER trg_champion_pick_odds_snapshot_ins
BEFORE INSERT ON public.champion_pick
FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_champion_pick_odds();

CREATE TRIGGER trg_champion_pick_odds_snapshot_upd
BEFORE UPDATE OF team ON public.champion_pick
FOR EACH ROW
WHEN (NEW.team IS DISTINCT FROM OLD.team)
EXECUTE FUNCTION public.fn_stamp_champion_pick_odds();
