-- Migration 11: Lock group rename at tournament kickoff (2026-06-11T19:00:00Z)
-- Consistent with username rename lock (migration 10)

DROP POLICY IF EXISTS "groups: captain can update" ON public.groups;

CREATE POLICY "groups: captain can update before kickoff"
  ON public.groups FOR UPDATE
  USING  (auth.uid() = created_by AND now() < '2026-06-11T19:00:00Z')
  WITH CHECK (auth.uid() = created_by AND now() < '2026-06-11T19:00:00Z');
