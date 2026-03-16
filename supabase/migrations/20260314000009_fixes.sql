-- ================================================================
-- WORLDCUP 2026 — Fixes & Improvements
-- ================================================================
--
-- Fix 1: games — add knockout_winner column + CHECK constraints
-- Fix 2: top_scorer_pick — add top_scorer_api_id for exact player matching
-- Fix 3: group_members UPDATE policy — add WITH CHECK
-- Fix 4: player_tournament_stats VIEW — remove ORDER BY
-- Fix 5: fn_calculate_pick_points() — champion + top scorer point awards
-- Fix 6: Trigger — fires when final game's knockout_winner is set
-- Fix 7: create_profile() RPC — atomic profile creation with friendly errors
-- ================================================================


-- ----------------------------------------------------------------
-- Fix 1. GAMES — knockout_winner + score/phase CHECK constraints
-- ----------------------------------------------------------------

-- The actual tournament winner of a knockout game (set by Phase 4 API sync).
-- May differ from 90-min score when ET/PKs decide the result.
-- NULL for group-stage games and unfinished knockout games.
ALTER TABLE public.games
  ADD COLUMN knockout_winner text;

-- Scores must be non-negative
ALTER TABLE public.games
  ADD CONSTRAINT games_scores_non_negative
  CHECK (
    (score_home IS NULL OR score_home >= 0)
    AND (score_away IS NULL OR score_away >= 0)
  );

-- group_name required for group stage, forbidden for knockout
ALTER TABLE public.games
  ADD CONSTRAINT games_group_name_phase
  CHECK (
    (phase = 'group' AND group_name IS NOT NULL)
    OR (phase != 'group' AND group_name IS NULL)
  );


-- ----------------------------------------------------------------
-- Fix 2. TOP_SCORER_PICK — add api_player_id for exact matching
-- ----------------------------------------------------------------
-- Stores the football API's numeric player id alongside the display name.
-- Client must send both when saving a pick.
-- Points are awarded by matching api_player_id against player_tournament_stats.

ALTER TABLE public.top_scorer_pick
  ADD COLUMN top_scorer_api_id int;

CREATE INDEX top_scorer_pick_api_player_idx
  ON public.top_scorer_pick (top_scorer_api_id);


-- ----------------------------------------------------------------
-- Fix 3. GROUP_MEMBERS — add WITH CHECK to UPDATE policy
-- ----------------------------------------------------------------

DROP POLICY IF EXISTS "group_members: captain can update" ON public.group_members;

CREATE POLICY "group_members: captain can update"
  ON public.group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.groups
      WHERE id = group_id AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups
      WHERE id = group_id AND created_by = auth.uid()
    )
  );


-- ----------------------------------------------------------------
-- Fix 4. PLAYER_TOURNAMENT_STATS VIEW — remove non-standard ORDER BY
--    Clients must supply ORDER BY total_goals DESC themselves.
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW public.player_tournament_stats AS
SELECT
  ps.api_player_id,
  ps.player_name,
  ps.team,
  SUM(ps.goals)         AS total_goals,
  SUM(ps.assists)       AS total_assists,
  SUM(ps.yellow_cards)  AS total_yellow_cards,
  SUM(ps.red_cards)     AS total_red_cards,
  COUNT(*)              AS games_played
FROM public.game_player_stats ps
JOIN public.games g ON g.id = ps.game_id
WHERE g.score_home IS NOT NULL   -- finished games only
GROUP BY ps.api_player_id, ps.player_name, ps.team;


-- ----------------------------------------------------------------
-- Fix 5 + 6. FN_CALCULATE_PICK_POINTS — trigger function
--    Fires AFTER UPDATE OF knockout_winner ON games.
--    Acts only when the FINAL game's knockout_winner is set/corrected.
--    Resets all pick points first (idempotent — safe to re-run on correction).
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_calculate_pick_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_top_scorer_api_id int;
BEGIN
  -- Only act on the final game when knockout_winner is being set or corrected
  IF NEW.phase = 'final'
     AND NEW.knockout_winner IS NOT NULL
     AND (OLD.knockout_winner IS NULL OR OLD.knockout_winner != NEW.knockout_winner)
  THEN

    -- 1. Champion pick — reset all, then award to correct pickers
    UPDATE public.champion_pick SET points_earned = 0;
    UPDATE public.champion_pick
       SET points_earned = 10
     WHERE team = NEW.knockout_winner;

    -- 2. Top scorer — find the leader by api_player_id
    SELECT api_player_id INTO v_top_scorer_api_id
    FROM public.player_tournament_stats
    ORDER BY total_goals DESC, total_assists DESC
    LIMIT 1;

    -- Reset all, then award to correct pickers (only if api_player_id is stored)
    IF v_top_scorer_api_id IS NOT NULL THEN
      UPDATE public.top_scorer_pick SET points_earned = 0;
      UPDATE public.top_scorer_pick
         SET points_earned = 10
       WHERE top_scorer_api_id = v_top_scorer_api_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_pick_points
  AFTER UPDATE OF knockout_winner ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.fn_calculate_pick_points();


-- ----------------------------------------------------------------
-- Fix 7. CREATE_PROFILE RPC — atomic profile creation
--    Use this instead of direct client INSERT to profiles.
--    Returns the new profile row or raises a named error.
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_profile(p_username text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (auth.uid(), p_username)
  RETURNING * INTO v_profile;

  RETURN v_profile;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'username_taken'
      USING HINT = 'This username is already taken';
  WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_username'
      USING HINT = 'Username must be 3–20 alphanumeric characters or underscores';
END;
$$;

-- NOTE: After deploying, update auth.js to call:
--   const { data, error } = await _supabase.rpc('create_profile', { p_username: username })
-- instead of:
--   await _supabase.from('profiles').insert({ id: user.id, username })
