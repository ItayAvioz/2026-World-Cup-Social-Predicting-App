# `ask` — in-app AI assistant (DEV ONLY)

Deterministic-first Q&A bot for the WorldCup 2026 app. Explains the app/competition and answers
live data questions (schedule, scorers, stats, standings, counts, per-game box scores, "my" data).
**DEV project only** (`ftryuvfdihmhlzvbpfeu`). Never deploy to PROD.

## Source of truth = this repo
- **`index.ts`** — the whole Edge Function (routing spine + all tools). Local file is authoritative.
- **DB migrations** (`supabase/migrations-dev/`, all `-- target: dev-only`):
  - `20260705120000_chatbot_kb_and_cache.sql` — `kb_embeddings`/`match_kb` (RAG) + `qa_cache`/`match_cache` (semantic cache)
  - `20260706000000_chatbot_intent_embeddings.sql` — `intent_examples`/`match_intent` (intent classifier)
  - `20260706100000_chatbot_dim_examples.sql` — `dim_examples`/`match_dim` (stat-dimension classifier)
- **Frontend**: `src/components/AskBot.jsx` (chat widget, dev-host-guarded, sends last 2 turns as `history`) + mounted in `src/components/Layout.jsx`.

## Deployed vs local
Deploy via **Supabase CLI from the local file** (the MCP inline-deploy path chokes on the ~62KB size):
```bash
# from repo root
npx supabase functions deploy ask --project-ref ftryuvfdihmhlzvbpfeu
```
> Current: DEV runs **v19** and the local file **matches it byte-for-byte** (verified 2026-07-12 via
> `get_edge_function` diff). v15 `gameStats`; v16 global board one-row-per-(player×group);
> v17 routing fixes (private intents before public overrides; rulesFAQ short-circuit; op/dim gaps) — needed
> a reindex; v18 cleaned up v17's regressions (broad global-leaderboard detector, box-score first-person
> guard removed, rulesFAQ collision fixes, scoped `fixtures? for`) — code-only, NO reindex.
> **v19 (spec-driven private tools + compound questions, code-only, NO reindex):** routing extracted
> into `routeQuestion()`; `splitCompound` answers BOTH clauses of "…and when is the final?";
> `my_data` routes on keywords to focused sub-tools — `myExact` (count **and which games**),
> `myFocus` (rank / points / picks), `myContext` fallback — and every private tool honors a group
> the caller names ("in Alpha Wolves") via `resolveGroupName` over the caller's OWN groups only;
> `groupStandings` likewise group-scopable. Re-embed after changing `INTENT_EXAMPLES` /
> `DIM_EXAMPLES` / stat-card text (see below); code-only changes like v15/v18/v19 need no reindex.
>
> Deploy path that actually works here: the **Supabase MCP `deploy_edge_function`** tool (its own
> auth — no CLI login/token needed), pinned to `project_id: ftryuvfdihmhlzvbpfeu`. The CLI path
> (`npx supabase functions deploy`) needs `SUPABASE_ACCESS_TOKEN`, which this shell doesn't have.

## Apply migrations (idempotent — already applied on DEV)
```bash
# each file is dev-only; apply to the DEV project only
npx supabase db push --project-ref ftryuvfdihmhlzvbpfeu   # or run each file via the SQL editor
```

## Reindex (after editing examples or stat-card text)
The embeddings live in DB tables; regenerate them via the EF's reindex modes (service-role internally).
Use the DEV anon/publishable key as bearer:
```bash
KEY=sb_publishable_hNTtICDrKMNgAclh28BhrQ_bHTeeFB9
URL=https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/ask
for M in reindex_intents reindex_dims reindex_kb; do
  curl -s -X POST "$URL" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" -d "{\"mode\":\"$M\"}"; echo
done
# clear stale cached answers after changing the rules prompt / rules-FAQ:
#   DELETE FROM public.qa_cache;   (SQL editor)
```
- `reindex_intents` — re-embed `INTENT_EXAMPLES` → `intent_examples`
- `reindex_dims` — re-embed `DIM_EXAMPLES` → `dim_examples`
- `reindex_kb` — rebuild stat-cards from `team_tournament_stats` + `player_tournament_stats` (paginated past the 1000-row cap) → `kb_embeddings`

## Architecture (one line)
`preGuard+rateLimit → embed once → QuerySpec {intent[E] · op · dim[E] · entities · confidence} →
deterministic SQL tool (schedule / scorers / game-detail / game-stats / leaderboards / aggregates /
compare / bracket / global / my-data) OR fuzzy RAG+crew [L] → template → log + rules-only cache`.
LLM only for fuzzy "describe" stats, the rules-FAQ fallback, and off-topic steer-back.

## Local test harnesses
`scripts/ask/bot_test.mjs` POSTs a 200-question set (by topic × complexity) and grades ROUTING
(private intents are anon-gated, so answer-correctness isn't graded there). Run after any change:
```bash
node scripts/ask/bot_test.mjs scripts/ask/bot_results.json   # writes results + prints a summary
```
Note it grades routing only, not answer correctness — spot-check answers against the DB by hand.

**`scripts/ask/wide_test.mjs` — answer-graded, incl. the PRIVATE path.** Signs in as the seeded
e2e user `bot_e2e_test` (bot.e2e.test.wc2026@gmail.com — groups **Alpha Wolves** 2 exact / 4 preds,
**Beta Sharks** 1 exact / 2 preds, known picks) and asserts expected substrings in the ANSWER,
including negative `!substring` scoping checks (e.g. Beta's games must NOT leak into an
Alpha-scoped answer). 29 questions across areas × complexity. v19 = 29/29.
```bash
node scripts/ask/wide_test.mjs scripts/ask/wide_results.json
```
⚠️ Dev data gotcha: the national-team KO rows (Brazil/England finals etc.) are SYNTHETIC test
games — no/inconsistent `game_team_stats` and no `team_tournament_stats` rows. Stats/box
questions in tests must use teams from REAL synced games (club test data, Argentina, Austria…).

## Secrets (EF env, already set on DEV)
`AI_Summary_GPT_Key` (OpenAI), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
