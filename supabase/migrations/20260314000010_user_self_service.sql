-- ================================================================
-- WORLDCUP 2026 — User Self-Service
-- ================================================================
-- Feature 1b: username rename + account deletion
--
-- Rules:
--   Username rename  → allowed until 2026-06-11 19:00 UTC (tournament kickoff)
--   Account deletion → allowed if:
--                      (a) user has NOT joined any group, AND
--                      (b) now() < 2026-06-11 19:00 UTC
-- ================================================================


-- ----------------------------------------------------------------
-- 1. profiles UPDATE policy — username rename until kickoff
-- ----------------------------------------------------------------

CREATE POLICY "profiles: own row update before kickoff"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    AND now() < '2026-06-11T19:00:00Z'
  )
  WITH CHECK (
    auth.uid() = id
    AND now() < '2026-06-11T19:00:00Z'
  );


-- ----------------------------------------------------------------
-- 2. delete_account() RPC
--    Validates rules, then deletes the auth.users row (cascades to
--    profiles, predictions, champion_pick, top_scorer_pick,
--    group_members).
--    groups.created_by → SET NULL (group survives, captain gone).
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  -- Rule 1: tournament has not started
  IF now() >= '2026-06-11T19:00:00Z' THEN
    RAISE EXCEPTION 'account_locked'
      USING HINT = 'Accounts cannot be deleted after the tournament has started';
  END IF;

  -- Rule 2: user has not joined any group
  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'cannot_delete_in_group'
      USING HINT = 'You cannot delete your account once you have joined a group';
  END IF;

  -- Delete — cascades to profiles, predictions, picks
  DELETE FROM auth.users WHERE id = auth.uid();

END;
$$;
