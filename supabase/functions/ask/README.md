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
Deploy via the **Supabase MCP `deploy_edge_function`** tool (own auth, no token needed),
`project_id: ftryuvfdihmhlzvbpfeu`, `verify_jwt: true`, `files=[{name:'index.ts', content:<full file>}]`
— paste the file content VERBATIM from generated chunks, never retype. The CLI path
(`npx supabase functions deploy ask --project-ref ftryuvfdihmhlzvbpfeu`) also works but needs
`SUPABASE_ACCESS_TOKEN`, which this shell doesn't have. After deploying, diff `get_edge_function`
against the local file (expect CRLF→LF + trailing-newline normalization only).
> Current: DEV runs **v25** and the local file **matches it** (verified 2026-07-13 via
> `get_edge_function` diff — identical modulo CRLF→LF normalization + trailing newline; the local
> file is CRLF on this Windows checkout, the deploy stores LF). Wide test **75/75**.
>
> **v24/v25 (workflow-probe fixes, code-only, NO reindex):** a 54-agent workflow probed the bot
> with 107 questions across 10 topics × difficulty, graded answers against DB ground truth and
> adversarially verified every claim → **40 confirmed failures** (1 critical, 26 major, 13 minor),
> all fixed: (a) TIME-AWARE phase lookups — a future-kickoff game is never "was" and never shows
> its (dev-quirk) score; same fix in groupHistory/memberPrediction headers; (b) `TYPO_STOP` on the
> resolveTeams lev pass — "place"→Crystal PALACE and "leads"→LEEDS were hijacking schedule
> questions with ghost teams ("when do the semi finals take place?" answered "matchup isn't set
> yet" because it looked up Crystal Palace's semi-final); lookupGame also retries phase-only when
> a team+phase query is empty; (c) "how/where do I …" = HOW-TO → rules path, never NEED_LOGIN or
> a data dump; (d) rules-FAQ +5: whole-round bonuses (QF+12/SF+10/Final+8/3rd+6), leaderboard
> tie-breaks, points fold-in timeline, 90-min-vs-ET/pens scoring (placed BEFORE the generic
> outcome line), and it beats the bare "leaderboard" keyword; (e) follow-up "and portugal?" /
> "what about the USA?" applies the PREVIOUS question's shape (next-game / bracket-status / last
> game) to the new team; teams+phase borrowing decoupled from op borrowing; (f) member-vs-me
> standings ("who has more points, me or X?" → the group table, in the tools AND execUnderstood);
> (g) `userPicksPublic` — another user's champion/top-scorer picks are public after the June-11
> lock (the leaderboard shows them) so "what is Dani's champion pick?" answers from the public
> RPC instead of dumping YOUR OWN picks; (h) guards: unknown team ("when does Wakanda play"),
> non-2026 years, untracked stats (attendance/referee/stadium), 1-2-word fragments → clarify;
> (i) `groupRefCandidate` verb/filler stoplist extended + globalCue skips any NAMED group (the
> "Kanta Bayam leaderboard" probe got the global board instead of a privacy refusal); privateOk
> gate: my_data/group_history-classified questions with a team but no first-person/group cue are
> public ("did holland win there last game" hit the sign-in gate); (j) rank-override runs before
> the count/agg block ("per game" no longer flips rank questions into tournament progress);
> who_scored falls back to date/phase list ("score of tomorrow's game"); resolveDate accepts
> "tomorrows"; splitCompound accepts "which" tails; RULES corrected: 5 bottom-nav tabs incl.
> Trivia, 90-min scoring, tie-break note (⚠️ RULES changed → `DELETE FROM qa_cache` was run).
>
> **v23 (live-transcript fixes, code-only, NO reindex):** (a) "the NEXT/coming game" gets a deterministic route to the
> next-fixture lookup — the follow-up op-borrowing (P3) merged the PREVIOUS turn ("how much points
> champion and top scorer?") into the context, `detectOp` saw "how much" and flipped the op to
> `count` → tournament progress ("94 of 170 games") instead of the next fixture. Time-direction
> (like v22's "last game") must be deterministic — embeddings can't see it. (b) `group_history`
> now resolves a named group: YOUR group scopes the answer (`groupHistory(..., target)` filters by
> `group_id`), a foreign/unknown one refuses via `unknownGroupAnswer` — "what was the legends group
> predictions for argentina colombia?" used to dump ALL the caller's groups' predictions.
> `groupRefCandidate` generalized: any "<words> group" qualifies (was preposition-anchored), with
> filler-token stripping + noun stoplist so "group stage"/"group predictions" never trip it.
> (c) new `etPensList` tool — "which games went to penalties / extra time?" lists finished games
> from the `went_to_*` flags (was misrouted to the upcoming-fixtures list); count phrasings
> ("how many games went to ET") answer with the count. Rules-phrasings ("what happens if a game
> goes to penalties") are excluded and still reach the rules path. (d) fixture lists never show a
> score for a game that hasn't kicked off (dev future-scored rows leaked as "upcoming" results).
> (e) rules-FAQ: "how much" variants accepted; champion+top-scorer asked TOGETHER answers both
> (each single FAQ line used to drop half); group-size answer covers min ("no minimum") + max 12.
> Wide test 49/49 (added nextgame ×2 incl. a history-replay of the live bug, pens ×2, foreign-group
> prediction leak, how-much FAQ ×2, min/max members).
>
> **v22 (last-game time-direction fix, code-only):** "what was the LAST
> finished game?" used to fall into the next-game lookup and answer with the NEXT fixture. New
> deterministic override (before box-score): a past ref (last/latest/previous/most recent/yesterday's
> game·match·result·score, excluding "next/upcoming/last 16") resolves the most recent KICKED-OFF
> finished game via `resolveGameRef` → `gameDetail` (result incl. ET/pens) or `whoScored` when the
> question asks for scorers. Note: the LLM fallback could NOT catch this class — the classifier was
> confidently (not ambiguously) wrong, and the fallback only fires on ambiguity; time-direction is a
> deterministic-routing concern. **v20/v21 (privacy clarity + LLM understanding fallback, code-only, NO
> reindex):** (a) every locked door says WHY — pre-kickoff predictions answer "hidden until kickoff",
> a group you're not in answers "private to their members" (foreign-group names detected
> deterministically incl. typos, `groupRefCandidate` + `unknownGroupAnswer`); (b) new entities:
> group-MATE usernames (`resolveMemberName`, typo-tolerant) + relative game refs ("the last game",
> "the final") via `resolveGameRef`; new tools `memberPrediction` (a mate's pick for one game —
> RLS decides, message explains) and `groupMeta` (member count / list / captain — real data; the
> rules-FAQ cap answer now fires only for "how many members CAN..."); (c) **LLM understanding
> fallback** — when routing is ambiguous (clarify band), when group_history lacks a game, or when a
> "stats" question names your group/mate, ONE gpt-4o-mini call parses the QUESTION TEXT ONLY into
> `{asks, group, member, teams, game_ref, stat}` and `execUnderstood` runs it 100% deterministically.
> No DB data ever reaches the LLM through this path. Wide test 39/39 (v18 baseline was 24/29).
>
> History: v15 `gameStats`; v16 global board one-row-per-(player×group);
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
**Beta Sharks** 1 exact / 2 preds + mate `bot_e2e_mate` with a visible Portugal-USA pred 0-1 and an
RLS-hidden pre-kickoff final pred 2-0, known picks) and asserts expected substrings in the ANSWER,
including negative `!substring` scoping/leak checks (e.g. the mate's hidden 2-0 must NEVER appear).
75 questions across areas × complexity incl. privacy-refusal, last/next-game, time-tense,
how-to, member-compare and workflow-probe regression cases. v25 = 75/75.
Rows may carry an optional 6th element: prior-turn questions sent as `history` (reproduces
follow-up borrowing bugs — the v23 nextgame case replays the exact live two-turn failure).
(One expectation is deliberately loose: colloquial group questions may be read by the LLM
fallback as the group board OR your own standing — both are valid answers.)
```bash
node scripts/ask/wide_test.mjs scripts/ask/wide_results.json
```

**`scripts/ask/probe.mjs` — ad-hoc batch runner (used by test agents).** Feed it a JSON file of
`[{q, auth?, history?}]`, get back `{q, intent, llm, answer}` per question; paces 2.5s between
questions and retries through the 30/60s rate limit.
⚠️ Dev data gotcha: the national-team KO rows (Brazil/England finals etc.) are SYNTHETIC test
games — no/inconsistent `game_team_stats` and no `team_tournament_stats` rows. Stats/box
questions in tests must use teams from REAL synced games (club test data, Argentina, Austria…).

## Secrets (EF env, already set on DEV)
`AI_Summary_GPT_Key` (OpenAI), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
