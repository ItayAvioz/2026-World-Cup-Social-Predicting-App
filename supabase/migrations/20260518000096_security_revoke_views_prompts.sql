-- ================================================================
-- Migration 96: Security — revoke feedback_readable + prompt_versions anon
-- ================================================================
-- feedback_readable view: revoke public access (admin-only view)
-- prompt_versions: remove anon read policy (used only by service role EFs)
-- ================================================================

REVOKE SELECT ON public.feedback_readable FROM anon, authenticated;

DROP POLICY "prompt_versions: anon read" ON public.prompt_versions;
