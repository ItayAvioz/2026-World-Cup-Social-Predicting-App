# Ask Bot — Road to a Complete Bot (v26 → v30)

**Status:** plan approved-pending; produced 2026-07-13 from a 6-agent audit (2 external-review verifications + deep code / data / rules-coverage / production audits) of DEV `ask` v25.
**Scope:** DEV project `ftryuvfdihmhlzvbpfeu` only until the final phase. LLM data boundary (question text + static RULES + public stat-cards only) is **unchanged** throughout.

---

## Part A — Verdicts on the two external reviews

### Review #1 (5 claims)

| # | Claim | Verdict | Reality in v25 |
|---|---|---|---|
| 1 | Split-clause coreference blindspot | PARTIALLY VALID | Clause B **does** get clause A's raw text as history (`index.ts:1156`). The real gap: clause B never sees clause A's **resolved entities or ANSWER** — "their"/"he" referring to something the bot said cannot resolve. Fix in v29, not v26. |
| 2 | Add deterministic result caching (Redis/TTL) | MOSTLY INVALID at this scale | No cache exists, true — but with ≤12 members/group and hundreds of users, identical queries are single-digit-ms indexed selects. **Do not build.** Only win: memoize `fetchTeamNames` (full games scan on EVERY request today). |
| 3 | Private queries dead-end; need LLM spec compiler | ALREADY IMPLEMENTED (v20) | `llmUnderstand`/`execUnderstood` (`index.ts:602-641`) does exactly this at 3 choke points. Residual gaps: only fires for logged-in users, only routes to private tools, rebuilds spec from scratch. Harden in v29. |
| 4 | Writer↔Judge crew latency | VALID | 2–4 sequential gpt-4o-mini calls, stats-RAG path only; judge JSON-parse failure silently defaults score=5 (passes). Fix in v27: single structured call + deterministic post-check. |
| 5 | Hybrid intent (BM25 + vectors) | ALREADY IMPLEMENTED in effect | The stage-10 deterministic override chain **is** the keyword layer (incl. every cited keyword). Don't add a second one. |

### Review #2 (10 recommendations)

- **Already implemented:** R5 verified-facts separation (Writer receives only deterministic stat-cards, barred from MAX/COUNT/rank). Most of R4 (best attack/defense/compare are already SQL).
- **Valid:** R7 — no deterministic validation of the written answer; only an LLM judge with a silent-pass default.
- **Partially valid (the genuinely missing pieces):** R1 structured conversation state (only raw last-2 question texts today; 4-turn example breaks at turn 4, "last 3 games" silently answers full-tournament); R4's missing half (no time-window primitive, no "clinical" metric); R8 evidence gate (0 retrieved cards still burns 2–4 LLM calls); R9 tracing (no persisted log, `route` unknown even in the response); R10 eval metrics (75 cases grade answers only — intent/route/latency captured but never asserted).
- **Adopted into plan:** structured state (v29), window primitive (v28), evidence gate + claim validation (v27), ask_log + route id (v27), eval upgrades (v30).

---

## Part B — New audit findings (beyond known F1–F6)

### Code (live-probe confirmed where noted)
| Sev | Finding | Where |
|---|---|---|
| CRIT | OpenAI outage kills ~90% of questions incl. fully-deterministic ones — unconditional `embed()` before routing; SDK default timeout 10 min | `index.ts:927`, `:1128` |
| MAJ | Every Supabase error silently rendered as empty data → confident false answers ("You have no exact scores yet") | pattern everywhere (`data ?? []`) |
| MAJ | `reindex_*` modes anon-key reachable, bypass rate limit, delete-then-insert (empty window; unbounded OpenAI spend) | `index.ts:1130-1132`, `:801`, `:813` |
| MAJ | Hebrew questions DOA → off_topic (probe: "מי מוביל בליגה?"); resolveTeams strips Hebrew | `index.ts:216`, exemplars all English |
| MAJ | Last-game override shadows future/phase questions — probe: "when is the last game of the tournament?" → past QF result; "last group stage game" same | `index.ts:1019-1025` |
| MAJ | Early FAQ shadows data questions — probe: "how many goals does the top scorer have?" → "…worth 10 points" | `index.ts:740`, `:925` |
| MIN | "\<GroupName\> leaderboard" (without the word "group") → global board dump, refusal never runs | `index.ts:970-971`, `:525` |
| MIN | count-op beats rank: "how many goals has the leading scorer scored?" → tournament total (probe) | `index.ts:253`, `:1046` |
| MIN | history items uncapped (CPU via lev), diacritics break resolution (Köln), cardsP top-200 window, ~10 sequential awaits/private Q, UTC-only times for Israeli users | various |
| OK | Privacy core verified clean: predictions RLS row-scoped by group_id; all group iterations caller-owned; per-request isolation holds | SQL-verified |

