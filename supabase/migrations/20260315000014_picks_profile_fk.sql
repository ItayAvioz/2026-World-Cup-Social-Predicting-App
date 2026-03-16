-- Migration 14: Add FK champion_pick + top_scorer_pick → profiles.id
-- Required for PostgREST embedded joins (same pattern as group_members + predictions)

ALTER TABLE public.champion_pick
  ADD CONSTRAINT champion_pick_user_id_profiles_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.top_scorer_pick
  ADD CONSTRAINT top_scorer_pick_user_id_profiles_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
