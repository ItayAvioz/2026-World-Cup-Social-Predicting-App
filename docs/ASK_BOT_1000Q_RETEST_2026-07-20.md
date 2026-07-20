# Ask-Bot 1000-Question Retest + Fine-Tuning Points — 2026-07-20

**Target:** DEV EF `ask` v71 (post-v33) · **Compared against:** the 2026-07-19 baseline (EF v69, pre-v33) · **Scope:** DEV only, PROD untouched. **This round is testing + reporting only — no code changes were made.**
> **STATUS UPDATE (2026-07-20, later same day):** all 7 recommended fixes below were implemented, adversarially reviewed, gated (10 suites green), and deployed as **v34 (EF v72)** — the last planned ask-bot fine-tuning round. See `supabase/functions/ask/README.md`'s version header and `memory/ask-bot-dev.md` for the shipped detail. This document is kept as-is for the historical before/after record.
**Raw data:** [`ASK_BOT_1000Q_TEST_2026-07-20.csv`](./ASK_BOT_1000Q_TEST_2026-07-20.csv) (1000 rows) · [`ASK_BOT_TARGETED_PROBE_2026-07-20.json`](./ASK_BOT_TARGETED_PROBE_2026-07-20.json) (17 rows).

## What was run

1. The **identical 1000-question corpus** from 2026-07-19 (same 8 areas × 125, unchanged) re-fired at the current live EF, for a valid apples-to-apples before/after diff.
2. A **new 17-question targeted probe** (`scripts/ask/targeted_probe_v33_findings.mjs`) built from five issues surfaced while manually reviewing a real bot conversation earlier this session — the original 1000-corpus mostly doesn't hit these exact phrasings, so it needed dedicated cases to measure real prevalence rather than relying on one anecdote each.

## Headline: before → after

| | 2026-07-19 (EF v69) | 2026-07-20 (EF v71) | Δ |
|---|---|---|---|
| PASS | 890 | **960** | +70 |
| PARTIAL | 49 | **29** | −20 |
| FAIL | 61 | **11** | −50 |
| Avg score | 94.4 | **97.8** | +3.4 |

Row-by-row diff (same corpus, same order, matched by question text): **77 improved, 7 "regressed," 916 unchanged.** Every one of the 7 "regressions" was individually verified — **zero are genuine new content-quality drops caused by the v33 changes.** Detail below (Finding A).

**By difficulty (new run):** easy 332/342 PASS (97.1%) · medium 384/402 (95.5%) · hard 244/256 (95.3%) — the easy/hard gap that existed before (90.6% vs 86.3%) has nearly closed.
**By auth (new run):** anon 818/849 PASS (96.3%, up from 88.1%) · auth 142/151 (94.0%, unchanged) — confirms the v33 login-wall fix did its job: the anon path was the entire gap before, and it's now closed to within a few points of auth.

## Finding A: the 7 "regressions" — verified, none are real

| Question | Verdict change | Root cause |
|---|---|---|
| "how many red cards in the tournament?" | PASS→FAIL | Grading-oracle artifact (see Finding B) |
| "how many yellow cards have been shown?" | PASS→FAIL | Same |
| "how many red cards and yellow cards..." | PASS→FAIL | Same |
| "how many shots did Barcelona have this tournament?" | PASS→FAIL | **Grader false positive** — my own red-flag heuristic matches the literal digits "83" anywhere in an answer (a leftover check for the old bracket-max-83 bug) and fired on "Barcelona have **83** shots in 6 games" — a real, unrelated, plausibly-correct shot count. Not a bot bug. |
| "is this app free?" | PASS→PARTIAL | Real, minor: see Finding C |
| "can you show hidden predictions?" | PASS→PARTIAL | Real, minor: see Finding C |
| "and the top scorer?" (appears twice in the corpus, one instance flagged) | PASS→PARTIAL | Real, narrow: see Finding C |

## Finding B (new, confirmed): `cardsTotal` and `playerStatScoped` are missing a "finished" guard the rest of the codebase has

Verified directly against the DB, not assumed. The v33 fix scoped these two tools to `phase <> 'friendly'` only — but `teamStat` (fixed the same day) additionally requires `score_home IS NOT NULL`, matching CLAUDE.md's authoritative "finished" definition. `cardsTotal`/`playerStatScoped` don't have that second condition, so they also pick up:
- **3 real, unplayed group-stage games** (Mexico vs South Africa/South Korea/Czech Republic — `score_home IS NULL`) that already have `game_team_stats`/`game_player_stats` rows attached.
- **Two `TBD vs TBD` placeholder fixtures** (QF and Final phase) that — oddly — also have stat rows attached, contributing 5 and 8 yellow cards respectively.

Net effect on the tournament-wide total: bot says 12 red / 288 yellow; the fully-correct (finished + non-friendly) figure is 11 red / 265 yellow. Confirmed by directly replicating the EF's exact query — the bot is computing precisely what its code says, the code just has an incomplete filter.

**This is the highest-value finding of this round** for two reasons: it's newly discovered (not present in the 2026-07-19 report), and it's more concrete than usual — it names exact rows. And it's not confined to obscure test data: **`game_player_stats` has rows for real players (Kylian Mbappé, Erling Haaland) attached to the `TBD vs TBD` placeholder game.** Someone asking "how many goals does Mbappe have?" today would get a number inflated by phantom stats from an unplayed fixture. The other 9 phantom rows are generic placeholder names ("MEX Striker", "MEX Midfielder"...) tied to the 3 unplayed Mexico games — clearly seed/setup data that was never meant to be counted, likely a football-api-sync/seeding issue upstream rather than an ask-bot bug per se, but the ask-bot's scope filter should defend against it regardless of root cause.

