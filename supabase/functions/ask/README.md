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
  - `20260714000001_ask_log_validation_telemetry.sql` — adds `validation_fail`/`expected_shape`/`rows_count` to `ask_log`
  - `20260716000001_ask_log_validation_fail_array.sql` — **v31**: `validation_fail` text → **text[]** (the validation layer can flag multiple checks per answer). `validation_fail` + `expected_shape` are now written on EVERY answer that flows through `done()`; `rows_count` stays NULL (needs structured tool results — D2, deferred)
  - `20260718000001_ask_log_session_telemetry.sql` — **v32**: `session_id`/`session_turn` (AskBot sends a per-mount id + turn counter; whole conversations reconstructable: `select * from ask_log where session_id = X order by session_turn`)
- **Frontend**: `src/components/AskBot.jsx` (chat widget, dev-host-guarded; sends the last **3** user turns as `history` **plus** `last_answer`, `prev_spec`, and (v32) `session_id`/`turn`) + mounted in `src/components/Layout.jsx`.

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
node scripts/ask/eval.mjs             # ALL 8 blocking suites must PASS (v31 gate)
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
> Current: DEV runs EF **version 72** = **v34, the LAST planned ask-bot fine-tuning round**
> (2026-07-20). Driven by the 2026-07-20 retest + a real-conversation review
> (docs/ASK_BOT_1000Q_RETEST_2026-07-20.md), 7 fixes: (1) **cardsTotal/playerStatScoped now
> require `score_home IS NOT NULL`** (not just `phase<>'friendly'`) — matches `teamStat`'s
> already-correct scope; closes a gap where `game_team_stats`/`game_player_stats` had rows
> attached to 3 unplayed group games and a `TBD vs TBD` placeholder (including real stat rows
> for Mbappé/Haaland on the placeholder — confirmed live, pinned by a new sql_oracle case).
> (2) **plural "games"/"matches"** in `dimToMetric`'s `gameWord` — was singular-only, so "which
> **games** had the most red cards?" fell to the player leaderboard instead of the game one;
> fixed once, closes red/yellow/goals/corners together. (3) **compound clause-2 noun elision**
> — "how much games went to extra time? and how much **to penalties**?" elides "games" in
> clause 2, which then had no topical anchor and fell to the off-topic steer-back (confirmed
> 3/3 on unrelated topics: ET/pens, draws/wins, cards). Fix: when clause 2 resolves to
> off-topic, retry the FULL unsplit question — `cardsTotal`/`etPensList` already handle combined
> multi-cue phrasing when they see the whole sentence. **Adversarially reviewed** (3-agent
> workflow) before shipping: closed the one real gap found (a genuinely-unrelated clause 2
> could silently lose acknowledgment) by requiring the full-sentence retry's route to match
> clause 1's route — a real misroute now falls through unchanged instead of overwriting a
> correct answer. (4) **`REFUSAL_ANSWER_RE`** now recognizes `i'?m sorry` (only
> `i'?m not sure`/`i'?m having trouble` were covered before) — a plain "I'm sorry, but..."
> refusal was shape-flagged. (5) **plural "winners"** in the popularity topical gate (same class
> as #2). (6) **`rules_llm` shape-only retry carve-out** — LLM answers still skip retry for
> numeric/entity failures (unchanged, provenance can't improve on a 2nd call) but now get ONE
> retry for a pure shape miss (e.g. a yes/no rules question answered without a lead-in
> yes/no), with a strengthened retry-only prompt instruction; reviewed and confirmed the
> `isolatedRetry` recursion guard blocks this identically to every other failure class — no new
> loop risk. (7) **TYPO_FIXES** += mny/mucg/hw — short (2-3 letter) typos of "many"/"much"/"how"
> were below the fuzzy-repair length floor, so `detectOp` missed its exact "how many/how much"
> phrase and a typo'd count question fell to the default next-game answer instead of the count.
> New BLOCKING suite `v34_findings_test.mjs` (19 cases, gate is now TEN suites) pins all 7 +
> the review-driven safety guard. Gate run also surfaced 15 stale test assertions across 4
> existing suites — all traced to the World Cup Final actually being played between test runs
> (predictions correctly reveal at kickoff, "next game" correctly becomes "none", a leaderboard
> tie legitimately skips a rank number) — recalibrated to assert the bug class, not pinned
> tournament-progress-dependent values, per the same clock-robust pattern used in v32/v33.
>
> Previous: EF v71 = the **v33 final fine-tuning round** (2026-07-19; v70 +
> one gate-caught fix: "biggest/largest/smallest" added to groupRefCandidate's STOP list — the
> new anon_public suite caught "what is the biggest group?" being read as a group NAMED
> "biggest" and walled), driven
> entirely by the **1000-question 8-area audit** (docs/ASK_BOT_1000Q_TEST_2026-07-19.csv +
> _SUMMARY). Four WIDE fixes, no point patches: (1) **the login-wall choke point** — 53 of the
> audit's 61 failures were ANON questions with zero personal wording misrouted into a private
> tool and walled; `done()` now intercepts every NEED_LOGIN: personal wording (I/my/we/our)
> keeps the wall, a named friend group gets an honest "visible to its members only" wall (never
> "your personal data"), and everything else re-routes ONCE with private tools disabled
> (`noPrivate` threading through RouteDeps/RuleCtx/private_registry/REGISTRY dispatch). This
> closes the recurring tool-bound-auth CLASS at the choke point instead of per-intent (it had
> been re-fixed 3× in v31/v32 and kept reappearing). Guarded by the new BLOCKING suite
> `anon_public_test.mjs` (17 cases, all verbatim audit FAIL rows). (2) **scope consistency** —
> cardsTotal/teamStat/playerStat summed ALL rows (warm-up friendlies included) while
> tournament_progress excludes them, so "in the tournament" meant two different things in
> sibling answers; all three now exclude phase='friendly' (club test games in phase='group'
> remain in scope — deliberate DEV data), teamStat computes EXACT sums from `games` (90'+ET,
> pens excluded, knockout_winner W/D/L — no more "about N"), playerStatScoped recomputes from
> game_player_stats (the tournament_stats VIEWS still include friendlies — EF-side fix only, no
> DEV-only migration that would break dev↔prod view parity). sql_oracle mancity oracles updated
> to the new scope. (3) **template exemptions for shape/entity validators** — deterministic
> list/lookup templates ("Games today: …", "X has no upcoming games scheduled", "The Final
> is …", leaderboard/recent-form strips) were every remaining shape false-positive in the audit
> (49 PARTIALs); exempted like refusals (isTemplate), +"Which game?" added to REFUSAL_ANSWER_RE.
> (4) **internal-flag leak guard** — one audit answer was literally "grounded=false" (rag_crew
> model echoing its schema); flag-shaped text is discarded before it can ship. Plus the
> popularity family completed from audit rows: least/rarest (ascending tally), "majority top
> scorer pick", "most users bet on", "is anyone picking X"; app_census +created/total/smallest.
>
> Previous: EF v69 = the **v32 fine-tuning cycle** (2026-07-18/19, two rounds:
> round 1 from a real user session transcript + the v31 observe-mode validation telemetry;
> round 2 from a **600-question 8-area sweep** — the 8-agent×75-question workflow hit the
> monthly subagent spend limit, so the identical sweep ran INLINE via `scripts/ask/area_probe.mjs`
> + a red-flag analyzer + manual review; ~35 fixes total, every one a failure CLASS). All EIGHT
> blocking suites green at ship time: **wide 132 · real_chat 22 · fault_boundary 9 ·
> typo_noise 15 · shape 14+24-distinctness · scope_matrix 9 · sql_oracle 8 · context_isolation
> 13**, plus the new **shadow-replay** harness (125 real ask_log questions frozen as a baseline;
> all 34 v31→v32 drifts reviewed as intended before rebasing).
> Round-2 sweep fixes (beyond the round-1 list below): outcome_aggregate moved ABOVE the private
> registry ("which games ended 2-1?" login-walled — the v31 pens-rule class again); "most clean
> sheets" polarity INVERSION + cleanest/fairest→asc + "scores the least"; goalkeeper/keeper →
> honest untracked refusal; bronze→third; unknown-team verb-second form ("when italy plays?");
> tournament_meta (opening game / start / end / after-final); phase_progress ("are all group
> games done?"); when_played (2-team WHEN answers the DATE); team_record (bare W/D/L →
> deterministic team line); penalty_scorers (+who-missed); top-N player leaderboards; r16-plural
> phase lists; results_list ("who won the semi finals / yesterday?" + resolveDate yesterday);
> app_census (groups list / user count / most-exact — public-leaderboard tier); wc_group_table
> singular "which TEAM LEADS"; leaderboard_location (WHERE-question dumped the board);
> picks-visibility + top-scorer-TIE + multi-topic scoring FAQ lines; my_picks rescue;
> who_advanced; over/under odds cue + phase-aware game odds; deictic/elliptical no-context
> clarify + clause-1-clarify suppresses clause-2; 'drow' TYPO_FIX.
> Round-1 v32 shipped: (1) **outcome aggregates** — draws count / "which games ended 0-0" / W-D-L
> distribution had NO tool (fell into games-played, upcoming fixtures, next-game); new
> `outcomeAggregate` + `outcome_*` routes, oracle-verified. (2) **platform-wide pick popularity**
> — "most chosen champion/top scorer by users / in all the app" now tallies ALL picks
> (`most_popular_pick_platform`, service-read, anon-capable — picks are public post-lock); bare
> "most chosen" defaults to platform (SPEC CHANGE), per-group needs "in my group(s)"/a named
> group; one shared `POPULARITY_RE` replaced 4 drifted copies. (3) **champion-odds RLS bug** —
> `champion_odds` is authenticated-read; the anon client saw 0 of 48 rows and answered "No
> champion odds are available yet" (caught live by the repeat+entity validators); now
> service-read + top-N. (4) **fuzzy typo repair** — curated-vocab Damerau≤1/≤2 pass in
> `normalizeQuestion` (catds→cards, finisgeh→finished, recors→records, ditrbutions→
> distributions) with a FUZZY_SAFE real-word guard ('drawn'→draws corruption was caught by the
> gate and guarded). (5) **city-shadow team resolution** — "real madrid" also resolved Atletico
> Madrid via the shared 'madrid' token, blinding every teams.length===1 rule; exact-name matches
> now suppress token-shadow candidates. (6) **elliptical compound tails** — "...? And how many?"
> is DROPPED (tools answer counts inline); it used to glue a my_data dump onto a correct answer.
> (7) **ET+pens combined** — "extra time and penalties" answers both flags, not just the
> shootout. (8) **W/D/L "by order"** — routes to recent_form's chronological strip (n=10).
> (9) **rules facts corrected at source** — max **75** (not 83), NO 3rd-4th round bonus,
> win-gated 3rd place, in RULES prompt + RULE_TOPICS + rulesFAQ + RULES_FACT_VALUES (the
> "hallucinated +6" the numeric validator flagged was a faithful cite of a stale prompt).
> (10) **observe→enforce flip (V2/V4/V5)** — driven by the logged telemetry: refusal/clarify
> answers exempt from shape+entity, years exempt from numerics (all logged false-positives
> closed), then `done()` self-heals on ANY flag (isolated re-route; non-repeat failures ship the
> retry only if clean AND different — a false positive can never make an answer worse).
> (11) **V4 Tier B (D2-core)** — rag_crew passes its retrieved cards as `facts`; every number in
> a RAG answer must exist in the cards (or the question), decimal-normalized. (12) **session
> telemetry** — `ask_log.session_id/session_turn` (M-20260718000001) + AskBot.jsx sends a
> per-mount id + turn counter. (13) **repeat-proof popularity wording** — the champion vs
> top-scorer "no standout" lines now name the pick kind (they rendered identical text; V1
> flagged it live). New harnesses: `shadow_replay.mjs` (--rebase/--strict) + `area_probe.mjs`
> (batch runner for area sweeps). Still deferred: FULL D2 structured-ToolResult migration
> (rows_count, per-tool typed rows), V3 entity-registry gate, V6 general per-tool auth map
> (worst instances fixed: platform popularity + champion odds are tool-bound now).
>
> **Previous: EF version 64** = the **v31 architecture cycle** (docs/PLAN_ASK_BOT_V31_ARCHITECTURE.md — the
> critique-panel-reconciled implementation of D1 context gate / D3 validation layer / D4
> rules-as-data+normalization / D5 test-eval redesign, plus the streak-"best" and must()-sweep
> fixes), deployed from disk 2026-07-16. No reindex needed (code/rules only — INTENT_EXAMPLES/
> DIM_EXAMPLES unchanged).
> **`node scripts/ask/eval.mjs` now runs EIGHT blocking suites** (wide 129 · real_chat 22 ·
> fault_boundary 9 · typo_noise 15 · shape 14+distinctness · scope_matrix 8 · sql_oracle 6 ·
> context_isolation 13) — all green at ship time. wide_test finally has real exit-code gating
> (it used to ALWAYS exit 0, so "wide_test=PASS" in the old eval was decorative — found and
> fixed this cycle).
> v31 shipped: (1) **D1 context gate** — cross-turn team/dim/phase borrowing now requires a
> linguistic follow-up signal in the CURRENT question (pronoun_team they/them/their ·
> pronoun_player he/him/his/she/her · leading and/what-about · that/this/same game · bare
> comparative); isolation is the default, every borrow is telemetered (`spec.context`); the
> P0 audit finding (a stale 2-team spec silently flipping "which games went to penalties" into
> a single game's detail) is closed at the source. (2) **D4 rules-as-data** — RULE_TOPICS
> (road_to_final / champion_scorer_points / ai_summary) render by question SHAPE
> (location/explanation/timing/lock/value), ALL matched shapes render (a value+timing compound
> answers both halves), compound clause-2 inherits clause-1's topic on pronoun follow-ups, and
> `normalizeQuestion()` repairs confirmed compounds/typos (globalleaderboard, wentto, topscorer,
> nextgame, lastgame, leaderbord, chossen/choosen, avilable, froup, membrs, teh) before ANY
> regex/classifier sees the text. (3) **D3 validation layer** — `done()` now checks EVERY answer:
> V1 repeat-guard is UNCONDITIONAL (the old confidence-gated blind spot is gone) with a depth-1
> isolated-context self-heal instead of a false "could you rephrase"; V2 shape / V4 numeric
> provenance (Tier A) / V5 on-topic-entity run in OBSERVE MODE (recorded to
> ask_log.validation_fail text[], never blocking) until live traffic proves their false-positive
> rate. (4) **must() sweep** — 28 more bare `data ?? []` Supabase call sites now throw on a real
> DB error instead of rendering a confident "no data exists" lie. (5) **streak-"best"** — bare
> "best/longest streak" (no direction word) shows BOTH extremes instead of the current trailing
> run. (6) **route always logged** — 7 done() call sites that left ask_log.route NULL now name
> themselves (clarify / understand_fallback / *_degraded). (7) **oracle-found bot fixes** —
> trivia count scoped to the tournament window (was 42 incl. 2 stray pre-tournament rows; the
> old '40' substring test FALSE-PASSED against "40 seconds"), and per-team discipline totals
> ("how many red cards does Man City have?" used to answer W/D/L form — new game_team_stats sum
> branch in teamStat), public pens-list rule moved above the private block (it demanded login
> for "which games went to penalties" when the classifier guessed group_history).
> DEFERRED from the v31 plan, explicitly: D2 structured ToolResult migration (8 tools),
> V4 Tier B (RAG per-question fact binding), V3/V6 validation gates, enforcement-flip for
> V2/V4/V5 (observe-mode first, by design), the platform-wide pick-popularity tally, ask_log
> shadow-replay, AskBot.jsx session_id telemetry + gh-pages deploy.
>
> **Previous: EF version 57** = **v30 deep-audit fixes** (docs/PLAN_ASK_BOT_V29.md Part 3 —
> 6 fixes from a live-code-and-DB-verified audit), deployed 2026-07-15; wide_test 110/110,
> real_chat_test 22/22 at the time.
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
5. VALIDATE        node scripts/ask/eval.mjs   # v31: runs EIGHT blocking suites, ONE exit code —
                   wide_test, real_chat_test, fault_boundary, typo_noise, shape, scope_matrix,
                   sql_oracle (numbers vs independent SQL ground truth), context_isolation.
                   Non-zero = DO NOT SHIP. Then separately, exploratory (not graded, not blocking):
     node scripts/ask/audit_probe.mjs out.json   # 82-question adversarial sweep, EVERY domain —
        read the printed answers yourself; anything wrong graduates into a new real_chat_test case
        BEFORE you consider the change done — that is how the suite grows (see PLAN §Learning loop).
     node scripts/ask/context_isolation_test.mjs --full   # full probe×poison cross-product (advisory)
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

**`scripts/ask/anon_public_test.mjs` — v33 BLOCKING: no login wall on public questions.** 17 cases,
every one a verbatim FAIL row from the 1000-question audit (docs/ASK_BOT_1000Q_TEST_2026-07-19.csv):
public anon questions must never see "personal data"/a login demand; named-group anon questions get
the honest members-only wall; personal anon questions (my/we) keep the classic wall. This pins the
tool-bound-auth class that re-appeared in every cycle from v31 on.

**`scripts/ask/v34_findings_test.mjs` — v34 BLOCKING (LAST fine-tuning round): pins all 7
fixes.** 19 cases across 9 families: plural games/matches dim-routing (+singular control),
plural "winners" popularity gate (+control), compound clause-2 noun elision (3 unrelated
topics), typo'd "games played" (mny/mucg/hw), cardsTotal's finished-game scope, the
review-driven "genuinely off-topic clause 2 must not misroute" safety guard, and the
`REFUSAL_ANSWER_RE` "I'm sorry" fix. Every case traces to a verified live example from the
2026-07-20 retest + real-conversation review (docs/ASK_BOT_1000Q_RETEST_2026-07-20.md).

**`scripts/ask/sweep_questions_1000.mjs` + `area_probe_resumable.mjs` + `build_factbank.mjs` +
`grade_1000.mjs` — the 1000-question audit pipeline (advisory, re-runnable).** 8 areas × 125
difficulty-tagged questions → resumable live probe (JSONL, survives timeouts) → DB fact-bank →
scored CSV + verdicts. Output: docs/ASK_BOT_1000Q_TEST_2026-07-19.csv + _SUMMARY. ⚠️ build_factbank
paginates past PostgREST's 1000-row cap — an unpaginated pull silently truncated player stats and
produced FALSE mismatches on the first grading run.

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
