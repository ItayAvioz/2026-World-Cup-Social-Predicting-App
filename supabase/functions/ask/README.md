# `ask` — in-app AI assistant (DEV ONLY)

Deterministic-first Q&A bot for the WorldCup 2026 app. Explains the app/competition and answers
live data questions (schedule, scorers, stats, standings, counts, per-game box scores, "my" data).
**DEV project only** (`ftryuvfdihmhlzvbpfeu`). Never deploy to PROD.

## Source of truth = this repo
- **`index.ts`** — the whole Edge Function (routing spine + all tools). Local file is authoritative.
- **DB migrations** (`supabase/migrations-dev/`, all `-- target: dev-only`):
  - `20260705120000_chatbot_kb_and_cache.sql` — `kb_embeddings`/`match_kb` (RAG) + `qa_cache`/`match_cache` (⚠️ the cache is NO LONGER USED as of v26 — see below)
  - `20260706000000_chatbot_intent_embeddings.sql` — `intent_examples`/`match_intent` (intent classifier)
  - `20260706100000_chatbot_dim_examples.sql` — `dim_examples`/`match_dim` (stat-dimension classifier)
  - `20260713000001_ask_log.sql` — **`ask_log`** (question → route → answer → latency; RLS on, service-role only)
  - `20260714000001_ask_log_validation_telemetry.sql` — adds `validation_fail`/`expected_shape`/`rows_count` to `ask_log` (v29 P0b/P9 — only `validation_fail='repeat'` is written so far, by V1)
- **Frontend**: `src/components/AskBot.jsx` (chat widget, dev-host-guarded; sends the last **3** user turns as `history` **plus** `last_answer` and `prev_spec` for structured/answer-aware follow-ups) + mounted in `src/components/Layout.jsx`.

## Coverage matrix (what the bot answers, refuses, or clarifies)
Anything not in this table should **refuse or clarify** — never substitute a nearby answer.