### Ops / production
| Sev | Finding |
|---|---|
| MAJ | qa_cache **poisoning**: injected rules "question" gets its LLM answer cached and served cross-user at ≥0.93 similarity. Cache holds 5 rows — cheapest fix is dropping cross-user serving. |
| MAJ | No persisted question→route→answer log anywhere (SQL-verified). One `ask_log` table = highest-ROI addition. |
| MAJ | Rate limit per-isolate AND all anon users share ONE bucket (keyed on anon JWT tail); keys never evicted. |
| MAJ | PROD promotion: 4 vector tables + 4 `match_*` RPCs + pgvector don't exist in PROD; 8-step cutover enumerated (Part D). |
| MIN | Raw `String(err)` 500s to the client; catch should return a friendly 200 `degraded:true`. |
| MIN | history = last 2 **user** questions only; bot answers never echoed → answer-referencing pronouns break immediately; turn-1 entity dies at turn 4. |
| INFO | Cost is a non-issue (~$0.002 worst-case/question). Use a **dedicated OpenAI key** so bot traffic can't starve nightly-summary. |

### Rules & coverage
| Sev | Finding |
|---|---|
| MAJ | RULES **contradicts the app**: says auto-predict is "random" (lines 63, 78) — actual behavior is contrarian (M52/M125), and the bot's own FAQ (:756) says so. Two paths, two answers. |
| MAJ | Four whole data domains the UI ships with **zero tools**: (1) **odds** (game_odds 65 + champion_odds 48 rows; RULES advertises them), (2) **knockout bracket game** (my bracket points/lock/group brackets — myFocus "points" actively misleads pre-Jul-20), (3) **AI roast** (timing + latest summary), (4) **tournament groups A–L** ("group D standings" collides with friend-group boards). |
| MAJ | Reverse pick lookup ("who picked France in my group?") returns **the caller's own picks**. |
| MIN | Date-scoped private questions return all-time totals ("how did my group do yesterday?" → season board); "tonight's game" clarifies because resolveGameRef never uses resolveDate; exact%/hit%/streak have trained intent examples but no tool; venue/city unguarded; no Israel-time output. |
| MIN | RULES omissions: inactive-member semantics, June-11 self-service locks, top-scorer tie rule, post-lock pick visibility, bracket group-visibility gate, row-per-(user×group) model, roast timing. |

### Data (DEV) — the bot sits on rotten seed rows exactly where users ask
| Sev | Finding | Fix type |
|---|---|---|
| CRIT | Future final (Netherlands 1-0 England, KO Jul 19) has `knockout_winner` set → bracketStatus says "Netherlands won the tournament! 🏆" **today**; a champion pick already earned 10pts | DATA + CODE (`.lte kickoff` in bracketStatus:401) |
| MAJ | All 8 R16 rows: winner set, score NULL → "hasn't been played yet" AND "France advanced" simultaneously | DATA (backfill scores) |
| MAJ | Mexico–South Africa: ONLY pens-flagged non-friendly game but NULL score → etPensList says "none"; group game with a knockout_winner | DATA (reset row) |
| MAJ | Three 2022/TBD test rows pollute "the final"/"the quarter finals" (Qatar-2022 events, Argentina stats on a France-Netherlands game, corrupted player_name) | DATA (delete + children) |
| MAJ | Brazil 1-0 England QF but winner='England', no ET/pens → "Brazil 1-0 England. England advanced." | DATA |
| MAJ | Czech Republic stats stored under placeholder 'UEFA PO-D' → no stats row, no kb card (Bosnia-class, 🔁 recurring) | DATA + reindex_kb |
| MAJ | 31 finished games have zero box stats (synthetic KO + 6 group rows) | CODE tolerance (fall back to result+events) |
| MIN | kb_embeddings stale (Jul 6), club-test-dominated; dim_examples missing offsides/shots; two groups named "test"; Test2/3/4/A pairwise lev≤1 (F1 blast-radius corpus) | OPS/DATA |
| OK | Clean: no duplicate events, event-sums match scores (exc. 2022 row), no phantom points, no duplicate usernames | — |

