# Ask Bot v31 — Architecture Audit + Implementation-Ready Plan

**Target restated by the user:** "a bot that controls the entire application and data, high
quality, accurate, professional, and reliable" — not more point-fixes, but closing the
*architecture* gaps that keep producing the same bug shape.

## STATUS (2026-07-18, v32): the §7 deferred list is now largely CLOSED — see below.

**v32 fine-tuning cycle (EF v66, 2026-07-18)** — driven by a real user session transcript (10
annotated failures) + the v31 observe-mode validation telemetry. Every fix targeted a failure
CLASS: outcome aggregates (draws/0-0/W-D-L distribution — no tool existed), platform-wide pick
popularity (SPEC CHANGE: bare "most chosen" = whole app; `POPULARITY_RE` unified 4 drifted
copies), champion-odds RLS bug (anon client saw 0 of 48 rows — caught by the observe-mode
validators), fuzzy typo repair (curated vocab, FUZZY_SAFE real-word guard), city-shadow team
resolution ("real madrid" no longer summons Atletico), elliptical compound tails dropped,
ET+pens combined, W/D/L "by order" → recent_form, **rules facts corrected at source (max 75,
no 3rd-4th bonus, win-gated 3rd place — the "+6/83 hallucination" was a faithful cite of a
stale prompt)**. From §7: ✅ **enforcement flip for V2/V4/V5** (false-positive classes exempted
first — refusals/clarifies skip shape+entity, years skip numerics — then `done()` self-heals on
any flag; non-repeat failures ship the retry only if clean AND different), ✅ **V4 Tier B
(D2-core)** (rag_crew binds every answer number to its retrieved cards), ✅ **platform
popularity tally**, ✅ **shadow-replay** (`scripts/ask/shadow_replay.mjs`, 125 real questions,
baseline rebased after the 34 intended drifts were reviewed), ✅ **AskBot session telemetry**
(session_id/turn → ask_log, M-20260718000001). Gate at ship: wide 132 · real_chat 22 · fault 9
· typo 15 · shape 14 · scope 9 · sql_oracle 8 · context_isolation 13 — ALL green (three suites
updated for the 75-point + platform-popularity SPEC changes, not weakened). Still open: FULL D2
structured-ToolResult migration (typed rows + rows_count), V3 entity-registry gate, V6 general
auth map (worst instances now tool-bound), rulesFAQ PR3 topic migration.

## PREVIOUS STATUS (2026-07-16): IMPLEMENTED (D1 + D3 + D4 + D5 + streak-best + must-sweep). D2 + the §7 deferred list remain open.

**What shipped 2026-07-16 (all DEV-only, CLI-deployed, full 8-suite gate green):**
- **Phase 1 — D1 Context Gate**: `detectContextNeed()` + gated borrows + `spec.context` telemetry.
  One design correction found live: `they/them/their` had to be split from `he/him/his/she/her`
  (plural pronoun = TEAM referent in this domain; conflating them broke the compound
  "Man City scored X, how many have THEY conceded?" flow). Shadow-mode phase was skipped in favor
  of direct implementation + the context-isolation suite as the acid test (all 13 pairs green).
