-- Migration 23: RLS policy fixes
-- Fix 1: profiles UPDATE — add date-lock enforcement (username rename locked after 2026-06-11 19:00 UTC)
--         Migration 2 has only SELECT + INSERT policies. UPDATE was missing entirely.
-- Note:   group_members WITH CHECK was already fixed in Migration 9 (Fix 3) — no action needed here.

-- ─── Fix 1: profiles UPDATE policy ────────────────────────────────────────
-- Drop the existing UPDATE policy if any, then create with date lock
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles: own row update" ON public.profiles;

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    AND now() < '2026-06-11T19:00:00Z'::timestamptz
  )
  WITH CHECK (
    auth.uid() = id
    AND now() < '2026-06-11T19:00:00Z'::timestamptz
  );
