-- ================================================================
-- WORLDCUP 2026 — Feature: Profiles
-- Table: profiles
-- ================================================================


-- ----------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------

CREATE TABLE public.profiles (
  id        uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username  text  UNIQUE NOT NULL
                  CHECK (
                    char_length(username) >= 3
                    AND char_length(username) <= 20
                    AND username ~ '^[a-zA-Z0-9_]+$'
                  )
);


-- ----------------------------------------------------------------
-- 2. RLS — enable
-- ----------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------
-- 3. RLS POLICIES
-- ----------------------------------------------------------------

-- Any authenticated user can read all profiles (leaderboard, group display)
CREATE POLICY "profiles: authenticated can select"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Users can only insert their own profile row (called client-side after signUp)
CREATE POLICY "profiles: own row insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- No UPDATE policy — username is locked at registration
-- No DELETE policy — cascades from auth.users