---

## Part C — The plan (5 releases)

### v26 — Trust & Truth (deterministic correctness + privacy) — ~1 session
The **never-substitute contract** + shadow fixes. All deterministic; no reindex.
1. **Group match-quality tiers** (F1): `resolveGroupsAll` returns exact/token/typo quality. Typo-quality match + `groupRefCandidate` text ≠ own-group name → refuse-with-suggestion ("You're not in 'test3' — did you mean TestA?"). Regression tests at lev-1 for every foreign-group name.
2. **Own-group name defeats globalCue** without the literal word "group" ("Beta Sharks leaderboard").
3. **Override shadow fixes:** last-game override excludes future-tense (`when is/are/does/will`) and honors `spec.phase` ("last group-stage game" = MAX kickoff in phase); pick-value FAQs require a value word and reject stat words ("how many goals does the top scorer have" → statLeaderboard); count-block checks rank-cue before tournamentProgress ("leading scorer").
4. **Shared renderer everywhere:** gameStats appends `etPensLine`; etPensList includes friendlies labeled "(friendly)" or names them when the WC list is empty; present-tense phrasing for "go to penalties".
5. **Compound hardening:** aux-verb tails (did/do/does/is/are/has/can) split; noun-fragment tails don't; clause-2 clarify/failure suppressed when clause 1 succeeded; response returns `spec2`.
6. **Missing shapes from the transcript:** game-scoped single-stat answer ("0 red cards in that game"); player-count aggregations ("how many players got a red card"); **scope echo** whenever the answer scope came from borrowed context ("In PSG–Arsenal: …").
7. **bracketStatus kickoff filter** (belt-and-braces vs future-decided rows).

### v27 — Resilience, Security & Observability — ~1 session (go/no-go for any PROD talk)
1. OpenAI client `{ timeout: 10_000, maxRetries: 1 }`.
2. **Degraded mode:** embed/classify in try/catch → keyword-guessed intent + qvec=null → deterministic overrides + registry still answer; only fuzzy/RAG paths apologize.
3. `must(res)` helper on the ~10 tools whose empty-state asserts a fact; catch-all returns friendly 200 `degraded:true`, real error logged.
4. **ask_log table** (M130 conventions: RLS on, service-role only) + `route` id threaded through every `done()`; log question/spec/spec2/route/llm_used/retrieved/judge/latency.
5. **Rate-limit keys:** logged-in by user id; anon per-IP (`x-forwarded-for`); evict stale keys; cap history items at 500 chars + preGuard each.
6. **Gate reindex modes** on service-role key; move above→below rateOk; upsert-then-prune (no empty window).
7. **qa_cache poisoning fix:** serve cached answers same-user only (or drop the cache — 5 rows).
8. **answerCrew → single structured call** `{answer, is_grounded}` + **deterministic post-check** (every number in answer must appear in card text; entities must be card titles) + **evidence gate** (0 cards → deterministic "no stats yet", no LLM call). Judge retired to the offline harness.
9. Perf freebies: module-cache team names (5-min TTL), `Promise.all` [embed‖fetchTeamNames], [classify‖classifyDim], per-group RPC loops; single-query findGame.