- **Phase 3 — D4**: `normalizeQuestion()` (11 confirmed compound/typo fixes) + `RULE_TOPICS`
  (3 topics × 5 shapes, ALL matched shapes render) + compound clause-2 topic inheritance
  (a pronoun follow-up clause renders another shape of clause 1's topic) + the public pens-list
  rules moved above the private block (tool-bound-auth principle). Old rulesFAQ lines kept as
  fallback safety nets (PR3 deletion deferred as the critique advised).
- **streak-"best" + must() sweep**: both §5 orphaned gaps closed (28 more call sites wrapped).
- **Phase 8 — D3**: V1 unconditional + depth-1 isolated self-heal (no more false clarifies);
  V2/V4-TierA/V5 in OBSERVE MODE (logged to `ask_log.validation_fail text[]`, never blocking —
  enforcement flip is a later data-driven decision); `expected_shape` written on every answer;
  the 7 route-less `done()` sites fixed (G-ROUTE-NULL-LOGGING).
- **Phases 0/2/4/7/13 — D5**: 6 new suites written AND wired as BLOCKING into `eval.mjs`
  (fault_boundary, typo_noise, shape, scope_matrix, sql_oracle, context_isolation-curated);
  `wide_test.mjs` gained real exit-code gating (it always exited 0 before — the old
  "wide_test=PASS" was decorative). First full gate run immediately caught 3 REAL bot bugs
  (trivia count 42-not-40 with the old test false-passing on "40 seconds"; per-team red-card
  counts answering W/D/L form; "teh"-typo defeating the group-name stoplist) — all fixed.
- **DEFERRED, still open** (see §7): D2 ToolResult migration, V4 Tier B, V3/V6 gates,
  V2/V4/V5 enforcement flip, platform-wide popularity tally, shadow-replay, fault_inject admin
  mode, AskBot.jsx session telemetry + gh-pages deploy.

## ORIGINAL STATUS (2026-07-15): PLAN COMPLETE, NOT YET IMPLEMENTED.

This plan was produced by a 19-agent workflow (`ask-bot-architecture-audit-v31`, run
`wf_0174b90e-2ff`) that (1) re-verified an external code reviewer's 10-claim critique directly
against the live `supabase/functions/ask/index.ts` (DEV EF v57, not memory/docs), (2) synthesized
13 prioritized gaps + 6 root architecture failures, (3) produced 5 detailed component designs
(D1-D5), and (4) ran 3 independent critique passes (engineering feasibility, gap-traceability,
rollout sequencing) that found real cross-component conflicts and produced one **reconciled
14-phase build order** — that order (§6) is the actual thing to execute, not the 5 designs read
in isolation.

**Nothing in this plan has been implemented yet.** This document is the entry point for that
work. Supersedes nothing — v29/v30 (`PLAN_ASK_BOT_V29.md`) stay as-is; this is the next cycle on
top of EF v57.

---

## 0. How this was produced (so a future session trusts or re-checks it correctly)

1. An external reviewer (outside this session) read the app's docs/code/flow.svg and produced a
   13-point critique in prose, with code excerpts, of the ask-bot's architecture.
2. Before spending agent budget, I personally grep/read-verified several of its sharpest claims
   directly against `index.ts` (context-borrow guards, `rulesFAQ`'s Road-to-Final/AI-summary
   regexes, the V1 repeat-guard condition, `answerCrew`'s grounding check) — all matched exactly.
3. That grounding justified a full workflow: **10 independent verify agents** (one per claim,
   each required to quote exact file+line evidence, not summarize) → **1 synthesis agent**
   (dedupe into architecture failures + tiered gap list, explicitly cross-checked against v30 so
   nothing already-fixed gets re-flagged) → **5 parallel design agents** (one per component,
   each required to read the live file and name real function/line numbers, not invent an API)
   → **3 critique agents** (feasibility / gap-traceability / rollout-sequencing), each given the
   other agents' full output to check against.
4. Verdict on the external critique: **9 of 10 claims fully CONFIRMED**, 1 partially confirmed
   (its framing that "every test case is bug-derived" was slightly overstated — real_chat_test.mjs
   has some deliberate regression-guard cases too). Nothing was refuted as flatly wrong.

Full raw agent output (verify claims, designs, critiques) is preserved in this session's
workflow journal; this document is the distilled, actionable version. If a future session needs
the verbatim evidence quotes behind any line below, re-run or resume
`wf_0174b90e-2ff` rather than re-deriving from scratch.

---

## 1. Executive summary (from the synthesis agent, lightly edited)

The ask-bot is functionally rich but has a real, still-open correctness gap that is **the same
shape as the six bugs v30 already fixed** — the root causes behind those six bugs are still
present and will keep producing this class of bug. One finding is **P0**: context/entity
borrowing across turns has no linguistic follow-up gate at all — it fires whenever the current
question happens to resolve zero teams and no phase, with no requirement that the question
actually reads like a follow-up. Because tools with mutually exclusive team-count preconditions
key off the same keyword, a stale carry-over can silently swap a user's aggregate question for a
single stale game's detail — and there is no logging trail sufficient to diagnose it after the
fact (only a team *count* is logged, never values or source).

Everything else found is **P1**: a family of shape-blind keyword regexes that answer half of a
compound question or the wrong side of a homonymous keyword; a **brand-new, distinct** gap in the
just-shipped streak-direction logic (bare "best streak" still falls to the current-trailing
default); a typo that defeats word-boundary regex and silently substitutes the wrong scope; a RAG
grounding check that verifies a digit exists somewhere in a card rather than that it's attached to
the right stat and entity; inconsistent application of an error-vs-empty-result safety wrapper
that already exists and works where used; no platform-wide scope for pick-popularity questions;
and, underlying most of this, an architecture where every answer is a finished sentence with no
structured intermediate, so the validation-telemetry columns already added to the database have
never been populated.

The test suite mirrors this: real and useful, but overwhelmingly a reproduction log of bugs
already found manually, not a system built to find the next one — none of eight standard
systematic testing techniques exist in the repo. Given this app's own history of a
confidently-wrong bot shipping behind a green synthetic suite (twice), that gap is not
hypothetical. **Bottom line: not yet a fully trustworthy assistant.** Nothing found is a
security/privacy leak. The P0 item should close before broader exposure; the P1 items are what
stands between this bot and the next several versions of the same bug class.

---

## 2. Verified gaps (13), tiered

| ID | Title | Verdict | Severity | Tier |
|---|---|---|---|---|
| **G-CTX-BORROW** | Context/entity borrowing has no follow-up-signal gate — silently inherits stale teams/phase, can flip a global-list answer into a single stale game's detail (both `et_pens_list`/`game_detail` key off the same `penalt` keyword with opposite team-count preconditions). No log captures that a borrow happened, its source, or pre-borrow state. | CONFIRMED | **P0** | P0 |
| G-SHAPE-BLIND-RULES | `rulesFAQ`/`ROUTE_RULES` topic regexes ignore question shape: Road-to-Final "explain...how it works" gets the location-only FAQ; a champion/scorer question asking both value AND timing only gets the value half; "where is the AI summary" gets a real roast dumped instead of navigation (negative lookahead excludes when/timing but not "where"). | CONFIRMED | P1 | P0 |
| G-STREAK-BEST | `streakWant()` has no branch for bare "best streak" — falls to current-trailing-streak default, can report a losing streak when asked for the best one. **New gap, distinct from the v30 hot/cold fix** (v30 added recognition for explicit hot/cold/positive/negative; never added "best"/"longest"/"record" with no direction word). | CONFIRMED | P1 | P0 |
| G-TYPO-MISROUTE | Unspaced typo "globalleaderboard" defeats `\b`-anchored regex, silently substitutes the caller's own-groups dump for the true global leaderboard. Real routing bug, not a scope-modeling gap — a correct global path already exists for properly-spaced text. | CONFIRMED | P1 | P0 |
| G-NO-SCOPE-TYPE | No platform-wide (all-users) scope exists for pick-popularity questions — `mostPopularPick` is hard-wired to the caller's own groups via `myGroups()`; no tool tallies champion/top-scorer picks across `get_leaderboard()`'s full row set. | CONFIRMED | P1 | P1 |
| G-RAG-GROUNDING-WEAK | `answerCrew`'s numeric-grounding check is pure substring membership (`cards.some(c => c.content.includes(n))`), not per-number-to-metric-and-entity binding. Real but narrower than "all stat questions" — concrete single-metric lookups are answered by deterministic tools earlier in routing. | CONFIRMED | P1 | P1 |
| G-ERROR-SWALLOW | `must()` (the DB-error-vs-empty-result wrapper) exists and works, but wraps only 17 of the file's Supabase call sites; 18+ others (incl. the newest v30 code, `regulationPenaltyList`) use bare `data ?? []`, so a transient DB/network failure renders a confident "no data exists" string instead of an error. | CONFIRMED | P1 | P1 |
| G-PROSE-NOT-FACTS | ~40 of 41 fact-answering tool functions return `Promise<string>` (compute-and-phrase in one step) — the direct root cause of the RAG-grounding weakness and of the dead telemetry columns below; no architectural seam exists for a future validator to bind a stated number to its source field. | CONFIRMED | P1 | P1 |
| G-V1-CONFIDENCE-GAP | Repeat-guard (V1) only fires when confidence < 0.50 or intent = `off_topic` — a **confident** misroute that happens to echo the previous answer verbatim is never caught, exactly the highest-risk case. | CONFIRMED | P1 | P1 |
| G-VALIDATION-LAYER-MISSING | Of validation gates V0-V6, only V0 (outbound-payload privacy guard) is fully built as designed. V2 (shape), V3 (entity-exists registry), V5 (on-topic-entity) have zero code. V4/V6 exist only as narrow one-off patches. `ask_log.validation_fail` only ever writes the literal `'repeat'`. | CONFIRMED | P1 | P1 |
| G-TEST-COVERAGE-METHODOLOGY | Test suites are predominantly known-bug regression tests (not entirely — some deliberate regression-guard cases exist too); **none** of 8 standard systematic testing techniques exist (context-isolation property test, shape matrix, typo/mutation fuzzing, scope matrix, privacy/auth matrix, fault injection, SQL-oracle cross-check, ask_log shadow-replay). | PARTIALLY CONFIRMED | P1 | P1 |
| G-NO-NORMALIZATION | No generic question-normalization function exists before classification/routing — text cleanup is duplicated ad hoc, inconsistently, inside entity-lookup helpers that run **after** routing. Root mechanism behind G-TYPO-MISROUTE. | CONFIRMED | P1 | P1 |
| G-ROUTE-NULL-LOGGING | `route` is omitted from 7 `done()` call sites, leaving `ask_log.route` NULL for a number of genuinely-successful answers — reduces debuggability, no user-facing impact. | CONFIRMED | P2 | P2 |

**Already fixed (v30) — do not re-flag:** game-scoped stat superlatives, team-dim superlative
direction/polarity, pick popularity for *named* teams, streak direction (hot vs cold with an
explicit qualifier), trivia 24h window fact, regulation-vs-shootout penalty conflation. All
re-confirmed present and working in the live source during this audit.

---

## 3. Root architecture failures (6) — what actually causes the 13 gaps

1. **Context/entities are borrowed too eagerly, with no follow-up-signal gate.** → G-CTX-BORROW.
2. **Question shape/grammar is not a first-class contract**, and question text is never
   normalized before routing. → G-SHAPE-BLIND-RULES, G-STREAK-BEST, G-TYPO-MISROUTE,
   G-NO-NORMALIZATION.
3. **No explicit Scope type** — global vs my-groups vs named-group aggregation is ad hoc per
   tool. → G-NO-SCOPE-TYPE.
4. **Tools compute-and-phrase in one step and return prose, not structured facts.** →
   G-PROSE-NOT-FACTS, G-RAG-GROUNDING-WEAK (direct downstream effect).
5. **Errors are swallowed as confident empty results** — the fix (`must()`) exists but is applied
   inconsistently. → G-ERROR-SWALLOW.
6. **Validation and evaluation infrastructure targets specific known bugs, not general behavior
   families.** → G-V1-CONFIDENCE-GAP, G-VALIDATION-LAYER-MISSING, G-TEST-COVERAGE-METHODOLOGY.

---

## 4. The 5 components (D1-D5) — condensed designs

Each below: goal, core mechanism, effort, and the **corrections the critique panel forced**
(these corrections are already folded into §6's build order — read them before implementing).

### D1 — Context Gate (`ContextNeed` detector + borrow-gating)

**Fixes:** G-CTX-BORROW (P0).
**Mechanism:** flip the default from "borrow whenever a slot is empty" to **isolation by
default** — only borrow when the current question itself signals a follow-up. New pure
detector, no network call:

```ts
type ContextSignalKind = 'pronoun' | 'leading_conjunction' | 'deictic_game' | 'deictic_group' | 'bare_comparative'
type ContextNeed = { any: boolean; signals: ContextSignalKind[]; allow: { team: boolean; entity: boolean; group: boolean; shape: boolean } }
type ContextSource = 'prev_spec' | 'last_answer_text' | 'history_text'
type ContextTelemetry = { used: boolean; source: ContextSource | null; fields: string[] }

const CTX_PRONOUN = /\b(he|him|his|she|her|they|them|their)\b/i
const CTX_LEADING_CONJ = /^\s*(and|what about|how about)\b/i
const CTX_DEICTIC_GAME = /\b(that|this|same)\b[\s\S]{0,12}\b(game|match|one)\b/i
const CTX_DEICTIC_GROUP = /\bin (that|this|our|my) group\b|\bin mine\b|\bover there\b|\bthere\b/i
const CTX_BARE_COMPARATIVE = /^\s*(the\s+)?(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last|next|runner.?up|bottom|lowest|highest|worst)(\s+(place|one|team|group|spot|position))?\s*\??\s*$/i
```

Replaces the 3 unconditional borrow sites at `index.ts:1940/1941/1943-1948` with gated
equivalents; adds `context: ctxTelemetry` to `pubSpec` (L1952) and the structured `console.log`
(L1965). Traced against all 4 history-bearing test cases in `wide_test.mjs`/`real_chat_test.mjs`
line-by-line — confirmed zero regression, and the flagship `C2-typo-next-ctx` case should stop
needing the `repeat_guard` fallback entirely once this ships (route changes from masking the bug
to preventing it).

**Effort:** M. **Phases:** 1) shadow-mode (log what *would* be blocked, zero behavior change) →
2) real gate → 3) optional cleanup (collapse 3 duplicated ad hoc pronoun regexes elsewhere in the
file into this one canonical set) → 4) optional `ask_log` columns if console.log telemetry proves
insufficient.

