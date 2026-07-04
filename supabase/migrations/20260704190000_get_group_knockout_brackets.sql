-- Group-scoped read of knockout brackets (trivia-model security preserved).
-- knockout_pick stays SELECT-own-only; all cross-user reads go through this
-- SECURITY DEFINER RPC (same pattern as the save_knockout_picks writer RPC).
--
-- Visibility rule:
--   * Caller must be a member of p_group_id (else not_a_member).
--   * Brackets reveal only after the lock 2026-07-04T17:00:00Z (else brackets_locked).
--   * Caller must have filled their OWN bracket to see anyone else's (else
--     must_fill_bracket) -- a non-filler sees nothing.
--   * Only members who filled are returned (JOIN drops zero-pick members).
--
-- NOTE: the RETURNS TABLE OUT param `user_id` shadows knockout_pick.user_id, so the
-- self-picks EXISTS check MUST qualify the column (alias kp0) — else 42702 ambiguous.
--
-- DEV-tested (rolled back) 2026-07-04: filler -> 2 filler users, 0 non-filler rows;
-- non-filler member -> must_fill_bracket; non-member -> not_a_member.
CREATE OR REPLACE FUNCTION public.get_group_knockout_brackets(p_group_id uuid)
 RETURNS TABLE(user_id uuid, username text, round text, team text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_lock constant timestamptz := '2026-07-04T17:00:00Z';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_group_member(p_group_id, v_uid) THEN
    RAISE EXCEPTION 'not_a_member' USING HINT = 'You are not a member of this group';
  END IF;

  IF now() < v_lock THEN
    RAISE EXCEPTION 'brackets_locked' USING HINT = 'Brackets reveal after the lock';
  END IF;

  -- caller must have filled their OWN bracket (qualify column: OUT param shadows it)
  IF NOT EXISTS (SELECT 1 FROM public.knockout_pick kp0 WHERE kp0.user_id = v_uid) THEN
    RAISE EXCEPTION 'must_fill_bracket' USING HINT = 'Fill your bracket to see the groups brackets';
  END IF;

  -- return every pick row of group members who filled (JOIN drops non-fillers)
  RETURN QUERY
  SELECT kp.user_id, pr.username, kp.round, kp.team
  FROM public.knockout_pick kp
  JOIN public.group_members gm ON gm.user_id = kp.user_id AND gm.group_id = p_group_id
  JOIN public.profiles pr ON pr.id = kp.user_id
  ORDER BY pr.username, kp.round, kp.team;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_group_knockout_brackets(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_group_knockout_brackets(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_group_knockout_brackets(uuid) TO authenticated;
