-- Migration 129: Group member cap 10 → 12
-- Only the member-count threshold changes in public.join_group.
-- Body is verbatim from the live DEV+PROD function (pg_get_functiondef, 2026-06-11),
-- which were byte-identical. The ONLY diff vs that live body is:
--   IF v_count >= 10  ->  IF v_count >= 12
--   '...its 10-member limit'  ->  '...its 12-member limit'
-- Every other line (tournament check, max_groups check, NULL-data migration) is unchanged.
-- Apply to BOTH dev (ftryuvfdihmhlzvbpfeu) + prod (asugxlvgcmkxspzokydk).

CREATE OR REPLACE FUNCTION public.join_group(p_invite_code text)
 RETURNS group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_group      public.groups;
  v_count      int;
  v_my_groups  int;
  v_membership public.group_members;
BEGIN
  IF now() >= '2026-06-11T19:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'tournament_started' USING HINT = 'Cannot join groups after tournament starts';
  END IF;

  SELECT * INTO v_group
  FROM public.groups
  WHERE invite_code = upper(trim(p_invite_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_invite_code' USING HINT = 'No group found with this invite code';
  END IF;

  IF public.is_group_member(v_group.id, auth.uid()) THEN
    RAISE EXCEPTION 'already_member' USING HINT = 'You are already in this group';
  END IF;

  SELECT COUNT(*) INTO v_my_groups
  FROM public.group_members
  WHERE user_id = auth.uid();

  IF v_my_groups >= 3 THEN
    RAISE EXCEPTION 'max_groups_reached' USING HINT = 'You can be in at most 3 groups';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.group_members
  WHERE group_id = v_group.id;

  IF v_count >= 12 THEN
    RAISE EXCEPTION 'group_full' USING HINT = 'This group has reached its 12-member limit';
  END IF;

  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group.id, auth.uid())
  RETURNING * INTO v_membership;

  IF v_my_groups = 0 THEN
    UPDATE public.predictions SET group_id = v_group.id WHERE user_id = auth.uid() AND group_id IS NULL;
    UPDATE public.champion_pick SET group_id = v_group.id WHERE user_id = auth.uid() AND group_id IS NULL;
    UPDATE public.top_scorer_pick SET group_id = v_group.id WHERE user_id = auth.uid() AND group_id IS NULL;
  END IF;

  RETURN v_membership;
END;
$function$
;