**Critique correction:** the optional Phase-4 migration path was written as
`supabase/migrations/...` — **wrong directory**. This table is DEV-only; it must be
`supabase/migrations-dev/...` like its own existing 2 migrations.

### D2 — Structured Tool Results (`ToolResult<T>` + `Scope` + `render()`)

**Fixes:** G-PROSE-NOT-FACTS (enabler), partially G-ERROR-SWALLOW (as a side effect on migrated
tools), is the prerequisite for D3's V4 Tier B and for real telemetry (`rows_count`).
**Mechanism:**

```ts
type Scope =
  | { kind: 'self' } | { kind: 'my_groups' }
  | { kind: 'named_group'; groupId: string; groupName: string }
  | { kind: 'global' } | { kind: 'tournament' }
  | { kind: 'game'; gameId: string; teamHome: string; teamAway: string }
  | { kind: 'team'; team: string }

type ToolResult<T> = { tool: string; status: 'ok'|'empty'|'error'; rows: T[]; facts: Record<string,string|number|boolean|null>; scope: Scope; source: { tables: string[] } }
function render(spec: { tool: string }, result: ToolResult<any>): string { /* looks up TEMPLATES[result.tool] */ }
```

Migrate the **8 highest-traffic/highest-risk** tools only (not all ~41):
`statLeaderboard` (+ its 2 game-level helpers), `mostPopularPick`, `gameStats` (box score),
`scheduleList`+`lookupGame`, `myFocus`, `myRates`, `groupStandings`, `latestRoast` (lowest
priority — no computed number, do last). `statLeaderboard` is the fully-worked example (it's the
exact function that shipped the v30 direction-inversion bug). Verification requires more than
`eval.mjs` — a new `scripts/ask/snapshot_diff.mjs` captures golden before/after answers from the
**live deployed EF** for a hand-picked set per function (including tie cases and explicit
inverse-polarity phrasing) and requires byte-identical diffs, since both existing suites only
grade by substring inclusion.

