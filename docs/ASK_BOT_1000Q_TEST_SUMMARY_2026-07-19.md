# Ask-Bot 1000-Question Test — Summary

**Date:** 2026-07-19 · **Target:** DEV EF `ask` (project `ftryuvfdihmhlzvbpfeu`), version live at test time — post-v32 (EF v69) · **Branch:** feature/ask-bot-dev · **Scope:** DEV only, PROD untouched.
**Raw data:** [`ASK_BOT_1000Q_TEST_2026-07-19.csv`](./ASK_BOT_1000Q_TEST_2026-07-19.csv) (1000 rows, one per question).

## What was run

1000 questions, split into the same 8 topic areas ("agents") used in the prior v32 sweep, 125 questions each: `stats_aggregates`, `schedule_time`, `rules_howto`, `picks_popularity`, `privacy_groups`, `typos_noise`, `compound_context`, `games_detail`. Each question was auto-tagged **easy / medium / hard** by a documented heuristic (typo'd, history-carrying, or multi-clause questions → hard; short direct questions → easy; everything else → medium — see `scripts/ask/sweep_questions_1000.mjs`). Every question was fired at the live EF and logged with its route, `llm_used`, `validation_fail`, `self_healed`, and full answer text.

## Grading methodology (read before trusting the numbers)

Every row was checked against the bot's own validation telemetry (`validation_fail`, `self_healed`) and against a **DB-computed ground truth** wherever a template could resolve one automatically (total goals, red/yellow cards, draws, games played, per-team/per-player goals, group member counts, trivia count). That covered **29 of 1000 rows** with an independent numeric oracle — the rest are opinion-shaped ("best goalkeeper?"), personal/session-scoped, or policy text, and are graded on validation/routing/leak signals only, not a DB cross-check. This is disclosed, not hidden: a claim of "1000 answers independently fact-checked against the database" would be false. Of the 29 DB-checked rows, **28 matched, 0 mismatched, 1 was an unrelated matcher false-trigger** (see Appendix).

Score rubric (0–100, per the template agreed before the run): starts at 100, deducts for `validation_fail` flags, `self_healed` firing, ground-truth mismatch, login-walling a public question, or a possible privacy leak. Verdict: PASS ≥85, PARTIAL 60–84, FAIL <60.

**DEV data is dirty, as instructed** — the DEV dataset deliberately mixes 48 real World Cup teams with ~61 club test games (Man City, Doku, Real Madrid, etc. — see `[[dev-data-scope-decision]]`). **253 of 1000** answers referenced this non-WC48 test data; only **1 of those 253** scored a FAIL, and that FAIL was unrelated to the club-team content. Dirty DEV data is confirmed **cosmetic, not a source of bot errors.**

## Headline numbers

| | Count | % |
|---|---|---|
| **PASS** | 890 | 89.0% |
| **PARTIAL** | 49 | 4.9% |
| **FAIL** | 61 | 6.1% |
| Average score | 94.4 / 100 | |

**By area** (avg score, PASS/PARTIAL/FAIL):

| Area | Avg score | PASS | PARTIAL | FAIL |
|---|---|---|---|---|
| stats_aggregates | 98.4 | 121 | 3 | 1 |
| rules_howto | 97.1 | 117 | 6 | 2 |
| games_detail | 96.0 | 116 | 2 | 7 |
| typos_noise | 95.8 | 114 | 6 | 5 |
| schedule_time | 93.4 | 107 | 14 | 4 |
| privacy_groups | 92.5 | 108 | 4 | 13 |
| picks_popularity | 92.4 | 106 | 9 | 10 |
| compound_context | 89.4 | 101 | 5 | 19 |

**By difficulty:** easy 90.6% PASS · medium 89.3% PASS · hard 86.3% PASS — hard questions fail ~2.3× more often than easy, as expected (hard = typo'd / compound / history-carrying).

**By auth context — the most telling split:** anon 748/849 PASS (88.1%), **60 of the 61 total FAILs are anon**. auth 142/151 PASS (94.0%), only 1 FAIL. The authenticated path is materially healthier than the anonymous path.

## Finding #1 (highest priority): tool-bound-auth is not fully closed

**53 of the 61 FAILs (87%)** are the exact recurring pattern documented in `[[ask-bot-dev]]` from the v31/v32 cycles: a clearly-public anonymous question gets intent-routed into a **private, auth-gated tool** (`my_data`, `group_standings`, or `group_history`) and comes back as *"Please sign in — I can only look up your personal data when you are logged in."* — even though the question needed no personal data at all. It recurs in **every single area**, confirming it's a general routing gap, not an isolated miss. Representative examples pulled straight from the CSV:

- *"which team has never won so far?"* → `group_standings` → login wall
- *"when did the group stage end?"* → `group_standings` → login wall
- *"how many total groups have been created?"* → `my_data` → login wall (should be `app_census`)
- *"what is the least popular champion pick?"* / *"which champion pick is rarest?"* / *"who is the majority top scorer pick?"* → `my_data` → login wall (should be platform-popularity, same fix class the v32 cycle already applied to the *bare* "most chosen" phrasing — these are the same family with different wording that slipped through)
- *"did any world cup game go to pens?"* / *"stats for the final?"* / *"full breakdown of the third place match"* → `group_history` → login wall (should be a game-detail/results tool)
- In `compound_context`, ellipsis follow-ups (*"and the group stage?"*, *"who else picked that?"*, *"how many did they have combined?"*) fall into the same misroute at a higher rate — history-carrying anon turns default toward a personal-data assumption.

A few of the 53 are **arguably correct** (asking about a *specific named group's* leaderboard or predictions as an anon user legitimately requires membership per the app's privacy model — e.g. *"who is winning alpha wolves?"*, *"what did the beta sharks predict for the final?"*) but the **refusal wording is still wrong**: *"I can only look up your personal data"* is misleading when the question was never about the asker's own data. That's a smaller, second-order fix (better refusal copy for named-group-but-not-a-member, distinct from "you need to log in at all").

**Recommendation:** re-run the same fix pattern used three times already in v32 (move the misclassified public intents above `private_registry`) — but this time drive it from this 53-row list directly instead of case-by-case, since it's clearly the same root cause repeating. Given how consistently it recurs across cycles, also worth adding a **standing regression check**: a fixed anon-question corpus (this 1000-set, or a curated subset) re-run on every future EF deploy, gated in the same way `wide_test.mjs` already gates shape/scope.

## Finding #2: two tools are scope-inconsistent with their siblings (discovered building the fact bank, not a routing bug)

While building ground truth, per-team/per-player stat tools (`team_stat`, `player_stat`, `cards_total`) were found to sum **all** rows in `game_team_stats`/`game_player_stats` — including the ~61 club test games and the one Man City friendly — while `tournament_progress`/goals-total/draws tools correctly scope to WC-only finished games. Concretely: *"how many red cards in the tournament?"* answers 13 (all games), while *"how many games have been played?"* answers 94 (WC-scoped only) — two different scopes used side-by-side without the user ever being told. **The bot's arithmetic is correct given its own query** — this is not a wrong-number bug — but it's an internal inconsistency: two tools answering "in the tournament" with two different definitions of "tournament." Confirmed via direct DB queries (see Appendix); not something the 8-suite gate would catch since it only spot-checks single facts, not cross-tool consistency.

**Recommendation:** either scope `cards_total`/`team_stat`/`player_stat` to WC-only games (matching the others), or — if the richer "all tracked games" view is intentional for a data-sparse DEV tournament — say so in the answer (e.g. *"...across all 100 tracked teams (incl. test fixtures)"*) so the number is self-explanatory instead of silently disagreeing with its sibling tools.

## Finding #3: `shape` validator false-positives on legitimate deterministic answers

The 49 PARTIAL rows are overwhelmingly a single flag: `validation_fail=shape` fired on an answer that reads correctly on inspection, and no retry occurred (self-heal only fires for some classes, per `[[ask-bot-dev]]` v32 design). Examples where the delivered answer is fine but still flagged: *"Brazil has no upcoming games scheduled"*, *"Games today: • Portugal 3-2 Argentina..."*, *"The Final is Netherlands vs England, Jul 19..."*, a global-leaderboard listing. This doesn't reach the user as a visible bug — but it's telemetry noise: every future observe→enforce decision (like the one made in v32) reads these `validation_fail` counts as signal, and a shape check that over-fires on known-good response templates (no-upcoming-game, today's-games list, single-game schedule answer, standings listing) makes that signal less trustworthy over time.

**Recommendation:** extend the same exemption pattern v32 already used for `REFUSAL_ANSWER_RE` — add these known-good deterministic shapes to the shape-check's exemption list so they stop being flagged, tightening the signal without weakening real catches.

## Finding #4 (smallest, but worth a look): one raw internal value leaked as the visible answer

Row #185, *"did Portugal already play their semi?"* → routed to `rag_crew` → the user-facing answer text was literally **`grounded=false`** — an internal validation flag, not a natural-language answer. Isolated (1 occurrence in 1000), but worth a quick guard so an ungrounded RAG result never ships its debug string instead of a real refusal/answer.

## What's *not* a problem

- **Dirty DEV data**: confirmed cosmetic (253 affected rows, 1 FAIL, unrelated). No action needed — this is deliberate per `[[dev-data-scope-decision]]`.
- **Rules/policy answers** (`rules_howto`, 97.1 avg, only 2 FAILs — both login-wall, Finding #1): the actual rules content (bracket max 75, no 3rd-4th bonus, scoring table) held up correctly across 125 phrasings including 50 new ones not in any prior suite.
- **Typo tolerance** (`typos_noise`, 95.8 avg): the fuzzy-repair layer from v32 handled the new typo variants well; its 5 FAILs are all Finding #1, not typo-parsing misses.
- **Authenticated path**: 94.0% PASS, only 1 FAIL in 151 questions — markedly more reliable than anon, consistent with Finding #1 being specifically an anon-routing problem.

## Recommended priority order

1. **Fix Finding #1** (tool-bound-auth, 53 rows) — highest volume, same well-understood fix pattern as three prior instances this cycle, directly actionable from the CSV.
2. **Fix Finding #2** (cards/team/player scope inconsistency) — smaller blast radius but a real internal-consistency gap worth closing before it's noticed by an end user comparing two answers.
3. **Fix Finding #3** (shape false-positives) — no user-facing harm, but improves telemetry quality for future fix cycles.
4. **Fix Finding #4** (grounded=false leak) — one-line guard, cheap to close.
5. Add a standing regression corpus (this 1000-question set or a curated subset) to the gate so Finding #1's recurrence pattern gets caught automatically next time, not by another manual 1000-question sweep.

None of this was implemented in this pass — the task was to test, verify, and report. Say the word and I'll implement, re-test, and redeploy following the same process as the v32 cycle.

---

## Appendix: verification detail

- **Ground-truth-checked rows (29):** trivia total, draws count, 0-0 count, total goals, avg goals/game, total red/yellow cards, games played, team goals scored/conceded (Man City), player goals (Doku), group member counts. 28 matched exactly; 1 (`#50`, "how many players got a red card?") was a grader false-trigger — my matcher engaged on a *distinct-players* question using a *total-events* oracle; the bot's own answer (12) was plausible and un-contradicted, just not independently checked. Left as `unparseable` rather than forced to a verdict.
- **Fact bank build caught two bugs in my own tooling before they became false findings**, both fixed and documented in `scripts/ask/build_factbank.mjs`: (a) an unpaginated `game_player_stats` pull silently hit PostgREST's 1000-row cap (the same class as `[[picks-candidates-1000row-cap]]`), undercounting player goals; (b) an extra kickoff-time filter beyond `score_home IS NOT NULL` dropped one finished game from every "total" count. Both fixed before grading; the mismatches they caused in an intermediate run were **not** bot bugs.
- **Scripts added** (scratch + repo, DEV-only, read-only against the DB): `sweep_questions_1000.mjs` (corpus + difficulty tagger), `area_probe_resumable.mjs` (incremental/resumable batch runner — survives timeouts without losing progress), `build_factbank.mjs` (DB ground truth), `grade_1000.mjs` (scoring/CSV), `inspect_fails.mjs` / `inspect_mismatches.mjs` / `summarize_by_difficulty.mjs` (analysis helpers).
