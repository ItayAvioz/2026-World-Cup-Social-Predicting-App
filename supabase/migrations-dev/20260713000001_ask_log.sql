-- ask bot (DEV only): persisted question->route->answer log for debugging user complaints.
-- Service-role only: RLS on with no policies + all client grants revoked (M130 convention).
-- target: dev-only (promote with the other chatbot migrations at PROD cutover)

create table if not exists public.ask_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  question text,
  intent text,
  route text,
  answer text,
  llm_used boolean,
  latency_ms int
);

alter table public.ask_log enable row level security;
revoke all on table public.ask_log from anon, authenticated;

create index if not exists ask_log_created_at_idx on public.ask_log (created_at desc);
