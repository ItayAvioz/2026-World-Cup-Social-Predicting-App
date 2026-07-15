# Ask Bot v29 — implementation-ready plan

**Target:** a functional, independent, reliable, high-quality bot.

## STATUS (2026-07-15): Phases 1-4 SHIPPED (v29). Deep-audit fixes SHIPPED (v30). Phases 5-9 NOT started.

**Live: DEV EF v57.** `node scripts/ask/eval.mjs` → wide_test **110/110**, real_chat_test **22/22**
(v29 shipped 99/99 + 17/17; v30 added 11 + 5 regression cases for 6 newly-confirmed bugs, all
green, zero regressions). What actually shipped is phases 1-4 from **PART 2**'s build-order table
plus the v30 deep-audit fixes in **PART 3** — **not** the general S4/S5/S7/S9 architecture in
**PART 1**. See PART 2's per-phase status column for exactly what's done vs still to build,
**PART 3** for real before/after examples (both v29 and v30), and `memory/ask-bot-dev.md` for the
live changelog.

**v30 (2026-07-15) — a second audit pass, triggered by the human user still finding real bugs
after v29 shipped.** A workflow (multi-agent, live-reproduce + verify) ran the 6 newly-reported
failures plus a 5-dimension adversarial sweep, but hit the account's monthly spend limit partway
through (5/6 named bugs done + verified; the sweep never ran). The remaining critical item plus a
personal sweep were completed directly (no subagents) — which itself surfaced 3 MORE confirmed
bugs beyond the 6 named, including a previously-unknown **direction/polarity** bug (see PART 3).
6 fixes shipped; 1 investigated and found NOT to have the hypothesized backend mechanism (see
PART 3 "Still open" — reported honestly rather than shipping a fix that wouldn't have mattered).

Baseline this plan was written against — DEV EF v48 (v28 rule table), 2026-07-14:

| Suite | What it is | Score then (v48) | v29 (v53) | v30 (v57) |
|---|---|---|---|---|
| `wide_test.mjs` | cases **I invented** | 99/99 ✅ | 99/99 ✅ | 110/110 ✅ |
| `real_chat_test.mjs` | cases **a real user typed** | **11/17** ❌ | **17/17** ✅ | **22/22** ✅ |
| `audit_probe.mjs` | 82-question adversarial sweep, every domain | **~60/82 (1 in 4 wrong)** ❌ | not re-scored (exploratory, not graded) | not re-scored (the v30 workflow's own sweep is the closest re-run, but it never completed — see STATUS above) |

**The green synthetic suite hid a 25% failure rate — twice, at two different maturity levels.**
All gates below measure on the real suites; `wide_test` is demoted to a no-regression net.

**Core principle (never violated):** **SQL computes. The LLM parses and phrases. The LLM never counts,
never invents a number, never sees private data.**

---

# PART 0 — NOTHING IS THROWN AWAY

v29 is **not a rewrite**. It is the *same* components, re-sequenced. Every existing stage survives;
one stage loses a privilege it should never have had. Map it component by component:

| Today (EF v48) | Where it lives in v29 | Status |
|---|---|---|
| **Embeddings** (`embed()`, 1536-d, `text-embedding-3-small`) | still the substrate for intent-match, dim-match and RAG retrieval | ✅ **KEPT, unchanged** |
| **Intent classifier** (`match_intent`, `intent_examples`, 127 rows) | inside **S3 fast path** — and the whole of degraded mode when the LLM is down | ✅ **KEPT** |
| **Dim classifier** (`match_dim`, `dim_examples`, 10 dims / 48 rows, `reindex_dims`) | feeds `Spec.metric` + `Spec.agg` at **S3/S4**. Still the thing that knows "clean sheets" → `conceded` | ✅ **KEPT, unchanged** |
| **Entity extraction** (aliases + typo/Levenshtein match) | becomes **S5**, now emitting *typed* refs instead of bare strings. **The fuzzy matcher itself is untouched — all 6 typo probes PASS today** | ⬆️ **UPGRADED** |
| **op / agg detection** (keyword) | folded into the `Spec` at S3/S4 | ✅ **KEPT** |
| **`llmUnderstand`** (today: a *fallback* at stage 9) | **promoted to S4**, same function, earlier position | ⬆️ **PROMOTED** |
| **Override rules** (v28 `ROUTE_RULES`) | **S3 fast path** + outage net | ✅ **KEPT** |
| **Tool registry** (deterministic SQL tools) | **S8** | ✅ **KEPT, untouched** |
| **Rules FAQ** (`rulesFAQ`) | **S8** | ✅ **KEPT** |
| **Rules LLM** (`RULES_PROMPT`) | **S8/S9** — now gets a **FACTS block with today's date** | ⬆️ **GROUNDED** |
| **RAG retrieval** (`kb_embeddings`, `match_kb`, 1,606 stat cards) | **S8** — retrieval is unchanged; it still fetches the right cards | ✅ **KEPT** |
| **RAG writer** (`answerCrew`) | **S9** — may still *phrase* an answer from the cards… | ⚠️ **KEPT, but** |
| ↳ *its licence to state **numbers*** | — | ❌ **REVOKED** (see below) |
| ↳ *its fake grounding check* (`factNums.has(n)`) | replaced by **V4** | ❌ **DELETED** |
| **Intent-inherited auth gate** | replaced by **S7** (tool-bound) | ❌ **DELETED** |

**NEW, and only these five:** S1 courtesy · S5 *typing* (the resolver existed; the type system didn't)
· S6 clarify gate · S7 tool-bound auth · **S10 validation** (nothing checks the answer today).

## The one real removal

`answerCrew` (RAG) may keep writing prose. It may **no longer speak a number**. Numbers are rendered
from `rows`; the model gets placeholders (`{{n1}}`) and writes around them.

**Why:** RAG is retrieval over *stat cards*. It is a good tool for *"how is Argentina's defense?"* and
a terrible tool for *"how many red cards in the tournament?"* — that is a `COUNT(*)`, not a
similarity search. Asking RAG to aggregate is what produced **"there have been 0 red cards"** (truth:
≥12). So: **RAG describes. SQL counts.** Aggregate questions route to SQL and never reach the crew.

---

# PART 1 — THE PIPELINE: question → answer

Eleven stages. Each has a typed contract, a failure action, and a telemetry field.
Stages marked **NEW** don't exist today.

```
                      ┌──────────────────────────────────────────────┐
  POST /ask           │  { question, history[], last_answer,         │
  (anon or JWT)       │    prev_spec, group_id? }                    │
                      └──────────────────────────────────────────────┘
                                        │
  S0  PRE-GUARD ─────────────────────── ▼ ── reject: injection / abuse / rate-limit / empty
  S1  COURTESY (NEW) ────────────────── ▼ ── "thanks", "ok" → reply, NO data path, NO auth gate
  S2  SPLIT COMPOUND ────────────────── ▼ ── "X and Y?" → two clauses, each runs S3..S10
  S3  FAST PATH (v28 ROUTE_RULES) ───── ▼ ── high-confidence deterministic hit → S7
  S4  UNDERSTAND (NEW: LLM = parser) ── ▼ ── question text → typed Spec. NEVER answers.
  S5  RESOLVE (NEW: typed registry) ─── ▼ ── each mention → exactly ONE typed entity ref
  S6  CLARIFY GATE (NEW) ───────────── ▼ ── missing slot / ambiguity → ONE question, STOP
  S7  AUTHORIZE (NEW) ───────────────── ▼ ── gate binds to the TOOL, not the guessed intent
  S8  EXECUTE (SQL) ────────────────── ▼ ── deterministic tool → rows[]   ← the only source of truth
  S9  RENDER (shape-aware) ─────────── ▼ ── rows + question shape → answer. Numbers ONLY from rows.
  S10 VALIDATE (NEW) ───────────────── ▼ ── 6 checks. FAIL → clarify/refuse. NEVER emit.
                                        │
                      ┌─────────────────▼────────────────────────────┐
                      │  { answer, spec, route, checks[] } → ask_log │
                      └──────────────────────────────────────────────┘
```

## Shared types

```ts
type EntityRef =
  | { type: 'wc_group';     value: 'A'|'B'|…|'L' }
  | { type: 'friend_group'; id: string; name: string }     // caller's OWN groups only
  | { type: 'team';         name: string }                 // must exist in `teams`
  | { type: 'player';       apiId: number; name: string }
  | { type: 'member';       id: string; username: string } // caller's groupmates only
  | { type: 'phase';        value: 'group'|'r32'|'r16'|'qf'|'sf'|'third'|'final' }
  | { type: 'screen';       value: 'Dashboard'|'Groups'|'Picks'|'AI'|'Trivia'|'Game' }
  | { type: 'date';         iso: string }

type Shape = 'one' | 'list' | 'count' | 'table' | 'yesno' | 'when' | 'where' | 'howto'

type Spec = {
  intent: string
  entities: EntityRef[]
  shape: Shape                 // what the QUESTION asks for — drives S9 and V2
  metric?: string              // goals | assists | cards | ...
  agg?: 'none'|'sum'|'avg'|'max'
  slots: { required: string[]; missing: string[] }
  ambiguity: { mention: string; candidates: EntityRef[] }[]
  confidence: number
  source: 'fast_path' | 'llm' | 'degraded'
}

type ToolResult = { rows: unknown[]; facts: Record<string, string|number> }
```

---

## S0 — PRE-GUARD  *(exists)*
**In:** raw request · **Out:** pass | refusal
Injection patterns, rate limit (per user + IP), empty/oversized input.
**No change.**

## S1 — COURTESY  **(NEW)**
**Why:** today `thanks!` returns *"Please sign in"* — a courtesy word hits a data path and its auth gate.
```ts
const COURTESY = /^\s*(thanks?|thank you|ok(ay)?|cool|nice|got it|great|👍|bye)\s*[!.]*\s*$/i
```
**Out:** a one-line reply. **Never** touches data, auth, or the LLM. Route `courtesy`.

## S2 — SPLIT COMPOUND  *(exists)*
"what was the last game and what did we predict?" → 2 clauses. Clause 2 inherits clause 1's resolved
`Spec` (not its text). **No change**, except: clause 2 may never overwrite clause 1's answer.

## S3 — FAST PATH  *(exists: v28 `ROUTE_RULES`)*
The ordered rule table. Keeps two jobs:
1. **Cheap path** for unambiguous asks (no LLM call).
2. **Outage net** — if S4's LLM call fails, S3's verdict is used alone (today's degraded mode).

**Change:** a rule may only fire at **high confidence**. Rules that currently over-match
(`/\bgroup ([a-l])\b/` matching the pronoun "i") must require a *typed* resolution from S5 —
i.e. they hand off, they don't decide.

## S4 — UNDERSTAND  **(NEW — the LLM is a PARSER)**
**In:** question text + caller's own group names + groupmate usernames (nothing else, ever)
**Out:** `Spec` (JSON, schema-forced)
**The model returns a spec. It never returns an answer.**

Knows what regex cannot: `group i` (pronoun) ≠ Group I · `where i can see` = how-to ·
`which of my groups` = shape `one`, entity type `friend_group`.

```ts
// temperature 0, seed fixed, response_format json_schema → same question ⇒ same spec (fixes Class 6)
```
**Failure:** LLM down → `source: 'degraded'`, fall back to S3's verdict. **Never blocks.**

## S5 — RESOLVE  **(NEW — typed entity registry)**
**In:** `Spec.entities` (raw mentions) · **Out:** `EntityRef[]` | ambiguity
Sources: **`teams`** (48 WC teams — *currently never read*), `player_tournament_stats`,
caller's `groups`/`group_members`, static screens/phases.

Rules:
- `wc_group` and `friend_group` are **different types** — never interchangeable.
- A bare letter resolves to `wc_group` **only** if the sentence has a group-table cue AND no
  first-person cue. Otherwise → ambiguity or drop.
- A team name must exist in `teams`, else → `unknown_team`.
- **This is where the pronoun bug dies structurally**, not by regex luck.

## S6 — CLARIFY GATE  **(NEW)**
```
if (spec.slots.missing.length || spec.ambiguity.length) → ONE targeted question, STOP.
```
> *"Do you mean World Cup Group A, or your friend group?"*

**Guessing is banned.** A confident wrong answer costs more than a question. Max **one** clarify per
turn; if the user's reply still doesn't resolve, answer the most likely reading and say so.

## S7 — AUTHORIZE  **(NEW)**
```ts
const TOOL_AUTH: Record<string, 'public'|'user'> = { schedule: 'public', myStats: 'user', … }
```
The gate binds to the **tool**, not the guessed intent. Today a misclassification *inherits that
intent's auth gate* — which is why `how to play this game?` and `who can i pick as top scorer?`
demand a login. A public tool may **never** emit "please sign in" (enforced by V6).

## S8 — EXECUTE  *(exists — unchanged)*
Deterministic SQL tools → `ToolResult { rows, facts }`.
**This is the only source of truth.** Correctness already lives here; do not touch it.

**Coverage gaps to close (P2):** `trivia_questions`, `trivia_answers`, `teams`,
`top_scorer_candidates` have **no tool at all** — which is *why* the bot invents trivia answers.
**The bot guesses exactly where it is blind.**

## S9 — RENDER  *(shape-aware; today it dumps the tool's default payload)*
**In:** `rows` + `Spec.shape` · **Out:** answer string

| Shape | Render |
|---|---|
| `one` | exactly one entity ("**United States** finished 1st in Group D") |
| `count` | the number, **labelled with the asked noun** |
| `list` | ≤5 items |
| `table` | full table (only when explicitly asked) |
| `yesno` | verdict first, then evidence |
| `where` | a screen name |

**The LLM may be used to phrase, with placeholders only:**
`"{{team}} finished 1st with {{pts}} points"` → substituted from `rows`.
**If the model emits a bare digit, the answer is rejected.** (See V4.)

## S10 — VALIDATE  **(NEW — deterministic, free, on EVERY answer)**

| # | Check | Catches |
|---|---|---|
| **V0** | **Outbound guard** (runs at S4/S9, pre-send): payload matches nothing private-shaped. **Throws** — never silently strips. | privacy regressions |
| **V1** | **Not-a-repeat**: byte-identical to `last_answer` for a *different* question ⇒ always a bug | "different answer to same question" |
| **V2** | **Shape**: `who/which`→1 entity · `where`→a screen · `how many X`→a number **whose noun is X** | *"how many yellow cards?" → "played 2 games"* |
| **V3** | **Entity-exists**: every name in the answer is in the registry | invented players |
| **V4** | **Number-traceable**: every number came from `rows` | **"0 red cards"** |
| **V5** | **On-topic**: the asked entity appears in the answer | Group D asked, Group D answered |
| **V6** | **No-gate-on-public**: a public tool never says "sign in" | `thanks!` demanding a login |

**FAIL ⇒ clarify or refuse. NEVER emit.** Every failure lands in `ask_log.validation_fail`.

### V4 in detail — why the current check is fake
```js
// TODAY (index.ts L1074) — this is a token-membership test, NOT a fact check:
const factNums = new Set(facts.match(/\d+/g))
const ok = text.match(/\d+/g).every(n => factNums.has(n))
```
Every player card contains `0 yellow, 0 red`, so **`0` is always in the set**. The model says
*"there have been 0 red cards"* (truth: ≥12), the check finds a stray `0`, and waves it through.
It cannot tell **which** number answers **which** question.

**Replacement:** numbers are **rendered from `rows`**, never spoken by the model. And
*"how many red cards in the tournament?"* was never a RAG question — **it is a `COUNT(*)`.**
Delete the RAG path's licence to answer aggregates.

### The FACTS block — kill the date hallucination
`RULES_PROMPT` has **no clock**. On 2026-07-14 the bot said trivia *"starts June 11 — it's currently
before that date"*. **Every date it utters today is a guess.** Prepend to every chat call:
```
FACTS (authoritative — you may not state a date or number that is not here):
  today: 2026-07-14 (Israel) · phase: Semi-Finals
  next game: Netherlands vs Portugal, Jul 14 19:00 UTC
  trivia: 40 questions, Jun 11–Jul 20, 22:00 Israel, 40s, 1pt each
  <+ rows for this question>
```
Rule: **"If a date or number is not in FACTS, say you don't know."** Enforced by V4, not trusted.

---

# PART 2 — BUILD ORDER

Ordered by **truth-risk**, not elegance. A bot that routes perfectly and still says *"0 red cards"*
is worse than one that routes badly and admits it doesn't know.

| # | Phase | Touches | Gate | Status (2026-07-15) |
|---|---|---|---|---|
| **1** | **V0 outbound guard** — single choke point for all 4 LLM calls; throws on private-shaped payload | ~30 lines, no routing | private token in payload ⇒ throws | ✅ **SHIPPED** — `assertPublicPayload`, all 4 sites |
| **2** | **FACTS block + V4** — today's date in every prompt; numbers rendered from rows; aggregates → SQL; **kill RAG's licence to count** | `answerCrew`, `RULES_PROMPT` | zero un-grounded numbers/dates in `audit_probe` | ✅ **SHIPPED** — `factsBlock()`; `cardsTotal`/`triviaInfo('count')` route to SQL, never RAG; per-card substring check replaces the token-membership one. "0 red cards" → "13 red cards" confirmed live |
| **3** | **S1 courtesy + S7 authorize + V6** — auth binds to the tool | new stage + a map | `thanks!`, `how to play`, `who can i pick` all answer without login | ⚠️ **PARTIAL** — courtesy route ✅ shipped; the 3 example questions ✅ all fixed and confirmed live; but via *targeted regex fixes* (broadened `howto_is_rules`, new `top_scorer_candidates` rule), not the general tool-bound auth map S7 describes. A future misroute into a private tool can still demand a login |
| **4** | **S8 coverage** — trivia tools (count/window/today/**my score**), `teams` registry, top-scorer candidates | new tools | trivia probes all correct | ✅ **SHIPPED** — `triviaInfo`/`myTriviaScore`/`topScorerCandidates`; `tournamentGroupTable` also re-sourced from `teams.group_name` (not full S5, but the concrete data-cleanliness win) |
| **5** | **V1 + V2 + V5 + S9 shape renderer** | render + validate | shape/repeat classes = 0 | ⚠️ **PARTIAL** — V1 (repeat guard) ✅ fully shipped, logs to `ask_log.validation_fail`. V2/V5/S9 NOT a general renderer — only the two reported cases got targeted fixes: `tournamentGroupTable(..., 'first'\|'last')` and `myBestGroup`. A new "answered the tool, not the question" bug in an untouched area is not caught |
| **6** | **S5 typed registry** — wc_group vs friend_group vs pronoun | resolver | `in how much group i can be?` → "3 groups" | ⚠️ **GATE MET, MECHANISM DIFFERENT** — the example question now correctly answers "3 groups" (confirmed live), but via an *asymmetric regex* (letter 'i' requires a strong cue, other letters get a broader one) rather than a typed entity resolver. Cheaper, narrower, and still fundamentally guessing from strings — the next pronoun-shaped collision (if letter 'i' ever needs a broad cue too) will need its own patch |
| **7** | **S4 understand-first + S6 clarify** — LLM as parser; S3 demoted to fast path + outage net | router | `real_chat_test` 17/17 | ❌ **NOT STARTED** — `real_chat_test` reached 17/17 through targeted fixes to individual rules (phases 3/4/5/6 above), not by promoting the LLM to a primary parser. The routing architecture is still v28's `ROUTE_RULES` chain, unchanged in structure |
| **8** | **eval.mjs gate** — 3 suites, one exit code; **deploy blocked on regression** | script | nothing regresses silently | ✅ **SHIPPED** (2 of 3) — `scripts/ask/eval.mjs` runs wide_test + real_chat_test, one exit code. `audit_probe` deliberately left exploratory/ungraded, per its own docstring — not yet a blocking gate |
| **9** | **Telemetry + learning loop** — `ask_log`: `validation_fail`, `expected_shape`, `rows_count`. Weekly: correct routes → new embedding examples; failures → new eval cases; 👍/👎 in the UI. **Curated, never auto-fed.** | migration + UI | suite grows weekly | ⚠️ **PARTIAL** — migration `20260714000001_ask_log_validation_telemetry.sql` ✅ shipped, columns exist; only `validation_fail` is actually populated (by V1). No weekly mining process, no 👍/👎 UI — both still manual/未built |

**What "phases 1-4 shipped" actually means:** every phase above that touches routing did so through
**scoped, targeted fixes to the reported failures** — not the general mechanisms (typed registry,
tool-bound auth map, shape renderer, LLM-as-parser) that PART 1's pipeline describes. The gates were
met; the *general* infrastructure that would make the NEXT similar bug cheap to fix was not built.
That is phases 5-9's remaining job, and PART 3 below has the concrete before/after evidence.

### Definition of done (original) vs. actual (2026-07-15)
Original: `audit_probe ≥ 80/82` · `real_chat_test 17/17` · `wide_test 99/99` · every answer carries
a `route` · zero un-grounded numbers/dates · V0 green in CI.
**Actual:** `real_chat_test` **17/17** ✅ · `wide_test` **99/99** ✅ · every answer already carried a
`route` since v28 ✅ · V0 shipped but has no CI (no test runner in this repo — verified manually:
feeding it a payload containing `points_earned` throws) ⚠️ · `audit_probe` not re-scored to a number
(exploratory) — see PART 3 for the specific before/after answers that were re-verified live.

---

# PART 3 — REAL EXAMPLES: BEFORE (EF v48) → AFTER (EF v53)

All verified live against the deployed DEV function, not just in test assertions.

| Question | v48 (before) | v53 (after) |
|---|---|---|
| `how many red cards in the tournament?` | *"There have been 0 red cards"* (truth: 13) | *"There have been 13 red cards in the tournament so far."* |
| `is there a trivia question today?` | *"it's currently before June 11"* (today was Jul 14) | *"Yes — today's trivia question is open now, until Jul 15, 19:00 UTC (22:00 Israel)."* |
| `thanks!` | *"Please sign in — I can only look up your personal data..."* | *"You're welcome! Ask me anything else about the tournament or the app."* |
| `how to play this game?` | *"Please sign in..."* | a full grounded how-to-play answer, no login required |
| `who can i pick as top scorer?` | *"Please sign in..."* | *"You can pick any player from the full tournament squads... Search by name or team in the Picks tab."* |
| `in how much group i can be?` | dumps the **World Cup Group I** standings table | *"You can be in up to 3 groups (created + joined combined)."* |
| `is group c finished?` | *"Please sign in..."* | correctly shows the (clean, 4-team) Group C table |
| `who finished 1 in group a?` | a **57-row** table (DEV club test games polluting `games.group_name='A'`) | a clean **4-row** table (sourced from `teams.group_name`) |
| `in which of my groups i have the best streak?` | a combined rate, naming no group | *"You're doing best in Alpha Wolves: Exact 67% (2/3)..."* |
| `which group am i doing best in?` | dumped both groups' full stats | *"You're doing best in Alpha Wolves: #1 of 1 (global #40)."* |
| `where i can see game stat?` | dumped the caller's group standings | *"You can see game stats by tapping on any game in the Match Page..."* |
| `what is the nexg game?` (after an unrelated red-cards question) | replayed the **previous answer** (a red-card list) verbatim | correctly answers with the actual next fixture |

**Still open (confirmed, not fixed this pass — honest gaps):**
- `which team scored the most goals?` → answers a per-game **average**, labelled as such ("5.0 goals per game"). Defensible (truthful, labelled) but may not match user intent for a "total" question — deferred, not a lie.
- `how many yellow cards did argentina get?` → still answers with games played, not cards. `teamStat`'s dim-resolution for a team-scoped card count is a separate, deeper bug than the tournament-wide aggregate this pass fixed — not touched.
- `why?` (conversational elaboration after an answer) → still the generic off-topic brush-off.

## v30 — BEFORE (EF v53) → AFTER (EF v57), 2026-07-15

Triggered by the human user still finding real bugs after v29 shipped. A workflow audit
live-reproduced and root-caused 5 of 6 newly-reported bugs before hitting the account's monthly
spend limit; the 6th (repeat-bleed) and a personal sweep were completed directly, surfacing 3 more
confirmed bugs. All 6 below verified live against the deployed DEV function, not just assertions.

| Question | v53 (before) | v57 (after) |
|---|---|---|
| `which game had the most red cards?` | *"12 players are tied for player with the most red cards..."* (a PLAYER list for a GAME question) | *"2 games are tied for the most red cards (2 each): Fulham 0-1 Bournemouth, Oviedo 0-0 Getafe."* — generalized to goals/yellow/corners too |
| `which team conceded the most goals?` | *"...have the best defense, conceding 0.0 goals per game."* (answered the OPPOSITE pole) | *"FC Köln has conceded the most goals, 5.0 per game."* |
| `which team has the least possession?` | *"...has the most possession, 75.0% per game."* | *"Blooming has the least possession, 26.0% per game."* |
| `which team is the most chosen for champion? and how much?` | dumped the CALLER's own single pick per group | a real tally: e.g. *"Alpha Wolves: Brazil is the top pick, 3 of 8 members (37%)."* / *"no standout — every pick is different"* when true |
| `what is my best positive streak in Alpha Wolves?` | *"🧊 Cold streak: 1 scored game without points."* (answered the CURRENT trailing streak regardless of direction asked) | *"🔥 Best hot streak: 2 scored games in a row with points."* |
| `each question open to how much time?` (trivia) | *"Each trivia question is open for 40 seconds."* (only the answer countdown, never the 24h window) | *"Each day's trivia question opens at 22:00 Israel and stays open for 24 hours... Once you open it, you only get 40 seconds..."* |
| `how much games were penalties score in regular time, 90 min?` | shootout data (*"No World Cup games have gone to penalties yet. Friendlies that did: ...Penalties: 4-3..."*) | *"14 World Cup games have had a penalty kick in regular time (90 min, not a shootout): ..."* with per-game scored/missed counts |

**Still open (v30 — investigated, not fixed, reported honestly):**
- **Repeat-bleed mechanism** — the human session showed an unrelated question ("explain on the
  bracked competition") get back a stale answer from 2 turns earlier, tagged as a deterministic
  (non-LLM) match. The originally-hypothesized backend mechanism (a prior turn's `op`/`dim`
  leaking through the entity-borrow logic and hijacking `stat_leaderboard`) was **disproven by
  code reading**: the dim-borrow only fires when the freshly-detected `op==='lookup'`, which is
  mutually exclusive with `stat_leaderboard`'s `op==='rank'` requirement — that path cannot
  actually produce the observed repeat. Direct live reproduction (feeding the EF the exact correct
  prior turn, and separately the red-cards turn) both produced correct, non-repeated answers,
  meaning the EF behaves correctly given accurate inputs. Best remaining suspect: a frontend state
  bug in `AskBot.jsx` — `lastBot` (line 44) was hardened defensively (dropped a `.spec`-presence
  filter that could skip the true last bot reply and send stale `last_answer`/`prev_spec` for the
  NEXT turn), and this fix is committed, but it was not proven to be the exact trigger (would need
  live browser/DevTools reproduction, not available from this CLI-only harness). **No backend
  "fix" was shipped claiming to solve this** — shipping one would have been cosmetic.
- **Polarity fix (family B) only verified on 3 of 8 team-level dims** (defense/possession/fouls,
  the ones with live-confirmed bugs). The mechanism is generic (`detectPolarity` + per-dim
  `fmtInv`) and was added to all 8 team dims (attack/corners/teamYellow/offsidesT/shotsT included),
  but "least attack"/"fewest offsides"/etc. were not individually live-tested — should hold given
  the shared mechanism, not empirically confirmed one-by-one.
- **The 2 broad-sweep dimensions that never ran** (workflow spend limit): repeat/context-bleed
  beyond the one named case, and a systematic rules-text-vs-live-DB fact audit (only 3 facts
  spot-checked: group cap, pick deadline, games-remaining count — all correct, not exhaustive).

---

# PART 4 — DECISIONS & NON-GOALS

## The public/private line — DECIDED 2026-07-14 (do not re-open)

**PUBLIC — the bot may answer for ANY user, including group labels:**
champion pick · top scorer pick · group names · global leaderboard rank & points ·
all tournament data (fixtures, scores, scorers, team/player stats, odds, bracket status).

So `what is dani's champion pick?` → *"[Demo] champion Netherlands · [Kanta Bayam] champion Spain"*
is **correct, not a leak.** Picks are public after the `2026-06-11T19:00:00Z` lock by design, the
global leaderboard is public by design, and the group label rides along with them.

**PRIVATE — refuse, always:**
- **predictions before that game's kickoff** (any user, including yourself in another group)
- **any group the caller is not a member of** — its leaderboard, its members, its predictions

The distinction is *not* "whose data is it" but **"is this field already public in the app UI?"**
If a logged-out user can see it on a screen, the bot may say it.

**Not doing:**
- **Not** sending all data to the LLM. It breaks the privacy promise, doesn't fit (5,623 predictions
  + 3,395 player rows), and — decisively — **moves counting to the one component that can't count**.
  "0 red cards" is an aggregation failure; more JSON makes it worse, not better.
- **Not** deleting the v28 rule table (fast path + outage net; the reason routing is testable).
- **Not** caching answers (`qa_cache` was poisonable; a cache is not learning).
- **Not** touching PROD until after the tournament. See [[dev-data-scope-decision]] for DEV data.