### v28 — Coverage domains (answer what the app already knows) — ~1-2 sessions
1. **Odds tool:** game odds (Bet365) + champion odds (William Hill) — public tables, RULES advertises them.
2. **Knockout-bracket game:** "my bracket points" via `fn_knockout_points` (with the pre-Jul-20 fold-in caveat stated), lock date FAQ first-person, group brackets via `get_group_knockout_brackets`.
3. **AI roast:** timing FAQ (+210min after last KO) + latest summary retrieval for own groups (RLS).
4. **Tournament groups A–L:** standings/membership via `games.group_name`; disambiguation rule: "group D/A-L letter" → tournament group, otherwise friend group.
5. **Reverse pick lookup:** "who picked France in my group?" from `get_group_leaderboard` champion/scorer columns (post-lock public-by-design).
6. **Date-scoped private answers:** resolveDate + private intent → points in that 07:30-UTC match-day window ("how did my group do yesterday").
7. **Time-window primitive** `recentGames(team, n)` → last-N form/trend/improving; "clinical" = goals-per-shot from avg_shots, or honest "not tracked that way".
8. **Israel time:** kickoffs formatted Asia/Jerusalem (+UTC), relative dates resolved in Israel time; venue/city guard; exact%/hit%/streak tool (data exists in dashboard RPC) or honest refusal.
9. **RULES fixes:** auto-predict = contrarian (matches FAQ + M125); add inactive semantics, self-service locks, tie rule, pick visibility, bracket-visibility gate, roast timing. → **flush qa_cache**; add offsides/shots dims → **reindex_dims**; kb card generation filtered to `teams` table + **reindex_kb**.

### v29 — Conversation understanding — ~1 session
1. **Structured state:** client echoes back the last response's resolved `spec`; server merges it (teams/op/dim/group/member/game) before text-borrowing. Kills the "last 3 games"-silently-full-tournament class.
2. **Answer-aware entities:** client includes last bot answer as history; resolveTeams/resolvePlayer/resolveMemberName scan it (deterministic only — nothing new reaches the LLM). Fixes "who is the top scorer?" → "how many goals does HE have?".
3. Window: last 3 user turns. Compound clause 2 receives clause 1's **resolved spec**, not just text.
4. **llmUnderstand upgrade:** receives the partial deterministic spec, fills only null slots; `asks` enum gains public targets so anon users benefit.
5. **Hebrew:** phase 1 = script detector + bilingual "I answer in English" steer; phase 2 (optional) = Hebrew intent/dim exemplars (reindex), Hebrew team aliases, Hebrew keyword alternates in detectOp/detectPhase.

### v30 — Eval, data hygiene & PROD readiness — ~1 session
1. **wide_test upgrades:** assert `intent`/`route`/`teams` per case; latency p50/p95; LLM-call counts; grow to ~120 cases covering every v26-v29 addition + leak checks per new tool.
2. **Generative eval:** probe.mjs + a question-generator agent graded against SQL, run per deploy; weekly review of ask_log rows where `llm_used` or borrowed scope.
3. **Coverage matrix** checked into `supabase/functions/ask/README.md`: entity × op × dim × scope → supported / refuse / clarify. Unmapped ⇒ refuse by default.
4. **DEV data cleanup (SQL, one migration-style script):** null winner+score on the 4 future-scored rows (or accept + rely on code filters — decide); backfill R16 scores consistent with winners; reset Mexico–South Africa; delete the 3 2022/TBD rows + children; fix Brazil–England; rename 'UEFA PO-D' → 'Czech Republic' in stats tables; rename one "test" group; reindex_kb after.
5. **PROD cutover checklist** (only after World Cup + explicit decision): (1) apply 3 chatbot migrations to PROD via apply_migration (pgvector; M130-style write revokes on the 4 new tables); (2) dedicated `OPENAI_API_KEY` secret; (3) MCP deploy EF `verify_jwt:true`; (4) reindex intents/dims/kb against PROD (never copy DEV kb/qa_cache); (5) leave qa_cache empty; (6) run public-question subset of wide_test on PROD (+seed an e2e user for private cases); (7) flip AskBot.jsx host guard, drop "(dev)" label; (8) build + gh-pages deploy (SW bump). Gated on v27 complete.

### Explicitly NOT doing (validated against the reviews)
- No result cache / Redis (scale doesn't justify it; revisit only if ask_log shows DB latency during the Final).
- No BM25/hybrid classification layer (the override chain already is one).
- No autonomous agent for multi-task questions (splitCompound + structured state suffice at 2 clauses).
- No server-side session store (client-echoed spec is enough at this scale).
- LLM boundary stays exactly as is.

---

## Part D — Order & rationale
`v26 → v27` fix what users see and what would burn us in an outage; both are pure code, no reindex. `v28` is the visible feature jump (4 new domains) and carries the only RULES/reindex work. `v29` is the "feels smart" release. `v30` locks quality in place and is the PROD gate. Each release: deploy DEV via MCP → byte-diff verify → wide_test green (grown per release) → commit.
