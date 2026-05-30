-- M123: Auto-predict also covers solo (group-less) users
--
-- BUG: fn_auto_predict_game (M30) only iterated group_members → solo users
--   (no group_members row) got no safety-net prediction at kickoff. M36
--   explicitly noted this as "future work". Result: a solo user who forgot
--   to submit before kickoff lost the game permanently — no row at all
--   (versus group members who get a random prediction inserted).
--
-- FIX: keep the existing grouped-user loop unchanged, add a second loop that
--   covers any profile NOT in any group AND without a (user, game, NULL)
--   prediction row — inserts a random 0-5 / 0-5 scoreline with group_id = NULL.
--   Same random range as the grouped path. Marked is_auto = true.
--
-- Constraint compatibility: predictions has UNIQUE NULLS NOT DISTINCT on
--   (user_id, game_id, group_id) (M36) → ON CONFLICT (user_id, game_id, group_id)
--   correctly treats two NULL group_id rows as a conflict and skips. Same
--   constraint name used by the grouped path.
--
-- Symmetry: matches the design already deployed for fn_auto_assign_picks (M41),
--   which has long had separate "grouped" + "ungrouped" branches for both
--   champion and top scorer auto-assign. This brings predictions in line.

CREATE OR REPLACE FUNCTION public.fn_auto_predict_game(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_combo record;
  v_uid   uuid;
  v_home  int;
  v_away  int;
BEGIN
  -- ── Grouped users: one prediction per (user, group) pair ──
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
    v_home := floor(random() * 6)::int;
    v_away := floor(random() * 6)::int;
    INSERT INTO public.predictions (user_id, game_id, group_id, pred_home, pred_away, is_auto)
    VALUES (v_combo.user_id, p_game_id, v_combo.group_id, v_home, v_away, true)
    ON CONFLICT (user_id, game_id, group_id) DO NOTHING;
  END LOOP;

  -- ── Solo users: one prediction with group_id = NULL ──
  FOR v_uid IN
    SELECT p.id
    FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.group_members WHERE user_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.predictions pr
        WHERE pr.user_id = p.id
          AND pr.game_id = p_game_id
          AND pr.group_id IS NULL
      )
  LOOP
    v_home := floor(random() * 6)::int;
    v_away := floor(random() * 6)::int;
    INSERT INTO public.predictions (user_id, game_id, group_id, pred_home, pred_away, is_auto)
    VALUES (v_uid, p_game_id, NULL, v_home, v_away, true)
    ON CONFLICT (user_id, game_id, group_id) DO NOTHING;
  END LOOP;

  -- Self-unschedule cron job for this game
  PERFORM cron.unschedule('auto-predict-' || p_game_id::text);
END;
$$;
