-- target: dev-only
-- DO NOT apply to PROD. Ever. (per docs/PLAN_PROD_CUTOVER.md §3)
--
-- Chatbot P2 — dimension (stat-label) classifier for the in-app bot.
-- Same machinery as intent_examples/match_intent, but for the STAT DIMENSION
-- (goals|assists|defense|attack|possession|corners|fouls|cards|form). Lets the
-- bot understand paraphrased labels ("leaky at the back" -> defense) instead of
-- relying only on hard-coded keyword regexes.
--
-- Embeddings are OpenAI text-embedding-3-small (1536 dims), written by the `ask`
-- Edge Function's `reindex_dims` mode (service-role). Public SELECT only.

create extension if not exists vector;

create table if not exists public.dim_examples (
  id         uuid primary key default gen_random_uuid(),
  dim        text not null,
  example    text not null,
  embedding  vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists dim_examples_embedding_idx
  on public.dim_examples using hnsw (embedding vector_cosine_ops);

alter table public.dim_examples enable row level security;
drop policy if exists "dim_examples public read" on public.dim_examples;
create policy "dim_examples public read" on public.dim_examples
  for select using (true);
revoke insert, update, delete on public.dim_examples from anon, authenticated;

create or replace function public.match_dim(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (dim text, example text, similarity float)
language sql stable
as $$
  select de.dim,
         de.example,
         1 - (de.embedding <=> query_embedding) as similarity
  from public.dim_examples de
  where de.embedding is not null
  order by de.embedding <=> query_embedding
  limit match_count
$$;

grant execute on function public.match_dim(vector, int) to anon, authenticated;
