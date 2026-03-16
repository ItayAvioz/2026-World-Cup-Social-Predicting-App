-- ================================================================
-- WORLDCUP 2026 — Feature: Champion Pick + Top Scorer Pick
-- Tables: champion_pick, top_scorer_pick
-- Locks at: 2026-06-11T19:00:00Z (first game kickoff)
-- ================================================================


-- ----------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------

CREATE TABLE public.champion_pick (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team          text        NOT NULL CHECK (team IN (
    'Mexico','South Africa','South Korea','Canada','Qatar','Switzerland',
    'Brazil','Morocco','Haiti','Scotland','United States','Paraguay',
    'Australia','Germany','Curaçao','Ivory Coast','Ecuador',
    'Netherlands','Japan','Tunisia','Belgium','Egypt','Iran','New Zealand',
    'Spain','Cape Verde','Saudi Arabia','Uruguay','France','Senegal',
    'Norway','Argentina','Algeria','Austria','Jordan','Portugal',
    'Uzbekistan','Colombia','England','Croatia','Ghana','Panama',
    'UEFA PO-A','UEFA PO-B','UEFA PO-C','UEFA PO-D','IC PO-1','IC PO-2'
  )),
  points_earned int         NOT NULL DEFAULT 0,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.top_scorer_pick (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name   text        NOT NULL,   -- fixed list enforced client-side only
  points_earned int         NOT NULL DEFAULT 0,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------
-- 2. TRIGGERS — updated_at (reuse fn_set_updated_at from predictions)
-- ----------------------------------------------------------------

CREATE TRIGGER trg_champion_pick_updated_at
  BEFORE UPDATE ON public.champion_pick
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_top_scorer_pick_updated_at
  BEFORE UPDATE ON public.top_scorer_pick
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


-- ----------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------

ALTER TABLE public.champion_pick    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.top_scorer_pick  ENABLE ROW LEVEL SECURITY;

-- Lock timestamp: first game kickoff
-- champion_pick
CREATE POLICY "champion_pick: select"
  ON public.champion_pick FOR SELECT
  USING (
    auth.uid() = user_id
    OR now() >= '2026-06-11T19:00:00Z'::timestamptz
  );

CREATE POLICY "champion_pick: insert"
  ON public.champion_pick FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND now() < '2026-06-11T19:00:00Z'::timestamptz
  );

CREATE POLICY "champion_pick: update"
  ON public.champion_pick FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND now() < '2026-06-11T19:00:00Z'::timestamptz
  );

-- top_scorer_pick (identical policies)
CREATE POLICY "top_scorer_pick: select"
  ON public.top_scorer_pick FOR SELECT
  USING (
    auth.uid() = user_id
    OR now() >= '2026-06-11T19:00:00Z'::timestamptz
  );

CREATE POLICY "top_scorer_pick: insert"
  ON public.top_scorer_pick FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND now() < '2026-06-11T19:00:00Z'::timestamptz
  );

CREATE POLICY "top_scorer_pick: update"
  ON public.top_scorer_pick FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND now() < '2026-06-11T19:00:00Z'::timestamptz
  );
