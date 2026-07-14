# Ask Bot v29 — plan for a complete, reliable, independent bot

**Status:** proposed (2026-07-14). Supersedes "add another rule".
**Measured on:** DEV EF v48 (v28 rule table).
**Scores:** `wide_test` **99/99** · `real_chat_test` **11/17** · `audit_probe` **~60/82 (≈1 in 4 wrong)**.

---

## 1. Evidence

Three suites, deliberately different:

| Suite | What it is | Score on v48 |
|---|---|---|
| `wide_test.mjs` | 99 cases **I invented** | 99/99 ✅ |
| `real_chat_test.mjs` | 17 cases **a real user typed** | 11/17 ❌ |
| `audit_probe.mjs` | 82-question adversarial sweep of **every domain** | **~22 wrong** ❌ |

The first number is the trap: **a green synthetic suite hid a 1-in-4 failure rate.** All gates below
are measured on the real suites. `wide_test` is kept only as a no-regression net.

---

## 2. What the sweep actually found — and what it disproved

### ❌ DISPROVED: "typos are the problem"
All six typo probes **passed** (`wat is the nex game`, `hwo is the top scorrer`, `when is teh final`,
`how muhc points i hav`, `wich team scored most goals`, `argentna vs colombia score`). Fuzzy matching
already works. My earlier read of the `nexg` bug was wrong — see NON-DETERMINISM below.

### 🔴 CLASS 1 — THE BOT STATES FALSE FACTS (worst; fix first)

| Question | Answer | Truth |
|---|---|---|
| `how many red cards in the tournament?` | **"There have been 0 red cards"** | ≥12 (the bot itself lists 12 players with one each) |
| `is there a trivia question today?` | "it's currently **before** June 11" | today is **July 14** |
| `when is the next trivia question?` | "**June 11**" | that is 5 weeks in the past |
| `how many yellow cards did argentina get?` | "Argentina have played 2 games (1W 0D 0L)" | never answered |
| `what are the odds for the final?` | "couldn't find an **upcoming** game" | the Final is Jul 19, upcoming |
| `which team scored the most goals?` | "Bayern — 5.0 goals **per game**" | asked for a *total*, got an *average* |

Two distinct root causes:
- **`rag_crew` fabricates numbers.** "0 red cards" came from the RAG path. The v26 number-grounding
  check only guards *some* of it. **A stat path that can invent a number is worse than no path.**
- **The rules LLM has no clock.** Nothing injects "today" into `RULES_PROMPT`, so it reasons about
  June 11 as if it were the future. **Every date it utters is a guess.**

### 🔴 CLASS 2 — LOGIN GATE ON PUBLIC QUESTIONS

| Question (anon) | Answer |
|---|---|
| `how to play this game?` | *"Please sign in"* |
| `who can i pick as top scorer?` | *"Please sign in"* |
| `is group c finished?` | *"Please sign in"* |
| `thanks!` | *"Please sign in"* |

A misclassified intent inherits that intent's **auth gate**. So a stray classification doesn't just
give a wrong answer, it gives a *wall*. `thanks!` demanding a login is the clearest tell.

### 🟠 CLASS 3 — ANSWERS THE TOOL, NOT THE QUESTION (shape)

- `who finished 1 in group d?` → the whole table (asked for **one** name)
- `which group am i doing best in?` → lists both groups, picks neither
- `in which of my groups i have the best streak?` → a **global** rate, names no group
- `where i can see game stat?` → dumps my group standings (asked **where**)
- `where i see my points?` → gives points, never says where

### 🟠 CLASS 4 — WC GROUP vs FRIEND GROUP vs THE PRONOUN "I"

- `in how much group i can be?` → **World Cup Group I** (the "i" is a pronoun)
- `am i in group a?` → World Cup Group A table (asked about *my* membership)

### 🟠 CLASS 5 — ZERO COVERAGE (bot has nothing to read → it guesses)

`trivia_questions`, `trivia_answers`, `teams`, `top_scorer_candidates` have **no tool at all**.
Every trivia answer above is invention. This is why Class 1 exists: *the bot guesses when it is blind.*

### 🟡 CLASS 6 — NON-DETERMINISM: same question, two answers

`what is the nexg game?` returned the **red-card list** in the live log, and the **correct fixture**
on re-probe. Same input, different output. This is the user's "different answer to same question",
and it is a *stability* bug, not a parsing bug.

### 🟡 CLASS 7 — CONVERSATION / PRIVACY CONSISTENCY

- `why?` after an answer → off-topic brush-off instead of elaborating.
- `what is dani's champion pick?` → reveals his picks **labelled with `[Demo]`, `[Kanta Bayam]`** —
  groups the caller isn't in. Picks *are* public after the June-11 lock (by design), but we **refuse**
  the Demo leaderboard in the same breath. The pick is public; **the group-membership label may not
  be.** Needs a product decision, not a code fix.

---

## 3. Coverage map — "does everything have a reference?"

| Table | Tool? |
|---|---|
| games · predictions · team/player_tournament_stats · groups · group_members · profiles · game_team_stats · game_events · game_odds · champion_odds · knockout_pick · ai_summaries | ✅ |
| champion_pick · top_scorer_pick | ✅ (indirect, via leaderboard RPCs) |
| **trivia_questions · trivia_answers** | ❌ **none** |
| **teams** | ❌ **none** — so WC groups come from `games.group_name`, and club test rows leak into Group A |
| **top_scorer_candidates** | ❌ **none** |

