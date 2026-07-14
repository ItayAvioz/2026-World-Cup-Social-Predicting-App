# Ask Bot v29 — implementation-ready plan

**Target:** a functional, independent, reliable, high-quality bot.
**Measured on** DEV EF v48 (v28 rule table), 2026-07-14:

| Suite | What it is | Score |
|---|---|---|
| `wide_test.mjs` | 99 cases **I invented** | 99/99 ✅ |
| `real_chat_test.mjs` | 17 cases **a real user typed** | **11/17** ❌ |
| `audit_probe.mjs` | 82-question adversarial sweep, every domain | **~60/82 (1 in 4 wrong)** ❌ |

**The green synthetic suite hid a 25% failure rate.** All gates below measure on the real suites;
`wide_test` is demoted to a no-regression net.

**Core principle (never violated):** **SQL computes. The LLM parses and phrases. The LLM never counts,
never invents a number, never sees private data.**

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

| # | Phase | Touches | Gate |
|---|---|---|---|
| **1** | **V0 outbound guard** — single choke point for all 4 LLM calls; throws on private-shaped payload | ~30 lines, no routing | CI test: prediction in payload ⇒ throws |
| **2** | **FACTS block + V4** — today's date in every prompt; numbers rendered from rows; aggregates → SQL; **kill RAG's licence to count** | `answerCrew`, `RULES_PROMPT` | zero un-grounded numbers/dates in `audit_probe` |
| **3** | **S1 courtesy + S7 authorize + V6** — auth binds to the tool | new stage + a map | `thanks!`, `how to play`, `who can i pick` all answer without login |
| **4** | **S8 coverage** — trivia tools (count/window/today/**my score**), `teams` registry, top-scorer candidates | new tools | trivia probes all correct |
| **5** | **V1 + V2 + V5 + S9 shape renderer** | render + validate | shape/repeat classes = 0 |
| **6** | **S5 typed registry** — wc_group vs friend_group vs pronoun | resolver | `in how much group i can be?` → "3 groups" |
| **7** | **S4 understand-first + S6 clarify** — LLM as parser; S3 demoted to fast path + outage net | router | `real_chat_test` 17/17 |
| **8** | **eval.mjs gate** — 3 suites, one exit code; **deploy blocked on regression** | script | nothing regresses silently |
| **9** | **Telemetry + learning loop** — `ask_log`: `validation_fail`, `expected_shape`, `rows_count`. Weekly: correct routes → new embedding examples; failures → new eval cases; 👍/👎 in the UI. **Curated, never auto-fed.** | migration + UI | suite grows weekly |

**Phases 1–3 stop the bot being confidently wrong and touch no routing.** They can ship this week.

### Definition of done
`audit_probe ≥ 80/82` · `real_chat_test 17/17` · `wide_test 99/99` · every answer carries a `route`
· **zero un-grounded numbers or dates** · V0 green in CI.

---

# PART 3 — DECISIONS & NON-GOALS

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