**Effort:** originally labeled L; **critique correction: re-size to XL** (or explicitly cap to
3-4 tools for a first pass) — 8 independent golden-snapshot round trips is materially bigger than
"L".
**Critique correction:** the golden-snapshot method has no defense against **live tournament data
drift** between "before" and "after" captures (a game finishing mid-migration). Restrict golden
inputs for time-sensitive tools to already-finished/frozen data, or capture before/after within
one short session with no live game in between.

### D3 — Universal Answer Validation Layer

**Fixes:** G-V1-CONFIDENCE-GAP, G-VALIDATION-LAYER-MISSING (V2/V5 fully, V4 partially — V3/V6
remain unbuilt by this design too, see §8).
**Mechanism:** one shared choke point — every route already funnels through `done()`. Add:
- **V1 (fixed):** delete the `spec.confidence < CLARIFY_CONF || spec.intent === 'off_topic'`
  clause entirely. Unconditional per the *original* spec: "byte-identical answer to a different
  question is ALWAYS suspicious." Recovery: **one bounded re-route** with all borrowed context
  stripped (`isolatedRetry` flag on `RouteDeps`, hard depth-1 cap), clarify only if the isolated
  re-route *also* reproduces the identical answer.
- **V2 (shape):** `deriveShape()` maps question→`'one'|'count'|'when'|'where'|'yesno'|'other'`
  from the already-parsed `Spec`; `checkShape()` asserts minimal structural properties (a "count"
  answer must contain a digit *and* the right dimension's noun via a `DIM_NOUN` map; a "where"
  answer must name a real screen from a fixed `SCREENS` list; etc.). Fails open on `'other'`.
