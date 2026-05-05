-- Migration 69: ai_summaries_winner_score
-- Adds winner_score to ai_summaries (the judge total score of the winning agent).
-- Backfills winner_score from existing ai_judge_runs.candidates.
-- Backfills version_tag into ai_judge_runs.candidates JSONB.

-- 1. Add winner_score column
ALTER TABLE public.ai_summaries
  ADD COLUMN IF NOT EXISTS winner_score numeric;

-- 2. Backfill winner_score from ai_judge_runs
UPDATE public.ai_summaries s
SET winner_score = (
  SELECT (c->>'total')::numeric
  FROM public.ai_judge_runs jr,
       jsonb_array_elements(jr.candidates) AS c
  WHERE jr.id = s.judge_run_id
    AND (c->>'agent')::int = s.winner_agent
  LIMIT 1
)
WHERE s.judge_run_id IS NOT NULL
  AND s.winner_agent IS NOT NULL;

-- 3. Backfill version_tag into ai_judge_runs.candidates JSONB
UPDATE public.ai_judge_runs jr
SET candidates = (
  SELECT jsonb_agg(
    c || CASE
      WHEN (c->>'prompt_version_id') IS NOT NULL
      THEN jsonb_build_object(
        'version_tag',
        (SELECT version_tag FROM public.prompt_versions pv
         WHERE pv.id = (c->>'prompt_version_id')::uuid)
      )
      ELSE '{}'::jsonb
    END
  )
  FROM jsonb_array_elements(jr.candidates) AS c
)
WHERE candidates IS NOT NULL;
