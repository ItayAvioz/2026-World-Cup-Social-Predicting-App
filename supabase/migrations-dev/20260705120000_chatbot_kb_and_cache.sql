-- target: dev-only
-- DO NOT apply to PROD. Ever. (per docs/PLAN_PROD_CUTOVER.md §3)
--
-- Chatbot RAG + semantic cache foundation for the in-app `ask` Edge Function.
--   • kb_embeddings : stat-cards (team/player/rule/game) + embedding, for RAG retrieval
--   • match_kb()    : top-k cosine search over kb_embeddings (public read)
--   • qa_cache      : semantic answer cache (RULES intent only) — service-role writes
--   • match_cache() : nearest cached Q&A (SECURITY DEFINER; qa_cache has no public SELECT)
--
-- Captured from the live DEV project (applied via MCP in an earlier session with no local
-- file). This migration reproduces that exact state; it is idempotent (no-op on DEV).
-- Embeddings = OpenAI text-embedding-3-small (1536 dims), written by the `ask` EF's
-- reindex_kb (service-role) and cacheWrite paths.

create extension if not exists vector;

-- ── RAG knowledge base ──────────────────────────────────────────────────────
create table if not exists public.kb_embeddings (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,                 -- 'team' | 'player' | 'rule' | 'game'
  ref_id     text,
  title      text,
  content    text not null,
  embedding  vector(1536),
  updated_at timestamptz not null default now()
);
create index if not exists kb_embeddings_embedding_idx
  on public.kb_embeddings using hnsw (embedding vector_cosine_ops);

alter table public.kb_embeddings enable row level security;
drop policy if exists "kb public read" on public.kb_embeddings;
create policy "kb public read" on public.kb_embeddings
  for select using (true);
revoke insert, update, delete on public.kb_embeddings from anon, authenticated;

create or replace function public.match_kb(
  query_embedding vector(1536),
  match_count int default 6,
  kind_filter text default null
)
returns table (kind text, title text, content text, similarity float)
language sql stable
as $$
  select k.kind, k.title, k.content, 1 - (k.embedding <=> query_embedding) as similarity
  from public.kb_embeddings k
  where k.embedding is not null and (kind_filter is null or k.kind = kind_filter)
  order by k.embedding <=> query_embedding
  limit match_count
$$;
grant execute on function public.match_kb(vector, int, text) to anon, authenticated;

-- ── Semantic answer cache (RULES intent only) ───────────────────────────────
create table if not exists public.qa_cache (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  embedding  vector(1536),
  intent     text,
  answer     text not null,
  created_at timestamptz not null default now()
);
create index if not exists qa_cache_embedding_idx
  on public.qa_cache using hnsw (embedding vector_cosine_ops);

-- RLS on, NO public SELECT policy: rows are only reachable via match_cache (DEFINER).
alter table public.qa_cache enable row level security;
revoke insert, update, delete on public.qa_cache from anon, authenticated;

create or replace function public.match_cache(
  query_embedding vector(1536)
)
returns table (answer text, intent text, similarity float)
language sql stable security definer
set search_path to 'public'
as $$
  select c.answer, c.intent, 1 - (c.embedding <=> query_embedding) as similarity
  from public.qa_cache c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit 1
$$;
grant execute on function public.match_cache(vector) to anon, authenticated;
