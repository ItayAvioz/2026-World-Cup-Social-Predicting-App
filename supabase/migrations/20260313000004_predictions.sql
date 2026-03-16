-- ================================================================
-- WORLDCUP 2026 — Feature: Predictions
-- Table: predictions
-- Triggers: updated_at, points calculation, auto-predict at kickoff
-- ================================================================


-- ----------------------------------------------------------------
-- 1. EXTENSION — pg_cron (required for auto-predict scheduling)
-- ----------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ----------------------------------------------------------------
-- 2. HELPER — share_a_group (used in SELECT RLS policy)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.share_a_group(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm1
    JOIN public.group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = auth.uid()
      AND gm2.user_id = p_user_id
      AND gm1.user_id != gm2.user_id
  );
$$;


-- ----------------------------------------------------------------
-- 3. TABLE
-- ----------------------------------------------------------------

CREATE TABLE public.predictions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  game_id       uuid        NOT NULL REFERENCES public.games(id)  ON DELETE CASCADE,
  pred_home     int         NOT NULL CHECK (pred_home >= 0),
  pred_away     int         NOT NULL CHECK (pred_away >= 0),
  points_earned int         NOT NULL DEFAULT 0,
  is_auto       boolean     NOT NULL DEFAULT false,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);

CREATE INDEX predictions_user_idx ON public.predictions (user_id);
CREATE INDEX predictions_game_idx ON public.predictions (game_id);


-- ----------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

-- Own predictions always visible
-- Group members' predictions visible after game kicks off
CREATE POLICY "predictions: select"
  ON public.predictions FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      public.share_a_group(user_id)
      AND EXISTS (
        SELECT 1 FROM public.games
        WHERE id = game_id AND kick_off_time <= now()
      )
    )
  );

-- Insert only before kickoff
CREATE POLICY "predictions: insert"
  ON public.predictions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE id = game_id AND kick_off_time > now()
    )
  );

-- Update own row only before kickoff
CREATE POLICY "predictions: update"
  ON public.predictions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE id = game_id AND kick_off_time > now()
    )
  );

-- No DELETE policy — nobody can delete predictions


-- ----------------------------------------------------------------
-- 5. TRIGGER T1 — auto-set updated_at on every edit
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_predictions_updated_at
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


-- ----------------------------------------------------------------
-- 6. TRIGGER T2 — recalculate points when game score is set/updated
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_calculate_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Fire whenever both scores are present (handles initial set + corrections)
  IF NEW.score_home IS NOT NULL AND NEW.score_away IS NOT NULL THEN
    UPDATE public.predictions
    SET points_earned = CASE
      -- Exact scoreline = 3 pts
      WHEN pred_home = NEW.score_home AND pred_away = NEW.score_away THEN 3
      -- Correct outcome = 1 pt
      WHEN pred_home > pred_away  AND NEW.score_home > NEW.score_away  THEN 1  -- home win
      WHEN pred_home = pred_away  AND NEW.score_home = NEW.score_away  THEN 1  -- draw
      WHEN pred_home < pred_away  AND NEW.score_home < NEW.score_away  THEN 1  -- away win
      ELSE 0
    END
    WHERE game_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_points
  AFTER UPDATE OF score_home, score_away ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.fn_calculate_points();


-- ----------------------------------------------------------------
-- 7. AUTO-PREDICT — called by cron at exact kickoff time
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_auto_predict_game(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert random 0-5 predictions for every profile without a prediction
  INSERT INTO public.predictions (user_id, game_id, pred_home, pred_away, is_auto)
  SELECT
    p.id,
    p_game_id,
    floor(random() * 6)::int,
    floor(random() * 6)::int,
    true
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.predictions pr
    WHERE pr.user_id = p.id AND pr.game_id = p_game_id
  );

  -- Self-unschedule: this job runs exactly once
  PERFORM cron.unschedule('auto-predict-' || p_game_id::text);
END;
$$;


-- ----------------------------------------------------------------
-- 8. SCHEDULE — one cron job per game, fires at exact kickoff UTC
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_schedule_auto_predictions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_game  record;
  v_cron  text;
BEGIN
  FOR v_game IN SELECT id, kick_off_time FROM public.games LOOP

    -- Build cron: 'minute hour day month *' (all UTC)
    v_cron :=
      EXTRACT(MINUTE FROM v_game.kick_off_time AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_game.kick_off_time AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_game.kick_off_time AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_game.kick_off_time AT TIME ZONE 'UTC')::int || ' *';

    PERFORM cron.schedule(
      'auto-predict-' || v_game.id::text,
      v_cron,
      format('SELECT public.fn_auto_predict_game(%L::uuid)', v_game.id)
    );

  END LOOP;
END;
$$;

-- Run once to register all 104 cron jobs from the games table
SELECT public.fn_schedule_auto_predictions();