| Domain | Answers | Tools |
|---|---|---|
| Schedule | next/last game (per team, per phase), fixture lists by date/phase, tournament progress, "when is the last game" (future) | `lookupGame` `scheduleList` `tournamentProgress` |
| Results | score, scorers, ET/pens, box score, single stat per game, ET/pens game lists | `whoScored` `gameDetail` `gameStats` `gameStatSingle` `etPensList` |
| Team stats | leaders per dim (goals/assists/cards/defense/possession/corners/fouls/offsides/shots) — **direction-aware** (explicit "least/fewest/lowest" flips the default pole, e.g. "least possession" ≠ "most possession"), **game-scoped** variants for goals/red/yellow/corners ("which game had the most red cards?" answers a GAME, not a player), compare, per-team totals, recent form / last-N, bracket status | `statLeaderboard` `gameGoalsLeaderboard` `gameCardLeaderboard` `compareTeams` `teamStat` `recentForm` `bracketStatus` |
| Player stats | per-player totals, player counts ("how many players got a red card") | `resolvePlayer`+`playerStat` `playerCount` |
| Odds | game odds (Bet365), champion outright odds (William Hill) | `gameOddsAnswer` `championOddsAnswer` |
| WC groups A–L | computed group tables (sourced from `teams.group_name` — clean 4/group), "who finished 1st/last" | `tournamentGroupTable` |
| Trivia | total question count, **the 24h open window** (a day's question stays open 22:00→22:00 Israel — separate from the 40s answer countdown), "is there one today", **my own trivia score** (private) | `triviaInfo` `myTriviaScore` |
| Top scorer candidates | who's eligible to pick, per-team candidate list | `topScorerCandidates` |
| Card totals | tournament-wide red/yellow card sums (a `SUM()`, never RAG) | `cardsTotal` |
| Regulation penalties | penalty kicks (scored or missed) awarded **in regular time (90 min)** — distinct from a penalty SHOOTOUT, which `etPensList` already covers | `regulationPenaltyList` |
| My data | rank, points, picks, exact scores (+which games), exact%/hit%/streak, **best/longest hot or cold streak** (direction-aware — "positive/hot" vs "negative/cold" vs bare "streak"), my bracket, points from a match-day, best-performing group ("which of my groups...") | `myFocus` `myExact` `myRates` `ratesFor` `myBestGroup` `myBracket` `dayPoints` |
| Group data | standings, members/captain, group predictions per game, a mate's prediction, who picked X, **the most popular champion/top-scorer pick** ("which team is most chosen for champion, and how much?" — a real tally across members, never the caller's own pick), latest AI roast | `groupStandings` `groupMeta` `groupHistory` `memberPrediction` `whoPicked` `mostPopularPick` `latestRoast` |
| Global | global leaderboard, another user's (public, post-lock) picks | `globalStandings` `userPicksPublic` |
| Rules/how-to | scoring, deadlines, caps, bracket rules, tie-breaks, fold-in dates, navigation, roast timing, inactive members, self-service locks | `rulesFAQ` → grounded RULES LLM (v29: FACTS block with today's real date) |
| Courtesy | "thanks" / "ok" / "cool" — never touches data, auth, or the LLM | `courtesy` route |
| **Refuses** | other groups' data (incl. near-miss names like `test3` vs `TestA`), pre-kickoff predictions, non-2026 years, unknown teams, untracked stats (attendance/referee/venue/city/weather/throw-ins/VAR) | deterministic guards |
| **Clarifies** | bare superlatives with no metric, 1–2-word fragments, genuinely ambiguous intents | clarify band → LLM understanding fallback |

**Public vs private line (decided, see memory `ask-bot-public-private-line.md`):** champion/top-scorer
picks, group **names**, and global leaderboard rank+points are PUBLIC after the June-11 lock — the
bot may answer them for ANY user, including the group label (`what is dani's champion pick?` →
`[Demo] champion Netherlands`). PRIVATE, always: predictions before that game's kickoff, and any
group the caller is not a member of (its board/members/predictions). The test is "is this field
already public in the app UI?", not "whose data is it" — don't harden picks/ranks into refusals.

## Deploy
**Use the CLI. One command, from disk:**
```bash
npx supabase functions deploy ask --project-ref ftryuvfdihmhlzvbpfeu
node scripts/ask/eval.mjs             # must print wide_test=PASS real_chat_test=PASS
```
`verify_jwt` stays `true` (there is no `supabase/config.toml`, and the CLI default matches the live
setting — don't add one without checking). **DEV project only** — never pass the PROD ref
(`asugxlvgcmkxspzokydk`).

If the CLI says `Access token not provided`, run `npx supabase login` once (browser flow).

> ### ⚠️ Do NOT deploy this EF via the MCP `deploy_edge_function` tool
> That tool takes the source as an **inline string argument**, so the whole file must fit in ONE tool
> call. `index.ts` is ~151KB and does not fit. **A truncated deploy silently ships a fragment with no
> `serve()` handler, and the function then 504s on every request.** That happened twice (once for
> ~2 hours), both times via subagents. Splitting `index.ts` into modules does NOT help — the call
> still carries every file's content.
>
> There used to be a `scripts/ask/build.cjs` + `verify_deploy.mjs` workaround (strip comments to
> squeeze a ~120KB bundle into one call, then byte-diff the result). **Both are deleted.** The v28
> rule table pushed the bundle to 121.5KB — past the ceiling — which is what finally forced the CLI.
> Don't resurrect them; `supabase login` is the fix.
>
> Current: DEV runs EF **version 57** = **v30 deep-audit fixes** (docs/PLAN_ASK_BOT_V29.md Part 3 —
> 6 fixes from a live-code-and-DB-verified audit, NOT the full understand-first rewrite), deployed
> from disk 2026-07-15.
> **`node scripts/ask/eval.mjs` → wide_test 110/110, real_chat_test 22/22.** No reindex needed
> (v30 added tools/rules, not embedding examples — INTENT_EXAMPLES/DIM_EXAMPLES unchanged).
> v30 fixed: (1) game-scoped stat superlatives ("which game had the most red cards?" answered a
> PLAYER — now answers a game, generalized across goals/red/yellow/corners); (2) superlative
> DIRECTION ("which team conceded the most?" answered the BEST defense, hardcoded `dir` ignored
> the question's actual polarity — same latent bug existed for "least possession"/"fewest fouls");
> (3) champion/top-scorer pick POPULARITY ("most chosen for champion?" answered the caller's own
> single pick — no tool counted anyone); (4) streak DIRECTION ("my positive/hot streak" answered
> whatever the CURRENT trailing streak happened to be, cold or not); (5) trivia's 24h open window
> (only the 40s answer countdown was ever stated); (6) in-regulation penalty kicks conflated with
> penalty SHOOTOUTS. Also hardened `AskBot.jsx`'s `lastBot` derivation (dropped a `.spec`-presence
> filter that could skip the true last bot reply) — **frontend change committed, NOT yet deployed
> to gh-pages** (that's a separate manual step). One finding from the audit — a possible
> context-bleed mechanism — was investigated and the originally-hypothesized backend mechanism was
> **disproven by code reading** (the dim-borrow path only fires on `op:'lookup'`, mutually
> exclusive with the rule it was thought to hijack, which requires `op:'rank'`); no backend fix
> shipped for it — see PLAN_ASK_BOT_V29.md Part 3 "Still open".
>
> **v27 (coverage + conversation). ⚠️ needs `reindex_dims` (DIM_EXAMPLES changed).**
> Four whole data domains the UI ships but the bot had NO tools for: **odds** (game Bet365 +
> champion William Hill), the **knockout-bracket game** (`myBracket` → `fn_knockout_points`, with
> the pre-Jul-20 fold-in caveat stated), the **AI roast** (`latestRoast` + timing FAQ), and
> **tournament groups A–L** (`tournamentGroupTable`; a single letter A–L is never treated as a
> friend-group name, which used to collide with the friend-group board). Plus: reverse pick lookup
> (`whoPicked` — "who picked France in my group?" used to return YOUR OWN picks); match-day-scoped
> points (`dayPoints`, on the 07:30-UTC match-day boundary the rest of the app uses); `recentForm`
> (last-N W/D/L strip → form/trend/"is X improving"); `myRates` (Exact% / Hit% / Hot-Cold streak —
> trained intent examples existed with no implementing tool); kickoffs now show **Israel time** and
> today/tomorrow resolve on the **Israel day**; venue/city/time-zone joins the untracked-stat guard;
> new `offsides` + `shots` stat dims. **RULES corrected** — it claimed auto-predict is "random"
> while the app (and the bot's own FAQ) is **contrarian**; added inactive-member semantics, the
> June-11 self-service locks, post-lock pick visibility, the top-scorer tie rule, bracket
> visibility, and roast timing.
> **Conversation:** the client now echoes `prev_spec` (last resolved teams/dim) + `last_answer` +
> 3 user turns. Borrowing prefers the ECHOED spec over re-parsing prior question text; entities
> also resolve from the last ANSWER, so "who is the top scorer?" → "how many goals does **he**
> have?" works. Compound clause 2 receives clause 1's RESOLVED spec. `llmUnderstand` gained public
> asks (schedule / game_stat / leaderboard) and now runs for ANON users too (private asks still
> require login), and it receives the partial deterministic parse so it only fills the gaps.
>
> **v26 (trust + resilience; from a 6-agent audit → 60+ findings). Code-only, NO reindex.**
> TRUST: group typo-matching NEVER substitutes a distinct name — digit-bearing tokens are excluded
> from the lev pass, so `test3` (a real group the caller is NOT in) is refused instead of silently
> resolving to their `TestA` (**a privacy near-leak**); "`<Name>` leaderboard" (without the literal
> word "group") now reaches the group tools instead of dumping the GLOBAL board; "when is the LAST
> game (of the tournament/phase)" is a FUTURE schedule question (it answered a played QF); the
> pick-value FAQs no longer swallow stat questions ("how many goals does the top scorer have?" →
> "…worth 10 points"); a superlative inside a count question answers the leader, not tournament
> totals; the box score now appends the shared ET/pens line; `etPensList` includes friendlies
> (labeled) — it answered "no games have gone to penalties" while a 4-3 shootout sat in the flags;
> compound split rejects verb-less tails and a clause-2 clarify can no longer pollute a good
> clause-1 answer; new `gameStatSingle` + `playerCount`; `bracketStatus` ignores future-kickoff rows
> (it declared a champion days before the final).
> RESILIENCE/SECURITY: an OpenAI outage no longer kills the deterministic routes (embed/classify in
> try/catch → keyword-only degraded mode; 12s client timeout — the SDK default was **10 minutes**);
> DB errors now throw via `must()` instead of reading as confident empty answers ("You have no exact
> scores yet" on a blip); the catch-all returns a friendly degraded message, never raw internals;
> **`ask_log`** records every question → route → answer → latency; rate-limit keyed per **user+IP**
> (every signed-out visitor shared ONE bucket); history items are length-capped + preGuarded;
> **reindex modes now require the service-role key** (the public anon key could delete + re-embed
> whole tables and spend OpenAI money); the **cross-user `qa_cache` was REMOVED** (an injected
> "rules question" could get its LLM answer cached and served to OTHER users at ≥0.93 similarity);
> `answerCrew` is now ONE structured call + a **deterministic** grounding check (every number in the
> answer must appear in the facts) + an evidence gate (zero cards ⇒ no LLM call at all) — the old
> LLM judge silently PASSED answers whenever its JSON failed to parse.
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
> (Deploy path: see **Deploy** at the top — the CLI, from disk. The MCP `deploy_edge_function`
> tool must NOT be used for this EF; the file no longer fits in one tool call.)

## Apply migrations (idempotent — already applied on DEV)
```bash
# each file is dev-only; apply to the DEV project only
npx supabase db push --project-ref ftryuvfdihmhlzvbpfeu   # or run each file via the SQL editor
```

## Reindex (after editing examples or stat-card text)
The embeddings live in DB tables; regenerate them via the EF's reindex modes.
⚠️ **v26+: reindex requires the SERVICE-ROLE key** as bearer — the public anon key is rejected (403).
It deletes and re-embeds whole tables, so it must not be reachable by anyone holding the anon key.
```bash
SR=<SUPABASE_SERVICE_ROLE_KEY for ftryuvfdihmhlzvbpfeu>   # Supabase dashboard → Settings → API
URL=https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/ask
for M in reindex_intents reindex_dims reindex_kb; do
  curl -s -X POST "$URL" -H "apikey: $SR" -H "Authorization: Bearer $SR" \
    -H "Content-Type: application/json" -d "{\"mode\":\"$M\"}"; echo
done
```
No cache flush is needed any more — the `qa_cache` answer cache was removed in v26 (it was
poisonable across users). The table still exists but is unused.
- `reindex_intents` — re-embed `INTENT_EXAMPLES` → `intent_examples`
- `reindex_dims` — re-embed `DIM_EXAMPLES` → `dim_examples`
- `reindex_kb` — rebuild stat-cards from `team_tournament_stats` + `player_tournament_stats` (paginated past the 1000-row cap) → `kb_embeddings`

## Update workflow — ship any change to this EF

The one sequence every change follows, in order. Skipping a step is how DEV went down for 2h
(truncated deploy) and how a 25%-wrong bot shipped behind a green 99/99 suite (no real-chat gate).

```
1. EDIT           supabase/functions/ask/index.ts   (the ONLY source of truth — see above)
2. TYPE-CHECK      npx deno@2 check --node-modules-dir=auto supabase/functions/ask/index.ts
                   → compare the error COUNT to HEAD (`git stash` trick below); it must not grow.
                   Pre-existing SupabaseClient generic noise is normal — 226 as of v48.
3. DEPLOY to DEV   npx supabase functions deploy ask --project-ref ftryuvfdihmhlzvbpfeu
                   ⚠️ CLI only, from disk. NEVER the MCP deploy_edge_function tool for this EF —
                   see "Do NOT deploy via MCP" above. NEVER a different project-ref.
4. REINDEX?        Only if this change edited INTENT_EXAMPLES / DIM_EXAMPLES / kb stat-card text —
                   see "Reindex" above. Skip for pure code/logic changes (v24/v25/v26/v28 needed none).
5. VALIDATE        node scripts/ask/eval.mjs   # runs wide_test then real_chat_test, ONE exit code
                   Non-zero = DO NOT SHIP. Then separately, exploratory (not graded, not blocking):
     node scripts/ask/audit_probe.mjs out.json   # 82-question adversarial sweep, EVERY domain —
        read the printed answers yourself; anything wrong graduates into a new real_chat_test case
        BEFORE you consider the change done — that is how the suite grows (see PLAN §Learning loop).
6. SPOT-CHECK      ask_log for the questions you just changed behavior for:
     select question, route, answer, created_at from ask_log
     where created_at > now() - interval '10 minutes' order by created_at desc;
   Confirm the `route` is what you intended — every answer carries one since v28.
7. GATE            (a) fails → fix in index.ts, go to 2. Never ship on a wide_test-only pass.
                   (b) fails → the bug is real even if (a) is green; wide_test alone is NOT a gate.
8. COMMIT           one commit, description of WHY not what (see CLAUDE.md). Include the new
                   EF version number (from `list_edge_functions`) and the score line, e.g.
                   "DEV EF v49, real_chat 17/17, wide 99/99".
9. DOCS + MEMORY    update this README's changelog block + `memory/ask-bot-dev.md` +
                   `memory/MEMORY.md` — live version number, what changed, what still needs reindex.
                   A future session trusts these; a stale version number sends it chasing v47 bugs
                   that were fixed in v49.
10. PUSH            git push origin feature/ask-bot-dev. NEVER touch PROD — this EF is DEV-only
                   until after the tournament (see docs/PLAN_PROD_CUTOVER.md).
```

**Never delegate step 3 to a subagent.** Two did it wrong in the past and corrupted the live
function for ~2 hours (see the deploy-hazard note above). The CLI removed the SIZE risk; it did not
remove the "someone else ran it and I didn't watch the version number change" risk.

**Never call `wide_test` alone "done".** It passing 99/99 while `real_chat_test` sat at 11/17 is
the exact failure `eval.mjs` exists to prevent — a synthetic suite I wrote can be green while ~1 in
4 real questions are wrong. `real_chat_test` is the suite that matters; `wide_test` only proves you
didn't regress something already fixed. `audit_probe` is the widest net (find NEW failure classes)
but isn't graded yet — read it by hand.

## Architecture (one line)
`preGuard+rateLimit → splitCompound → [embed once | keyword-only if OpenAI is down] → QuerySpec
{intent[E] · op · dim[E] · entities · confidence} + structured borrowing (prev_spec / last_answer) →
deterministic SQL tool (schedule / scorers / game-detail / game-stats / odds / WC-groups / form /
leaderboards / aggregates / compare / bracket / global / my-data / group-data) OR fuzzy RAG + ONE
grounded LLM call → template → ask_log`.
LLM only for: fuzzy "describe" stats (grounded + number-checked), the rules-FAQ fallback, off-topic
steer-back, and the parse-only understanding fallback. **No private data ever reaches the LLM.**

## Local test harnesses
**`scripts/ask/eval.mjs` — the ship gate. Run this, not the individual scripts, before committing.**
Runs `wide_test` then `real_chat_test`, one exit code. Non-zero = do not ship (see Update workflow).

**`scripts/ask/real_chat_test.mjs` — built from a REAL user session, not invented cases.** This is
the suite that matters: `wide_test` sat at 99/99 while this one caught 6 live failures (the "group
i" pronoun bug, a how-to phrasing gated behind login, a typo that replayed the previous answer
verbatim, a 57-row table for a one-name question, an unnamed "which group" answer, a trivia count
answered with the point-value FAQ). Target: 17/17.

**`scripts/ask/audit_probe.mjs out.json` — 82-question adversarial sweep across every domain.**
Exploratory, not graded (yet) — print question→route→answer and read it. This found the worst bug
of the whole v29 pass: `answerCrew`'s number-grounding was a token-membership test ("does this digit
appear ANYWHERE in the facts?"), so "how many red cards in the tournament?" answered **"0"** (truth:
13) because every player stat-card contains "0 yellow, 0 red". Anything wrong here graduates into a
new `real_chat_test` case before you call a change done.

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
**~100 questions** across areas × complexity incl. privacy-refusal (the `test3`-vs-`TestA`
near-leak), last/next-game time-direction, time-tense, how-to, member-compare, workflow-probe
regressions, and the v26/v27 additions (odds, WC groups, form, bracket, roast, who-picked, rates).
Rows may carry an optional 6th element: prior-turn questions. These are **replayed like the real
client** — the prior turn is actually asked first and its `answer` + resolved `spec` are echoed back
on the follow-up (`last_answer` / `prev_spec`), which is what makes answer-referencing follow-ups
("who is the top scorer?" → "how many goals does **he** have?") testable.
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