- **V4 (two-tier):** Tier A ships now — every deterministic tool answer auto-passes
  (`!ctx.llmUsed`); the 2 existing LLM routes (`rules_llm`, `off_topic`) get a hand-authored
  `RULES_FACTS` constant (mirrors CLAUDE.md's Scoring Rules table) to check against. Tier B
  (generalizing to `rag_crew`/`llmUnderstand` fallback with *dynamic* per-question facts) is
  genuinely blocked on D2 — **but see critique correction below, the blocking claim as originally
  scoped is wrong.**
- **V5 (on-topic-entity):** reuses the already-resolved `spec.teams` — the answer must mention at
  least one named team; zero new entity-resolution work.

**Effort:** L. **Phases:** PR1 (V1 fix + shared recovery mechanism, ships first) → PR2 (V5) → PR3
(V2) → PR4 (V4 Tier A) → PR5 (V4 Tier B, re-scope per below).

**Critique corrections (2, both real implementer-blockers if unaddressed):**
1. The design's own `runChecks()` code sample calls all four checks together, but the phased
   steps ship them across 4 separate PRs — **PR1 as literally written would not compile**
   (`checkShape`/`checkNumericProvenance`/`checkOnTopicEntity` undefined). **Fix: PR1 must ship
   stub versions of all three (`return false`) alongside the real `checkRepeat`, so `runChecks()`
   compiles from PR1 onward; PR2/3/4 replace one stub at a time.**
2. PR5's "blocked on D2" is **not actually true as scoped**: D2's 8 migrated functions are all
   deterministic tools that Tier A's `!ctx.llmUsed` already auto-trusts — none of them ever reach
   Tier B's code path. The functions PR5 actually needs facts from
   (`answerCrew`/`rag_crew` and `execUnderstood`/`llmUnderstand` fallback) are **not on D2's
   migration list at all**. **Fix: either extend D2's scope to cover those two, or re-budget PR5
   as independent new work with its own effort estimate — do not schedule it as "runs right after
   D2 Phase 8."**
3. Also missing: a pre-deploy corpus scan for V1's own acknowledged false-positive class (two
   differently-worded questions sharing one correct answer) — D1 did this kind of scan before
   shipping a structurally similar change; D3 should too, before PR1.
4. D3's text never restates the CLI-only/DEV-only deploy constraint — must be added explicitly,
   since D3 makes the most invasive change to the core request path of any component.

### D4 — Rules-as-Data (`RULE_TOPICS`) + Shape-Aware Rendering + Input Normalization

**Fixes:** G-SHAPE-BLIND-RULES (for 3 concrete topics, not the general `ROUTE_RULES`
ordering architecture — see §8), G-TYPO-MISROUTE, G-NO-NORMALIZATION.
**Mechanism:**

```ts
const COMPOUND_FIXES: [RegExp, string][] = [
  [/\bgloballeaderboard\b/gi, 'global leaderboard'], [/\bwentto\b/gi, 'went to'],
  [/\btopscorer\b/gi, 'top scorer'], [/\bnextgame\b/gi, 'next game'], [/\blastgame\b/gi, 'last game'],
]
const TYPO_FIXES: [RegExp, string][] = [
  [/\bchossen\b/gi, 'chosen'], [/\bchoosen\b/gi, 'chosen'], [/\bavilable\b/gi, 'available'], [/\bfroup\b/gi, 'group'],
]
function normalizeQuestion(raw: string): string { /* apply both fix lists once, before ANY routing */ }

type RuleShape = 'location' | 'explanation' | 'timing' | 'lock' | 'value'
type RuleTopic = { location?: string; explanation?: string; timing?: string; lock?: string; value?: string; defaultShape: RuleShape }
const RULE_TOPICS: Record<string, RuleTopic> = { road_to_final: {...}, champion_scorer_points: {...}, ai_summary: {...} }
// detectRuleShapes() returns ALL matching shape cues (not first-match), renderRule() concatenates every matched field
```

3 fully-worked topics only this increment: `road_to_final`, `champion_scorer_points`,
`ai_summary`. Walk-through confirms the exact fix for all 3 named bugs (explain-vs-where,
value-vs-timing both rendering together, AI-summary where-vs-content) **and** specifically
re-verifies the popularity-question regression risk (a bare "champion" + a "how many/how much"
value-cue must NOT resurrect the v30 "most chosen champion" bug) via the same `isPopularityQ`
regex reused verbatim from `ROUTE_RULES`, plus an independent `teams.length===0` guard —
defense-in-depth on purpose. ~20 remaining `rulesFAQ` lines explicitly deferred to future
increments (PR4+), not silently dropped.

**Effort:** M. **Phases:** PR1 (normalizeQuestion, zero behavior-change risk) → PR2 (RULE_TOPICS
for the 3 topics, shadow-in-front of the still-live old `rulesFAQ` lines) → PR3 (delete the now-
dead old lines, only after PR2 has been green through a full eval cycle) → PR4+ (deferred, ~20
more topics, one PR per topic/cluster, same pattern).

### D5 — Test/Eval Architecture Redesign + Telemetry Expansion

