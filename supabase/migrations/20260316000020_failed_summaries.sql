-- Migration 20: failed_summaries table
-- Stores Claude-generated summary text when ai_summaries INSERT fails
-- Prevents losing generated content on DB write errors
-- Tomorrow re-run reads this table → retries INSERT → marks resolved

CREATE TABLE IF NOT EXISTS public.failed_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  date        date NOT NULL,
  content     text NOT NULL,
  error_msg   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved    boolean NOT NULL DEFAULT false,
  resolved_at timestamptz
);

-- Index for re-run query (find unresolved failures)
CREATE INDEX IF NOT EXISTS failed_summaries_unresolved
  ON public.failed_summaries (resolved, date)
  WHERE resolved = false;

-- RLS: service role only (Edge Function reads/writes this)
ALTER TABLE public.failed_summaries ENABLE ROW LEVEL SECURITY;
-- No client-facing policies — EF uses service_role which bypasses RLS
