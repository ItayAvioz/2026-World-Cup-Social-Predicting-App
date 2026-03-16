-- Migration 12: Add FK predictions.user_id → profiles.id for PostgREST join support
-- Same pattern as group_members FK added in migration 9

ALTER TABLE public.predictions
  ADD CONSTRAINT predictions_user_id_profiles_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
