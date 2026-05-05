-- Migration 70: ai_judge_scores view
-- Unnests ai_judge_runs.candidates JSONB into one row per agent per run.
-- Readable in Supabase table editor without writing SQL.

CREATE OR REPLACE VIEW public.ai_judge_scores AS
SELECT
  jr.id            AS judge_run_id,
  jr.group_id,
  g.name           AS group_name,
  jr.date,
  jr.winner_agent,
  jr.judge_reasoning,
  (c->>'agent')::int          AS agent,
  c->>'slot'                  AS slot,
  c->>'version_tag'           AS version_tag,
  (c->>'accuracy')::numeric   AS accuracy,
  (c->>'humor')::numeric      AS humor,
  (c->>'compliance')::numeric AS compliance,
  (c->>'structure')::numeric  AS structure,
  (c->>'total')::numeric      AS total,
  (c->>'agent')::int = jr.winner_agent AS is_winner
FROM public.ai_judge_runs jr
JOIN public.groups g ON g.id = jr.group_id,
LATERAL jsonb_array_elements(jr.candidates) AS c;

GRANT SELECT ON public.ai_judge_scores TO anon, authenticated, service_role;
