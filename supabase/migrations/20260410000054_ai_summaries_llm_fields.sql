-- Migration 54: Add LLM feature columns to ai_summaries
-- Stores the full OpenAI call parameters + input payload alongside content/tokens
-- Enables end-to-end traceability: DB data → LLM input → LLM output

ALTER TABLE public.ai_summaries
  ADD COLUMN input_json   jsonb,       -- compact JSON payload sent to OpenAI
  ADD COLUMN temperature  numeric,     -- e.g. 0.5
  ADD COLUMN top_p        numeric,     -- e.g. 1
  ADD COLUMN max_tokens   int,         -- e.g. 400
  ADD COLUMN seed         int;         -- fixed seed for reproducibility