**Fixes:** G-TEST-COVERAGE-METHODOLOGY (6 of 8 named techniques get real scripts; shadow-replay
and a dedicated privacy/auth matrix do not — see §8), contributes telemetry beyond what's needed
for G-ROUTE-NULL-LOGGING (critique flagged this as scope creep, see below).
**6 new suites**, each independently shippable, in `scripts/ask/`:
1. `context_isolation_test.mjs` — 8 self-contained PROBE questions × 7 POISON prior turns;
   asserts both content (substrings still hold) AND routing (`route`/`intent` matches a clean
   baseline) after a poison turn. Curated 10-pair subset BLOCKING; full 8×7=56 cross-product
   ADVISORY (`--full` flag).
2. `shape_test.mjs` — 3 topics × 6 question-shapes (where/when/how-many/who/explain/how-it-works)
   = 18 cases; asserts per-shape structural validity AND that no two shapes on the same topic
   produce a byte-identical answer.
3. `typo_noise_test.mjs` — 20 hardcoded, hand-verified real-question mutations.
4. `scope_matrix_test.mjs` — popularity + leaderboard tools × self/my-groups/named-group/global;
   explicitly documents the still-open `pop-global` case as a **known gap, not a failure**
   (asserts the bot is honest about scope rather than silently wrong).
5. `sql_oracle_test.mjs` — 6 numeric questions, each checked against an **independently computed**
   ground truth (raw PostgREST GET with the anon key, or a static parse of the trivia-seed
   migration file for the one case RLS would otherwise undercount) — the only mechanism in the
   whole plan that validates against a truth source other than "matches previous output."
6. `fault_boundary_test.mjs` (zero code change, malformed/adversarial *input*, BLOCKING
   immediately) + an optional later `fault_inject` admin mode (monkey-patches a request-local
   OpenAI client to force a real failure path — ADVISORY only, ships last, needs its own security
   review) + a zero-code manual runbook alternative (temporarily swap the `OPENAI_API_KEY` secret
   for 60 seconds).

Telemetry: `ask_log` gains `session_id/turn_index/history_len/degraded/clarify/fallback/compound/
auth_mode/source` so a full multi-turn session can be reconstructed from stored data without
asking the human to reproduce it live.

