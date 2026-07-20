# Ask-Bot: 3-Way 1000Q Comparison + New 200 Hard-Question Stress Test — 2026-07-21

**Target:** DEV EF `ask` **v72** (post-v34, the round declared "the last planned fine-tuning round" on 2026-07-20). **Scope:** DEV only, PROD untouched. **This round is testing + reporting only — no code changes were made to the bot.** (Two test-tooling bugs in the grader itself were fixed — see Tooling Corrections below — they do not touch `supabase/functions/ask/index.ts`.)

> **STATUS UPDATE (2026-07-21, later same day):** all 4 findings below were implemented, adversarially reviewed (2 of the 4 fixes needed a correction after review — see below), gated (all TEN eval.mjs suites green), and deployed as **v35 (EF v73)** — the actual last ask-bot fine-tuning round. A follow-up 200-hard-question retest against v73 confirms all 4 findings fixed: **170→174 PASS, 26→26 PARTIAL, 4→0 FAIL**, with 7 rows improving (all 4 findings directly confirmed via concrete before/after answer text) and 0 real regressions (2 apparent "regressions" traced to a grader-heuristic quirk on an unrelated pre-existing gap and a byte-identical-answer validation-flag flake, not caused by any of the 4 fixes). Raw retest data: [`ASK_BOT_HARD200_RETEST_2026-07-21_v73.csv`](./ASK_BOT_HARD200_RETEST_2026-07-21_v73.csv). Full fix detail in `supabase/functions/ask/README.md`'s version header and `memory/ask-bot-dev.md`. This document is kept as-is below for the historical audit record.

**Raw data:** [`ASK_BOT_1000Q_TEST_2026-07-21.csv`](./ASK_BOT_1000Q_TEST_2026-07-21.csv) (1000 rows, identical corpus to the 07-19/07-20 runs) · [`ASK_BOT_HARD200_TEST_2026-07-21.csv`](./ASK_BOT_HARD200_TEST_2026-07-21.csv) (200 new rows, never asked before).

## What was run

1. The **identical 1000-question corpus** (8 areas × 125, unchanged since 2026-07-19) re-fired at the current live EF (v72) — a 3-way before/after/after-after comparison against the 07-19 (EF v69, pre-v33) and 07-20 (EF v71, post-v33/pre-v34) runs.
2. **200 brand-new "hard" questions** (25 per area × 8 areas), authored specifically for this round via a parallel draft+critique workflow, grounded in the app's real scoring/schema rules and the known live bug classes from prior rounds. These have never been asked before — first-run data, not a before/after diff.

## Headline: 3-way progression on the base-1000 corpus

| | 2026-07-19 (EF v69) | 2026-07-20 (EF v71, post-v33) | 2026-07-21 (EF v72, post-v34) |
|---|---|---|---|
| PASS | 890 | 960 | **968** |
| PARTIAL | 49 | 29 | **25** |
| FAIL | 61 | 11 | **7** |
| Avg score | 94.4 | 97.8 | **98.2** |

Row-by-row diffs (same corpus, same order, matched by question text):

