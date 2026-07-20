-- M141: per-group captain scoring config + first DB-side feature-flag table (DEV-only feature).
-- Applied to DEV via MCP apply_migration 2026-07-19 (version 20260719183923).
CREATE TABLE public.group_scoring_config (
  group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
  group_stage_mode text NOT NULL DEFAULT 'system' CHECK (group_stage_mode IN ('system','odds','custom')),
  group_stage_outcome_points numeric CHECK (group_stage_outcome_points >= 0),
  group_stage_exact_points numeric CHECK (group_stage_exact_points >= 0),
  group_stage_exact_odds_multiplier numeric CHECK (group_stage_exact_odds_multiplier > 0),
  knockout_mode text NOT NULL DEFAULT 'system' CHECK (knockout_mode IN ('system','odds','custom')),
  knockout_outcome_points numeric CHECK (knockout_outcome_points >= 0),
  knockout_exact_points numeric CHECK (knockout_exact_points >= 0),
  knockout_exact_odds_multiplier numeric CHECK (knockout_exact_odds_multiplier > 0),
  knockout_result_basis text NOT NULL DEFAULT 'ninety_minutes' CHECK (knockout_result_basis IN ('ninety_minutes','extra_time')),
  champion_mode text NOT NULL DEFAULT 'system' CHECK (champion_mode IN ('system','odds','custom')),
  champion_custom_points numeric CHECK (champion_custom_points >= 0),
  top_scorer_mode text NOT NULL DEFAULT 'system' CHECK (top_scorer_mode IN ('system','custom')),
  top_scorer_custom_points numeric CHECK (top_scorer_custom_points >= 0),
  trivia_included boolean NOT NULL DEFAULT true,
  trivia_inclusion_timing text CHECK (trivia_inclusion_timing IN ('immediate','tournament_finish')),
  bracket_included boolean NOT NULL DEFAULT true,
  bracket_inclusion_timing text CHECK (bracket_inclusion_timing IN ('immediate','tournament_finish')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CHECK (NOT trivia_included OR trivia_inclusion_timing IS NOT NULL),
  CHECK (NOT bracket_included OR bracket_inclusion_timing IS NOT NULL),
  CHECK (group_stage_mode <> 'custom' OR (group_stage_outcome_points IS NOT NULL AND group_stage_exact_points IS NOT NULL)),
  CHECK (group_stage_mode <> 'odds' OR group_stage_exact_odds_multiplier IS NOT NULL),
  CHECK (knockout_mode <> 'custom' OR (knockout_outcome_points IS NOT NULL AND knockout_exact_points IS NOT NULL)),
  CHECK (knockout_mode <> 'odds' OR knockout_exact_odds_multiplier IS NOT NULL),
  CHECK (champion_mode <> 'custom' OR champion_custom_points IS NOT NULL),
  CHECK (top_scorer_mode <> 'custom' OR top_scorer_custom_points IS NOT NULL)
);
ALTER TABLE public.group_scoring_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "group_scoring_config: members read" ON public.group_scoring_config
  FOR SELECT USING (public.is_group_member(group_id, auth.uid()));
REVOKE ALL ON public.group_scoring_config FROM anon, authenticated;
GRANT SELECT ON public.group_scoring_config TO authenticated;

CREATE TABLE public.app_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_flags: read" ON public.app_flags FOR SELECT USING (true);
REVOKE ALL ON public.app_flags FROM anon, authenticated;
GRANT SELECT ON public.app_flags TO anon, authenticated;
INSERT INTO public.app_flags (key, enabled) VALUES ('odds_kick_enabled', false);
