-- ================================================================
-- WORLDCUP 2026 — Feature: Create Group
-- Tables: groups, group_members
-- ================================================================


-- ----------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------

CREATE TABLE public.groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (char_length(name) <= 30),
  invite_code text        UNIQUE NOT NULL DEFAULT '',
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.group_members (
  group_id    uuid        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  is_inactive boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (group_id, user_id)
);


-- ----------------------------------------------------------------
-- 2. HELPER — membership check (SECURITY DEFINER avoids RLS recursion)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  );
$$;


-- ----------------------------------------------------------------
-- 3. TRIGGER T1 — generate invite_code on group insert (BEFORE)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_generate_invite_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code  text;
  taken boolean;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * 36 + 1)::int, 1);
    END LOOP;
    SELECT EXISTS (SELECT 1 FROM public.groups WHERE invite_code = code) INTO taken;
    EXIT WHEN NOT taken;
  END LOOP;
  NEW.invite_code := code;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_group_invite_code
  BEFORE INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.fn_generate_invite_code();


-- ----------------------------------------------------------------
-- 4. TRIGGER T2 — auto-add creator to group_members (AFTER)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_creator_joins_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (NEW.id, NEW.created_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_group_creator_join
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.fn_creator_joins_group();


-- ----------------------------------------------------------------
-- 5. TRIGGER T3 — on user delete: delete group if before kickoff
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_handle_captain_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF now() < '2026-06-11 00:00:00+00'::timestamptz THEN
    DELETE FROM public.groups WHERE created_by = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_captain_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_captain_delete();


-- ----------------------------------------------------------------
-- 6. RLS — enable
-- ----------------------------------------------------------------

ALTER TABLE public.groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------
-- 7. RLS POLICIES — groups
-- ----------------------------------------------------------------

CREATE POLICY "groups: members can select"
  ON public.groups FOR SELECT
  USING (public.is_group_member(id, auth.uid()));

CREATE POLICY "groups: captain can update"
  ON public.groups FOR UPDATE
  USING (auth.uid() = created_by);


-- ----------------------------------------------------------------
-- 8. RLS POLICIES — group_members
-- ----------------------------------------------------------------

CREATE POLICY "group_members: members can select"
  ON public.group_members FOR SELECT
  USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "group_members: captain can update"
  ON public.group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.groups
      WHERE id = group_id AND created_by = auth.uid()
    )
  );


-- ----------------------------------------------------------------
-- 9. RPC — create_group(name)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_group(group_name text)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
  v_group public.groups;
BEGIN
  IF char_length(trim(group_name)) = 0 THEN
    RAISE EXCEPTION 'invalid_name' USING HINT = 'Group name cannot be empty';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.groups
  WHERE created_by = auth.uid();

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'max_groups_reached' USING HINT = 'You can create at most 3 groups';
  END IF;

  INSERT INTO public.groups (name, created_by)
  VALUES (trim(group_name), auth.uid())
  RETURNING * INTO v_group;

  RETURN v_group;
END;
$$;


-- ----------------------------------------------------------------
-- 10. RPC — join_group(invite_code)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_group(p_invite_code text)
RETURNS public.group_members
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group      public.groups;
  v_count      int;
  v_membership public.group_members;
BEGIN
  SELECT * INTO v_group
  FROM public.groups
  WHERE invite_code = upper(trim(p_invite_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_invite_code' USING HINT = 'No group found with this invite code';
  END IF;

  IF public.is_group_member(v_group.id, auth.uid()) THEN
    RAISE EXCEPTION 'already_member' USING HINT = 'You are already in this group';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.group_members
  WHERE group_id = v_group.id;

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'group_full' USING HINT = 'This group has reached its 10-member limit';
  END IF;

  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group.id, auth.uid())
  RETURNING * INTO v_membership;

  RETURN v_membership;
END;
$$;