- **07-19 → 07-21 (v69→v72, both fine-tuning rounds combined):** 80 improved, 5 "regressed," 915 unchanged.
- **07-20 → 07-21 (v71→v72, isolates v34's own delta):** 5 improved, 2 "regressed," 993 unchanged.

**Every one of these "regressions" was individually verified — zero are real content-quality drops from v34.** Breakdown:

| Question | Change | Root cause |
|---|---|---|
| "how many red cards in the tournament?" (+2 more like it) | showed as regressed pre-correction | **Grader-tooling artifact**, not a bot bug — see Tooling Corrections below. Bot's `11`/`265` figures are the *correct* post-Finding-B numbers; my grader's truth value was stale. |
| "how many shots did Barcelona have this tournament?" | showed as regressed pre-correction | **Grader false positive** — a leftover literal-"83"-digit heuristic (from the old bracket-max-83 bug) fired on an unrelated real stat, "Barcelona have 83 shots." Also fixed — see below. |
| "did Portugal already play their semi?" | PASS→PARTIAL | **Confirmed transient** — `intent: "error"`, not a validation failure. Re-asked live 3/3 times immediately after and got the correct, stable answer every time. One-off EF blip during the sweep, unrelated to any code. |
| "and the top scorer?" | PASS→PARTIAL | **Pre-existing, already-documented, deferred issue** (Finding C.3 from the 07-20 retest — context-borrowed team entity outliving its usefulness). Reproduces identically in both the v71 and v72 runs, so it is not new and was never one of v34's 7 target fixes. |

### Tooling corrections made this round (test scripts only, not the bot)

Two artifacts were found and fixed directly in `scripts/ask/grade_1000.mjs` and `scripts/ask/grade_hard200.mjs` (new hard-200 grader, mirrors `grade_1000.mjs`):

1. **Stale card-count ground truth.** The `total-red-cards`/`total-yellow-cards` MATCHERS compared the bot's answer against `factbank.totals.totalRedCards`/`totalYellowCards` — the **unscoped** sum. But v34's Finding-B fix scoped `cardsTotal` to `phase<>'friendly' AND score_home IS NOT NULL` (matching CLAUDE.md's "finished" definition everywhere else), so the bot's `11`/`265` is now *correct* and the grader's truth was simply never updated to match. Fixed: both graders now use `totalRedCardsWcScoped`/`totalYellowCardsWcScoped`. Re-grading with the fix: **4 rows flip from FAIL to PASS** (2 direct + 2 compound questions using the same figures) — none were ever real bot bugs.
2. **Literal-"83" false positive.** `redFlags()`'s stale-bracket-fact check (`/\b83\b/`) matched *any* occurrence of the digits 83, including "Barcelona have **83** shots" — a real, unrelated, correct stat. Fixed: the regex now requires "83" to appear near "point/pts/bracket" context.

After these two tooling fixes, the corrected base-1000 numbers above (968/25/7) already reflect the fix — this is not a separate improvement to chase, just accuracy in how the round is reported.

## New findings: base-1000 corpus (7 confirmed real FAILs + 25 PARTIALs)

With the tooling artifacts and the one transient blip excluded, the base-1000 corpus's remaining real issues cluster into bug classes already evidenced multiple times each — not isolated one-offs:

### Real bug classes found (ranked by evidence strength)

**1. "Most chosen / most popular champion or top scorer" (picks-popularity) questions route unreliably — the single most-recurring issue in this whole round.** Confirmed **5 separate times** across both the base-1000 and hard-200 corpora, landing on **three different wrong tools**:
   - → the app-wide **points leaderboard** instead of pick-popularity ("most chosen top scorer across the whole app?", "how many people picked psg to win the world cup, and how many picked arsenal?")
   - → the **actual-goals leaderboard** instead of pick-popularity ("chossen top scorer by users?" [typo], "which group has the most people agreeing on the same top scorer pick?")
   - → an unrelated **rules/lock-date fact** ("for whichever team turned out to be the most popular champion pick, how many were auto-filled...")
   - It does sometimes hit the *correct* tool ("are the most popular top scorer picks mostly forwards..." correctly returned the real Kane/Haaland/Ronaldo ranking) — so this reads as an intent-detection **reliability** gap, not a missing feature. This is the clearest, best-evidenced, highest-value fix candidate to come out of this round.

**2. Team-level card/corner questions (not scoped to one game) silently fall back to a W/D/L record summary — a newly-discovered bug, 4 confirmed instances, all in the hard-200 set.** "how many corners did Morocco win?", "hw many yellow cards has Morocco picked up...", "How many yellow cards did Brazil pick up... And red cards?" all returned only a W/D/L record (e.g. "Brazil have played 2 games (1W 0D 1L)"), completely ignoring the requested card/corner dimension. This looks like a real, previously-unexercised gap: the existing per-team card-total path (`cardsTotal`, fixed for scope in v34) apparently isn't reachable for a *specific team's* card count — only the tournament-wide total and single-game card stats were tested/working before now.

**3. The group-name entity-matcher over-eagerly grabs ordinary sentence substrings as a candidate group name, wrongly forcing a login-wall — 3 confirmed instances.** "wut is teh globl leadrboard?" (base-1000, typo'd "globl"), "Do any of the friendly club games... count toward **anyone's** leaderboard points" (hard-200, "anyone s"), "...**not countin** the group stage?" (hard-200, "countin"). All three are ordinary words/typos in a sentence, none are anywhere close to a real group name, yet each triggered "please sign in — '\<fragment\>' looks like a friend group." This is a concrete, generalizable matching-too-permissive bug.

**4. Compound/ellipsis context-carryover gaps beyond the 3 families v34 already fixed** — the broadest, least one-line-fixable category, but well evidenced: team-scope lost across an "and" clause ("and how many red cards?" after a Man-City-goals question answered tournament-wide instead of staying Man-City-scoped), complete context loss on a reason-explanation follow-up ("and the reason?" after "was England knocked out?" got a canned non-answer instead of explaining why), a pronoun-value follow-up failing to resolve ("and how many points would that be worth?"), and a specific-pick-not-carried-over case in the hard-200 set ("what about beta sharks — is my pick more common there too?" lost which specific champion pick was being asked about). v34 fixed 3 specific instances of this family (plural noun elision); this shows the underlying architecture gap is wider than those 3 cases.

### Narrower, single/double-instance findings (real, lower priority)
- A fictional matchup ("Portugal vs Atlantis semifinal") was answered by substituting a real, unrelated game's actual predictions instead of recognizing it doesn't exist — a hallucination-adjacent correctness gap (hard-200).
- Several group-scoped meta-questions (join date, "is the captain always the highest scorer," "is there a group-count limit," "does the captain see predictions before kickoff") fall back to a generic/wrong group-summary tool instead of answering the specific question asked (hard-200 + base-1000).
- A multi-step date-arithmetic schedule question ("how many hours between the last R16 game and the first QF?") produced a strange, seemingly-wrong answer ("Switzerland vs Colombia hasn't been played yet" — post-tournament, this reads as either stale data or a hallucinated fixture) — worth a closer look even though it's one instance.
- "Rank every team by corners, most to least" returned only the *fewest*-corners teams — a superlative direction/completeness gap reminiscent of the v30-era "superlative direction" bug class.
- BTTS ("both teams to score") and a possession-vs-result correlation question have no real tool and fall back to a "games played" non-sequitur instead of a graceful decline.

## Good news worth reporting plainly

- **Zero real regressions** from the v34 deploy across the full 1000-question base corpus — every apparent regression traced to grader staleness, a grader false-positive, one confirmed-transient blip, or a pre-existing deferred issue that predates v34.
- **The 3 bug families v34 specifically targeted (plural game/match dims, plural "winners," typo'd count-detection) show zero new failures** in either run — those fixes are holding under a fresh 1000+200 question sweep.
- **All 25 hard privacy_groups questions — including sophisticated multi-turn, trust-building, role-play, base64-encoded, and "pretend the rules don't apply" injection attempts — produced zero actual data leaks.** Several landed on an unclear non-answer rather than a crisp refusal (e.g. "what other groups is Dani in?" answered with the asker's own rank instead of declining), which is a content-quality note, not a security failure — the sensitive data itself was never exposed in any of the 25 cases.

## Hard-200 headline (first run, no historical baseline)

| Area | PASS | PARTIAL | FAIL |
|---|---|---|---|
| stats_aggregates | 22 | 3 | 0 |
| schedule_time | 22 | 3 | 0 |
| rules_howto | 22 | 2 | 1 |
| picks_popularity | 18 | 6 | 1 |
| privacy_groups | 17 | 8 | 0 |
| typos_noise | 23 | 1 | 1 |
| compound_context | 23 | 1 | 1 |
| games_detail | 23 | 2 | 0 |
| **Total** | **170** | **26** | **4** |

Avg score 93.1 (vs. 98.2 on the base-1000 — expected, since every one of these 200 questions was deliberately designed to be hard and none had been asked before). **picks_popularity (72% PASS) and privacy_groups (68% PASS) are the weakest areas** — consistent with Finding 1 above (popularity-routing reliability) and the inherent difficulty of adversarial privacy probing, respectively.

## Recommended priority order (not implemented this round)

1. **Picks-popularity routing reliability** (Finding 1) — highest-value: 5 confirmed instances, 3 different wrong destinations, a real intent-detection gap rather than a missing feature.
2. **Team-scoped card/corner dimension lookup** (Finding 2) — newly discovered, 4 confirmed instances, currently falls back to W/D/L with no card data at all.
3. **Group-name entity-matcher over-matching** (Finding 3) — 3 confirmed instances, concrete and likely a narrow regex/fuzzy-match fix similar in spirit to v34's `dimToMetric`/`most_popular_pick` plural fixes.
4. **Compound/ellipsis context-carryover** (Finding 4) — broadest category, real architectural gap, not a quick regex fix; v34 addressed 3 specific instances of this family, more remain.
5. Narrower items (fictional-fixture hallucination, group-meta-question fallback, the R16→QF hours question, corners-ranking direction, BTTS/possession graceful decline) — lower volume, worth a look in the same pass as the above since several touch adjacent code paths.

## Methodology notes

- The hard-200 corpus was authored via a parallel Workflow (8 draft agents + 8 critique/dedup agents, one pair per area), explicitly grounded in the app's real scoring/schema rules and the known live bug classes from this session, to maximize genuine novelty and difficulty rather than rephrasing the existing 1000-question set.
- `dirty_dev_data` (DEV club-test-data pollution) held steady at 258/1000 (base) and 73/200 (hard) — confirmed cosmetic per [[dev-data-scope-decision]], not a driver of any FAIL/PARTIAL.
- The existing regression gate (`v34_findings_test.mjs`, `sql_oracle_test.mjs`, and the other 8 suites in `eval.mjs`) was **not** re-run this round since no EF code changed — this 1000+200 live sweep serves as the requested before/after comparison and new-coverage test instead.