**Effort:** XL. **Critique correction (scope creep, real):** this 9-column telemetry migration
serves a "no manual repro" goal that is **not itself one of the 13 verified gaps** — meanwhile it
does **not** fix the one concrete, already-diagnosed logging gap that *is* on the list
(G-ROUTE-NULL-LOGGING, `route` omitted at 7 call sites). **Fix: either trim this migration to
what's needed for G-ROUTE-NULL-LOGGING plus what materially helps diagnose G-CTX-BORROW
(reconciled with D1's own `ctxTelemetry`, not duplicated), or keep it but explicitly also land the
1-line `route` fix as its own item — don't let 9 new columns ship while a 1-line diagnosed bug
doesn't.**

---

## 5. What the critique panel changed (read before implementing anything)

Three independent critiques (feasibility / gap-traceability / rollout-sequencing) were run
against all 5 designs together. Their findings are folded into §4's corrections above and §6's
order below; the highlights not to miss:

- **D1, D3, D5 all rewrite the same region** (`pubSpec`/`RuleCtx`/`done()`/`finish()`). None of
  the 5 design docs reference each other. If implemented independently in the order written, the
  second one to land silently drops the first one's additions (e.g. D3's shown `done()` rewrite
  does not include D1's `context: ctxTelemetry` field). **These three must land strictly
  serially**, and whichever lands second/third must re-derive its line-number anchors from the
  **post-merge live file**, not from either design doc's original numbers.
- **G-STREAK-BEST is not fixed by any of the 5 designs.** D2's `myRates` migration sketch
  explicitly says "keep `ratesFor()` untouched" — the actual bug (no "best"/"longest" branch in
  `streakWant()`) is never patched anywhere. **This needs an explicit small fix folded into D2's
  Phase 6 (myRates migration) or done standalone before it — do not assume D2 covers it.**
- **G-NO-SCOPE-TYPE is only partially addressed.** D2 defines a `'global'` Scope kind, but no
  migrated function ever produces it for popularity — D5's own scope-matrix test labels this a
  documented, non-blocking known gap. **Decide explicitly**: either commit to building a real
  platform-wide popularity tally, or formally accept this as deferred/out-of-scope rather than
  letting the unused type imply it's handled.
- **G-ERROR-SWALLOW has no design that commits to systematic closure** — only the 8 functions D2
  happens to migrate get the fix as a side effect; the other ~18+ bare `data ?? []` call sites are
  untouched by every design. **This is mechanical and cheap — schedule it as its own small PR,
  independent of D2's larger structural migration**, wrapping remaining call sites in the
  already-proven `must()` pattern.
- **V3 (entity-exists/anti-hallucination registry) and V6 (generic public-tool auth binding) have
  zero implementation anywhere** across all 5 designs, despite being named as missing gaps.
  Explicitly out of scope for this cycle (see §8) — do not present D3 as having closed
  "the validation layer" when 2 of 6 named gates are still unbuilt.
- Only D2 states the mandatory "fetch deployed source, diff against local" verification step
  (this repo's own standing `ef-repo-not-source-of-truth` convention). **Every phase in §6 below
  needs it, not just D2's** — folded into §6 explicitly.

---

## 6. RECONCILED IMPLEMENTATION ORDER — execute this, not the 5 designs read separately

Every phase ends with: `npx deno@2 check --node-modules-dir=auto supabase/functions/ask/index.ts`
(no new errors vs HEAD) → `npx supabase functions deploy ask --project-ref ftryuvfdihmhlzvbpfeu`
(**CLI only — never MCP `deploy_edge_function`; never PROD `asugxlvgcmkxspzokydk`**) →
`node scripts/ask/eval.mjs` (must stay green + any new suite for that phase) → re-fetch the
deployed source (`get_edge_function`) and diff against the local file to confirm the deploy
wasn't silently truncated, per this repo's own standing convention.

| # | Phase | What ships | Why here |
|---|---|---|---|
| 0 | **Safety net** | `scripts/ask/fault_boundary_test.mjs` (D5 §6a, zero `index.ts` change) added to `eval.mjs` as BLOCKING. `scripts/ask/snapshot_diff.mjs` built; golden-snapshot baselines captured **now**, against the currently-deployed EF, for every high-risk surface a later phase will touch (stat-leaderboard polarity, most-popular-pick, my-rates streak direction, schedule future-score guard, the 3 rulesFAQ topics D4 targets). | Zero-dependency net any later phase can diff against. |
| 1 | **D1 Phase 1 → 2** (Context Gate) | Shadow mode first (log what would've been blocked, zero behavior change), then the real gate replacing the 3 unconditional borrow sites. | The single confirmed P0 bug, root-caused. Additive-first, zero dependency on anything else. |
| 2 | **D5 curated context-isolation subset** (pulled forward from its own late slot) | The ~10-pair curated `context_isolation_test.mjs` subset, run now as the acid test for Phase 1. | Materially stronger proof than D1's own 4-case trace alone — verify immediately while the change is fresh. |
| 3 | **D4 PR1 → PR2 → PR3** (Rules-as-data + normalization) | `normalizeQuestion()` first (zero-risk), then `RULE_TOPICS` for the 3 topics (shadow-in-front of old `rulesFAQ` lines), then delete the now-dead old lines. **Include the streak-"best" fix here or immediately before this phase** (see §5 — no other phase owns it). | Second P0-shaped root-cause fix. Sequenced strictly *after* Phase 1 (not parallel) — both rewrite `routeQuestion()`'s early-dispatch region using live line numbers as anchors; landing serially avoids a silent clobber. |
| 4 | **D5 shape_test.mjs** (pulled forward) | 18-case shape matrix, run now as the acid test for D4's new multi-shape-concatenation rendering. | Same "verify immediately" principle as Phase 2. |
| 5 | **D1 Phase 3** (optional cleanup) | Collapse 3 duplicated pronoun regexes into the one canonical `ContextNeed` set; thread `ctxNeed`/`ctxTelemetry` into `RuleCtx`. | Land before D2 touches the same neighborhood (shared touched line: `index.ts:1896`). |
| 6 | **D2 Phase 0 → 8** (Structured Tool Results) | Foundation (`ToolResult`/`Scope`/`render()`, pure addition) then the 8 tools **one at a time**, in D2's documented risk order (`statLeaderboard` first, `latestRoast` last), each gated by the mandatory byte-identical golden-snapshot diff (not just `eval.mjs` — substring grading is proven insufficient) + full suite + deployed-vs-local diff. **Fold the streak-"best" fix into the `myRates` sub-phase if not already done in Phase 3.** Restrict golden inputs for time-sensitive tools to frozen/finished data to avoid tournament-clock drift false diffs. | The large enabling refactor, with no urgent bug of its own — follows the two root-cause fixes so its call-site edits land against an already-stabilized file. Re-sized to XL (or cap to 3-4 tools for a first pass) per critique. |
| 7 | **D5 sql_oracle_test.mjs + scope_matrix_test.mjs** (pulled forward) | Independent ground-truth checks on D2's migrated tools. | The one mechanism in the whole plan that checks against a truth source other than "matches previous (possibly already-wrong) output." |
| 8 | **D3 PR1** (V1 fix + shared recovery) | Delete the confidence/off_topic gate on the repeat-check; ship the shared depth-1-bounded isolated-reroute mechanism; **ship stub `checkShape`/`checkNumericProvenance`/`checkOnTopicEntity` (`return false`) in the SAME PR so `runChecks()` compiles** (critique correction — literal 4-PR split as originally written would not compile at PR1). `validation_fail` text→text[] migration (`migrations-dev`). Run the pre-deploy corpus scan for the false-positive class (two differently-worded questions sharing one correct answer) before shipping — same discipline D1 used. Explicitly restate CLI-only/DEV-only deploy here (D3's own text omits it). | Sequenced after D1 (fewer real repeats to trigger on) and after D4 (rendering stable before a repeat-detector compares answer strings). |
| 9 | **D5 Phase 1 telemetry** (trim per §5's scope-creep correction) | At minimum: fix `route` at the 7 omitted `done()` call sites (G-ROUTE-NULL-LOGGING). Add telemetry columns beyond that only as far as they're justified against a real gap (reconcile with D1's `ctxTelemetry` rather than duplicating it) — added to the **same** `finish()` closure D3 PR1 just touched, as an immediately-following diff, not in parallel. | Cheap, currently-orphaned P2 fix folded in here rather than lost; avoids adding 9 columns to justify a fix that's really 1 line. |
| 10 | **D3 PR2 (V5) + PR4 (V4 Tier A)** | Independent of each other and of D2 — run back-to-back. | No blocking dependency on anything above. |
| 11 | **D3 PR3 (V2 shape)** | `deriveShape()`/`checkShape()`. | Sequenced after D4 specifically so shape-checking is validated against D4's now-live multi-clause concatenated answers — avoids false-REJECTs on intentionally longer compound rule answers. |
| 12 | **STOP — re-scope before proceeding** | D3 PR5 (V4 Tier B): its "blocked on D2" dependency is **not actually true** against D2 as scoped (D2's 8 tools are all deterministic and already auto-pass Tier A; PR5 needs `rag_crew`/`llmUnderstand`-fallback facts, which D2 never touches). Resolve by extending D2's scope to those two, or re-budget PR5 as independent work with its own effort estimate, **before** scheduling it. | Critique-panel-identified false dependency — do not build this on the original "runs right after D2" assumption. |
| 13 | **D5 remaining suites** | `typo_noise_test.mjs`; full 8×7 `context_isolation_test.mjs` cross-product (ADVISORY, `--full`). | Lower marginal urgency, no blocking dependency. |
| 14 | **D5 Phase 8 — `fault_inject`** (last, most conservative) | Admin-gated new branch in the hot request-dispatch path. ADVISORY only. Needs a dedicated security/code review given it's the one new branch added to the live dispatch path. Default to the zero-code §6c manual runbook (swap the API key for 60s) unless the coded version proves worth the risk. | Deliberately last — highest-risk single change, smallest urgency. |

**Also not slotted above but must happen once, early:** every phase's deploy checklist includes
the `get_edge_function` deployed-vs-local diff-verify step (today only D2's text states this
explicitly — extend it to all phases per §5).

---

## 7. Explicitly deferred / NOT addressed by this plan (say so, don't overclaim)

- **V3** (typed entity-exists/anti-hallucination registry) and **V6** (generic public-tool auth
  binding via a `TOOL_IS_PUBLIC` map) — zero design coverage across D1-D5. A future D6 could
  likely reuse D3's `countNamedEntities()`/names-registry machinery for V3, and layer a small
  per-tool-id auth map on D2's `Scope` type for V6 — not designed here.
- **`ROUTE_RULES`'s general first-match-wins short-circuit ordering** — D4 only adds exclusions/
  topic gates *ahead of* it for 3 topics; the underlying "first rule wins, no second chance for a
  later shape-aware rule" architecture is untouched for every other rule in the table.
- **`ask_log` shadow-replay** (one of D5's own 8 named techniques) — never built as a script or
  process, only gestured at as a future manual habit once `source`/`session_id` telemetry exists.
- **A dedicated privacy/auth matrix** — folded into 1-2 rows of `scope_matrix_test.mjs`, much
  thinner than a real systematic matrix.
- **~33 of 41 tool functions** remain `Promise<string>`-only after D2's 8-function migration —
  no phase schedules a path to eventually convert the remainder.
- **A true platform-wide popularity tally** (G-NO-SCOPE-TYPE) — the `Scope` type supports it, no
  function produces it. Needs an explicit decision (build it, or formally accept the gap).
- **The remaining ~18+ un-`must()`-wrapped `data ?? []` call sites** (G-ERROR-SWALLOW) beyond the
  8 D2 happens to migrate — needs its own small, independent PR (mechanical, low-risk, not
  scheduled above; do it whenever convenient, ideally before Phase 6 since it's cheap and
  unblocks nothing else).

---

## 8. Deploy discipline (repeat for every phase, no exceptions)

- DEV project only: `ftryuvfdihmhlzvbpfeu`. **Never** PROD (`asugxlvgcmkxspzokydk`).
- Deploy via CLI only: `npx supabase functions deploy ask --project-ref ftryuvfdihmhlzvbpfeu`.
  **Never** the MCP `deploy_edge_function` tool (silently truncates this 150KB+ file — has broken
  this exact EF twice before). Never delegate the deploy step to a subagent.
- Type-check before every deploy: `npx deno@2 check --node-modules-dir=auto
  supabase/functions/ask/index.ts` (or the project's pinned equivalent) — compare error count to
  HEAD, not to zero, if a pre-existing baseline has unrelated errors.
- After every deploy: `get_edge_function` → diff against the local file. Trust the deployed
  source, not the repo file, per `memory/ef-repo-not-source-of-truth.md`.
- Run the full `node scripts/ask/eval.mjs` after every phase — never stop at `wide_test` alone.
- New migrations go in `supabase/migrations-dev/` (this table/feature is DEV-only), never
  `supabase/migrations/`.

---

## 9. Quick-start for the next session

1. Read this file in full, then §6 specifically — that's the executable sequence.
2. Start at Phase 0 (safety net) unless told otherwise.
3. If resuming mid-plan, check `memory/ask-bot-dev.md`'s live-state section for what's actually
   shipped vs still pending (this doc will be updated as phases land — don't trust this doc's own
   phase table once implementation has started without cross-checking memory/the live EF version).
4. If anything in §5/§6 seems to have been missed by whoever implements a phase, that's exactly
   what the critique panel was checking for — re-read §5 before marking a phase "done."