---

## 4. Architecture

Keep what works: **deterministic SQL execution** and the **privacy boundary** (only question text +
the caller's own group/member names ever reach the LLM). Change what doesn't: *the bot must never
speak a fact it did not read.*

```
question
 ├─ 0 FAST PATH    v28 ROUTE_RULES — cheap, deterministic, and the outage net
 ├─ 1 UNDERSTAND   ONE structured LLM call -> typed spec {intent, entities, output_shape, slots}
 │                 (LLM is a PARSER, never an answerer). Privacy boundary unchanged.
 ├─ 2 RESOLVE      entities -> ONE typed ref against a registry:
 │                 wc_group(A-L) | friend_group(caller's) | team | player | phase | screen | topic
 │                 `teams` becomes source of truth. Pronoun "i" != Group I, structurally.
 ├─ 3 CLARIFY      missing slot / ambiguity -> ONE question, and STOP. Guessing is banned.
 ├─ 4 EXECUTE      deterministic SQL. Unchanged — correctness already lives here.
 └─ 5 SHAPE+CHECK  render to the ASKED shape, then VALIDATE before emitting (§5).
```

**Every LLM prompt gets a FACTS block** — today's date, the tournament phase, and any numbers it is
allowed to state. **The model may not utter a date or number outside that block.** That single rule
kills Class 1.

---

## 5. The validation layer (deterministic, free, runs on EVERY answer)

No LLM. Fails → clarify or refuse; **never emit**.

1. **Not-a-repeat** — byte-identical to the previous answer for a *different* question ⇒ always a bug.
2. **Shape** — `who/which` ⇒ names exactly one entity · `where` ⇒ names a screen · `how many X` ⇒
   gives a count **of X**.
3. **Entity-exists** — every team/player named must exist in the registry (no invented names).
4. **Number-traceable** — every number must come from the SQL result (generalize the v26 RAG check).
5. **On-topic-entity** — asked about Group D ⇒ the answer says Group D.
6. **No-gate-on-public** — a public intent may never return "please sign in".

> These are dumb, free guards — and they would have caught **Classes 2, 3, 6 and most of 1** *without
> any language understanding at all*. That is why validation ships **first**, before the rewrite.

---

## 6. Phases (optimized — ordered by truth-risk, not by elegance)

| Phase | Work | Gate |
|---|---|---|
| **P0 — STOP LYING** | Inject a FACTS block (incl. **today's date**) into every LLM prompt; ban un-grounded dates/numbers. Hard-ground or kill `rag_crew`. Fix `teamStat` ignoring the cards dim; fix "most goals" total-vs-average; fix odds-for-the-final. | Class 1 = 0 |
| **P0b — VALIDATION LAYER** | The 6 checks in §5, on every answer. Fail ⇒ clarify. | repeat/shape/gate bugs caught at runtime |
| **P1 — UN-GATE PUBLIC** | Auth gate binds to the **tool**, not the guessed intent. Public asks never demand login. Add a `courtesy` route (`thanks`, `ok`). | Class 2 = 0 |
| **P2 — COVERAGE** | `teams` registry; trivia tools (count, window, today, **my score**); top-scorer-candidates tool. | Class 5 = 0 |
| **P3 — SHAPE** | Output-shape renderer (one \| list \| count \| table) driven by the question. | Class 3 = 0 |
| **P4 — ENTITY TYPING** | wc_group vs friend_group vs pronoun as **types**, not regex luck. | Class 4 = 0 |
| **P5 — UNDERSTAND-FIRST** | LLM-as-parser promoted to primary router; rules become fast path + outage net. | real-chat 17/17 |
| **P6 — DETERMINISM** | Same question ⇒ same answer. Pin temperature/seed; make borrowing explicit and bounded. | Class 6 = 0 |
| **P7 — EVAL GATE** | One command runs all three suites; **deploy blocked on regression**. | green required to ship |
| **P8 — LEARNING LOOP** | Mine `ask_log` weekly: correct routes ⇒ new embedding examples; wrong ⇒ new eval cases. 👍/👎 in the AskBot UI. **Curated, never auto-fed** (auto-feeding teaches the bot its own mistakes). | suite grows every week |

**Definition of done:** `audit_probe` ≥ 80/82 · `real_chat_test` 17/17 · `wide_test` 99/99 ·
every answer carries a `route` · **zero un-grounded numbers or dates.**

---

## 7. Open product decisions (not mine to make)

1. **Group-label leak**: post-lock picks are public by design — but should the answer name the
   *group* (`[Demo]`) of a user whose group you're not in?
2. **DEV club data** stays ([[dev-data-scope-decision]]); P2's `teams` registry makes the bot robust
   to it rather than "fixing" the data.
3. **PROD cutover**: after the tournament.

## 8. Not doing

- Not deleting the v28 rule table (fast path + outage net; the only reason routing is testable).
- Not sending data to the LLM — the privacy boundary never moves.
- Not caching answers (`qa_cache` was removed in v26 as poisonable; caching is not learning).
