-- v32: session telemetry — the AskBot widget sends a per-mount session id + turn counter so a
-- whole conversation can be reconstructed from ask_log (multi-turn bugs were un-groupable).
-- Observability only; never used for routing. DEV only (ask bot is DEV-gated).
alter table public.ask_log
  add column if not exists session_id text,
  add column if not exists session_turn integer;
create index if not exists ask_log_session_idx on public.ask_log (session_id, session_turn);
