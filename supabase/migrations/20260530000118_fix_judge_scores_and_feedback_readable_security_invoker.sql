-- M118: Fix ai_judge_scores + feedback_readable to SECURITY INVOKER
--
-- M95/M96 revoked SELECT on these two views from anon+authenticated, BUT the
-- views themselves are still SECURITY DEFINER. Supabase dashboard flags them
-- with the UNRESTRICTED badge + a "Security Definer" warning because the view
-- runs as its creator (postgres) and bypasses RLS on the underlying tables
-- (ai_judge_runs, groups, feedback, profiles).
--
-- Same pattern as M97 (team_tournament_stats) and M117 (player_tournament_stats):
-- DROP + CREATE WITH (security_invoker = true), then re-apply the SELECT revoke
-- from anon+authenticated to keep the M95/M96 hardening.
--
-- View bodies are verbatim from dev's pg_get_viewdef() output — zero new SQL.
-- Applied to BOTH dev + prod via mcp__supabase__apply_migration.
--
-- After this: Supabase advisor "security_definer_view" errors for both views
-- should clear. Service-role-only access via Supabase Studio / SQL editor still
-- works (service_role bypasses RLS regardless of security_invoker).

-- ─── ai_judge_scores ─────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.ai_judge_scores;

CREATE VIEW public.ai_judge_scores
WITH (security_invoker = true)
AS
 SELECT jr.id AS judge_run_id,
    jr.group_id,
    g.name AS group_name,
    jr.date,
    jr.winner_agent,
    jr.judge_reasoning,
    (c.value ->> 'agent'::text)::integer AS agent,
    c.value ->> 'slot'::text AS slot,
    c.value ->> 'version_tag'::text AS version_tag,
    (c.value ->> 'accuracy'::text)::numeric AS accuracy,
    (c.value ->> 'humor'::text)::numeric AS humor,
    (c.value ->> 'compliance'::text)::numeric AS compliance,
    (c.value ->> 'structure'::text)::numeric AS structure,
    (c.value ->> 'total'::text)::numeric AS total,
    ((c.value ->> 'agent'::text)::integer) = jr.winner_agent AS is_winner
   FROM ai_judge_runs jr
     JOIN groups g ON g.id = jr.group_id,
    LATERAL jsonb_array_elements(jr.candidates) c(value);

REVOKE SELECT ON public.ai_judge_scores FROM anon, authenticated;

-- ─── feedback_readable ───────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.feedback_readable;

CREATE VIEW public.feedback_readable
WITH (security_invoker = true)
AS
 SELECT p.username,
    f.category,
    f.priority,
    f.message,
    f.screenshot_url,
    f.created_at
   FROM feedback f
     JOIN profiles p ON p.id = f.user_id
  ORDER BY f.created_at DESC;

REVOKE SELECT ON public.feedback_readable FROM anon, authenticated;
