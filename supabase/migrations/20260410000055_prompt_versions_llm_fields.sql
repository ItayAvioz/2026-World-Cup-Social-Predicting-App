-- Migration 55: Add LLM feature columns to prompt_versions
-- Stores the model params used during test runs alongside test_input/test_output

ALTER TABLE public.prompt_versions
  ADD COLUMN test_temperature numeric,
  ADD COLUMN test_top_p       numeric,
  ADD COLUMN test_max_tokens  int,
  ADD COLUMN test_seed        int;
