-- target: dev-only
-- DO NOT apply to PROD. Ever. (per docs/PLAN_PROD_CUTOVER.md §3)
--
-- Chatbot Step 5 — embeddings foundation for the in-app bot's intent classifier.
--   • enable pgvector
--   • intent_examples: curated example questions per intent + their embedding
--   • match_intent(): nearest-neighbour cosine search → used to classify a question
--
-- Embeddings are OpenAI text-embedding-3-small (1536 dims), written by the `ask`
-- Edge Function's `reindex_intents` mode (service-role). Public SELECT only.

create extension if not exists vector;

create table if not exists public.intent_examples (
  id         uuid primary key default gen_random_uuid(),
  intent     text not null,
  example    text not null,
  embedding  vector(1536),
  created_at timestamptz not null default now()
);

-- cosine-distance index (small table, HNSW is fine)
create index if not exists intent_examples_embedding_idx
  on public.intent_examples using hnsw (embedding vector_cosine_ops);

-- RLS: readable by everyone (no private data here); writes only via service role.
alter table public.intent_examples enable row level security;
drop policy if exists "intent_examples public read" on public.intent_examples;
create policy "intent_examples public read" on public.intent_examples
  for select using (true);

revoke insert, update, delete on public.intent_examples from anon, authenticated;

-- Nearest-example search. Returns the closest curated examples with a cosine
-- similarity score (1 = identical direction, 0 = orthogonal).
create or replace function public.match_intent(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (intent text, example text, similarity float)
language sql stable
as $$
  select ie.intent,
         ie.example,
         1 - (ie.embedding <=> query_embedding) as similarity
  from public.intent_examples ie
  where ie.embedding is not null
  order by ie.embedding <=> query_embedding
  limit match_count
$$;

grant execute on function public.match_intent(vector, int) to anon, authenticated;