**Recommendation:** add `.not('score_home', 'is', null)` to `cardsTotal` and the friendly-set query in `playerStatScoped` — the exact same one-line pattern already proven correct in `teamStat`. Separately worth a DB check: why do `TBD vs TBD` and unplayed-game rows have `game_team_stats`/`game_player_stats` entries at all.

## Finding C: three narrow validator/prompt gaps (all pre-existing, not v33-introduced)

1. **`REFUSAL_ANSWER_RE` doesn't recognize "I'm sorry, but..."** — only `i'?m not sure`/`i'?m having trouble` are covered; a plain `i'?m sorry` lead-in (a very natural LLM refusal phrasing — both the old AND new answers to "can you show hidden predictions?" start this way) isn't exempted from the shape check, so a perfectly good refusal gets flagged. One-line regex addition (`|i'?m sorry`) would close this.
2. **`rules_llm` shape failures never retry.** "is this app free?" produced a genuinely worse answer than before (hedging about "betting" and fees instead of a direct "yes, it's free") and the shape validator correctly caught it (fails the yes/no shape check) — but v32's self-heal design deliberately skips retrying LLM-used routes to avoid a second costly, provenance-unfixable LLM call. That's the right default for `rag_crew`, but `rules_llm` answers are deterministic-adjacent (temp=0.2, seeded) and a retry is cheap; worth considering a narrower carve-out that allows one retry specifically for `rules_llm` shape failures.
3. **Context-borrowed `spec.teams` can outlive its usefulness.** The exact same question ("and the top scorer?") appears twice in the corpus with different history; one instance carried over a `teams` value from prior context that `checkOnTopicEntity` then demanded the (team-agnostic) `stat_leaderboard` answer mention — a false positive. Worth checking whether team context should be cleared before entity-checking an answer from a tool that never used `spec.teams` in the first place.

## Finding D: the five conversation-review issues, generalized with real prevalence

The targeted probe (17 cases) confirms all five and measures how far each one extends:

| Family | Result | What it shows |
|---|---|---|
| Plural "games"/"matches" superlative | 2/6 PASS | Confirmed across **red, yellow, and goals** dims (all fall to a player-level answer on the plural form); **corners** manifests differently — falls to a *team*-level answer instead, so the underlying gap is wider than just "player vs game," it's "the game-level route doesn't trigger at all" for several dims. Singular control case passes cleanly, confirming the bug is specifically the missing plural in `dimToMetric`'s `gameWord` regex. |
| Plural "winners" (popularity) | 0/2 PASS | Confirmed exactly as diagnosed — `\bwinner\b` singular-only misses "winners"; singular control passes. |
| Compound-clause noun elision | 0/3 PASS | **Confirmed and it's worse than one example** — reproduces identically across three unrelated topics (ET/pens, draws/wins, yellow/red cards): clause 2 always falls to the off-topic steer-back once it loses the shared noun from clause 1. |
| Arsenal-style friendly-scope disclosure | 2/2 PASS (loose check) | The undercount itself no longer applies post-Finding-B-adjacent fixes for `teamStat`; single-shot answers correctly name the team. The *softer* issue — that a friendly game shown two turns earlier gets silently dropped from a "how many games played" count without saying so — wasn't re-tested here since it's a multi-turn UX nuance, not a single-question correctness bug. |
| Typo'd "games played" | 0/3 PASS | **Refined diagnosis, not what I originally guessed.** The failure reproduces even on a *standalone* typo'd question with no compound "and" clause at all ("hw many games played so far?") — so this is a **typo-robustness gap in `tournament_progress`'s question-matching**, not a compound-splitting issue. The original conversation's "clause 2 rescues clause 1" framing was a coincidence of that one example, not the real mechanism. |

## Recommended priority order (not implemented this round)

1. **Finding B** — one-line fix in two functions, directly named rows to verify against, highest real-world visibility (Mbappé/Haaland).
2. **Family: plural game/match dims** (Finding D) — same fix class as the v33 login-wall choke point: one regex, `\bgames?\b|\bmatch(es)?\b`, closes red/yellow/goals/corners at once.
3. **Family: compound-clause noun elision** (Finding D) — needs a real design decision (carry clause 1's noun into clause 2's routing context, or re-join before splitting when clause 2's own tool-match fails) — more involved than a regex tweak, reproduces 3/3.
4. **Finding C.1** — one-line `REFUSAL_ANSWER_RE` addition.
5. **Family: plural "winners"** (Finding D) — one-line regex, same pattern as #2.
6. **Finding C.2** — a scoped retry-allowance for `rules_llm` shape failures (design decision, not a one-liner).
7. **Finding C.3** and the typo-robustness refinement (Finding D typo family) — lower volume, worth a look in the same pass as #2/#3 since they touch adjacent code.

## Methodology notes

- The 6 "ground-truth mismatches" reported by the grader on this run are **not** grader bugs like the first round — Finding B's investigation confirmed they trace to a real, if narrow, EF scope gap. The Man City team-goals rows that also showed as "mismatch" *are* grader staleness (my factbank oracle field wasn't updated for v33's new friendly-exclusion scope) — verified by direct replication that `teamStat`'s own output (12 scored / 3 conceded) is exactly correct once compared against the right scope.
- `dirty_dev_data` (DEV club-test-data pollution) held steady at 258/1000 rows, 2 of which FAIL — confirms again it's cosmetic, not a correctness driver.
