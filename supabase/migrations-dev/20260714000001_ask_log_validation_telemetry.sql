-- ask bot (DEV only): v29 P0b/P9 telemetry columns on ask_log.
-- validation_fail: which deterministic check (if any) rejected an answer before it shipped
--   (repeat_guard is the only one wired to write it so far — see index.ts `done()`).
-- expected_shape / rows_count: reserved for the full shape-renderer + validation-layer pass
--   (docs/PLAN_ASK_BOT_VALIDATION_SPEC.md) — added now so that work needs no further migration.
-- Same RLS convention as the base table (M130): revoke all from anon/authenticated, no policies.
-- target: dev-only (promote with the other chatbot migrations at PROD cutover)

alter table public.ask_log
  add column if not exists validation_fail text,
  add column if not exists expected_shape text,
  add column if not exists rows_count int;
