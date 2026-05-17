-- ================================================================
-- Migration 95: Security fixes — feedback SELECT + ai_judge_scores access
-- ================================================================
-- feedback: add service-role-only SELECT policy (admin only, users can't read)
-- ai_judge_scores: revoke SELECT from anon + authenticated (internal view)
-- team_tournament_stats: left as-is — frontend depends on it (public data)
-- ================================================================

-- 1. feedback: restrict SELECT to service role only
CREATE POLICY "feedback: service role select"
  ON public.feedback FOR SELECT
  USING (auth.role() = 'service_role');

-- 2. ai_judge_scores view: revoke public access
REVOKE SELECT ON public.ai_judge_scores FROM anon, authenticated;
