# Ask Bot — Validation & Evaluation: implementation spec

Implementation-ready detail for **P0 / P0b / P7** of [PLAN_ASK_BOT_V29.md](./PLAN_ASK_BOT_V29.md).
Everything here is **deterministic** — no LLM, no extra cost, no extra latency worth measuring.

---

## 0. What goes to the LLM today (audited 2026-07-14, DEV EF v48)

Four call sites. **Only one ever receives data.**

| Site | Payload | Private data? |
|---|---|---|
| `llmUnderstand` (L804) | question + caller's OWN group names + groupmate usernames | names only |
| `answerCrew` (L1068) | question + `kb_embeddings` cards | **public stats only** |
| rules LLM (L1539) | question + static `RULES_PROMPT` | no |
| off-topic (L1572) | question | no |
| `embed()` | question text | no |

`kb_embeddings` = 1,542 player cards + 64 team cards, all public
(`PLAYER X (Team) — N goals, N assists in N games. N yellow, N red.`).
**No predictions / picks / points / ranks / other users.** The boundary holds — **but it is held by
convention, not enforced.** Nothing stops a future tool from passing a prediction into `answerCrew`.

### V0 — OUTBOUND PAYLOAD GUARD (new, P0)

Single choke point. Every LLM call goes through it; a direct `openai.*` call becomes a lint error.

```ts
const PRIVATE_KEYS = /\b(prediction|predicted|pred_home|pred_away|points_earned|champion_pick|
                       top_scorer_pick|knockout_pick|rank|leaderboard|exact_scores|user_id|email)\b/i

function llmSend(purpose: 'understand'|'rag'|'rules'|'offtopic', payload: string): string {
  // 1. purpose must be one of the four known call sites
  // 2. payload must not match PRIVATE_KEYS
  // 3. payload must not contain any username EXCEPT the caller's own groupmates (understand only)
  // 4. on violation: throw — never silently strip. A leak must fail loudly in ask_log.
}
```
**Test:** feed each guard a payload containing a prediction → must throw. This is the only test that
protects the product's core promise, so it runs in CI, not by hand.

---

## 1. Answer validation — the six checks

Contract: run AFTER a tool produces an answer, BEFORE it is emitted.
Failure ⇒ **clarify or refuse. Never emit.** Every failure is written to `ask_log.validation_fail`.

```ts
type Check = { id: string; run: (v: VCtx) => string | null }   // null = pass, string = reason
type VCtx = {
  question: string; answer: string; route: string
  spec: Spec                        // resolved intent + entities
  rows: unknown[]                   // the SQL result the answer was rendered from
  lastAnswer?: string; lastQuestion?: string
  registry: Registry                // known teams / players / groups / screens
  authed: boolean
}
```

### V1 — not-a-repeat  *(catches Class 6)*
```
if (answer === lastAnswer && question !== lastQuestion) FAIL 'repeat'
```
Byte-identical answer to a *different* question is **always** a bug. No exceptions.
→ action: re-route ignoring all borrowed context; if still identical, clarify.

### V2 — shape  *(catches Class 3)*
Derive `expected_shape` from the question, assert the answer matches:

| Question form | Expected | Fail if |
|---|---|---|
| `who / which <singular>` | exactly **1** entity named | answer names 0, or ≥3 |
| `where` | names a **screen** (Dashboard/Groups/Picks/AI/Trivia/Game) | no screen named |
| `how many <X>` | a number **labelled with X** | no number, or the number's noun ≠ X |
| `when` | a date or time | neither present |
| `is / did / does` (yes-no) | starts with a verdict | no yes/no/verdict |

`how many yellow cards did argentina get?` → "Argentina have played 2 games" ⇒ **FAIL** (number
present, but its noun is *games*, not *cards*).

### V3 — entity-exists  *(anti-hallucination)*
Every team/player name in the answer must exist in `registry`. An invented name ⇒ FAIL.

### V4 — number-traceable  *(catches Class 1 — REPLACES the broken check)*
The current check (`answerCrew` L1074) asks *"does this number appear anywhere in the facts?"*
Every player card contains `0 yellow, 0 red`, so **`0` is always present** — which is exactly how
*"there have been 0 red cards"* passed while the truth is ≥12.
**A token-membership test is not a fact check.**

Replacement: **numbers may only be rendered from `rows`, never spoken by the model.**
- Deterministic tools already do this — they format `rows` directly. ✅
- The RAG path must not emit numbers at all: the model gets `{facts}` and returns **prose with
  placeholders** (`{{n1}}`), which we substitute from `rows`. If it emits a bare digit ⇒ FAIL.
- Aggregates (`how many red cards in the tournament?`) are **not a RAG question** — they are a
  `COUNT(*)`. Route them to SQL and delete the RAG path's licence to answer them.

### V5 — on-topic-entity
Entity asked about must appear in the answer. Asked about Group D ⇒ answer says Group D.
Asked about Argentina ⇒ answer says Argentina.

### V6 — no-gate-on-public  *(catches Class 2)*
```
if (!authed && answer.includes('sign in') && TOOL_IS_PUBLIC[route]) FAIL 'gated-public'
```
The auth gate must bind to the **tool**, not to the guessed intent. Today a misclassification
inherits that intent's gate — which is why `thanks!` and `how to play this game?` demand a login.
Also add a `courtesy` route (`thanks`, `ok`, `cool`, `nice`) that never touches data.

---

## 2. The FACTS block — kill the date hallucination *(P0)*

`RULES_PROMPT` has **no clock**. On 2026-07-14 the bot said trivia *"starts June 11 — it's currently
before that date"*, and *"the next trivia question is June 11"* (five weeks past). **Every date the
model utters today is a guess.**

Prepend to *every* chat call:

```
FACTS (authoritative — you may not state any date or number that is not here):
  today: 2026-07-14 (Israel)
  tournament phase: Semi-Finals
  next game: Netherlands vs Portugal, Jul 14 19:00 UTC
  trivia: 40 questions total, Jun 11 – Jul 20, one/day at 22:00 Israel, 40s window, 1 pt each
  <+ any tool rows relevant to this question>
```
Rule in the system prompt: **"If a date or number is not in FACTS, say you don't know."**
Enforced by V4, not trusted.

---

## 3. Evaluation harness *(P7)*

```bash
node scripts/ask/eval.mjs           # runs all three suites, one exit code
```

| Suite | Role | Must be |
|---|---|---|
| `real_chat_test.mjs` | cases real users typed | **17/17** |
| `audit_probe.mjs` | 82-question adversarial sweep (becomes graded) | **≥ 80/82** |
| `wide_test.mjs` | synthetic no-regression net | **99/99** |

**Deploy gate:** `eval.mjs` non-zero ⇒ do not deploy. This is the piece that makes every later
change safe; without it we are trading known bugs for unknown ones.

### Per-answer telemetry (extend `ask_log`)
Add: `validation_fail text[]`, `expected_shape text`, `rows_count int`, `llm_payload_bytes int`.
Then these become one-query checks instead of investigations:
- which checks fire most (→ next bug to fix)
- routes with zero traffic (→ dead rules)
- answers with numbers but `rows_count = 0` (→ **fabrication**, by definition)

---

## 4. Learning loop *(P8)*

Weekly, from `ask_log`:
1. Questions that routed **correctly** + validated ⇒ candidate `intent_examples` / `dim_examples`.
2. Questions that **failed validation** ⇒ new cases in `real_chat_test`.
3. 👍/👎 in the AskBot UI ⇒ the label signal we currently do not have at all.

**Curated, never auto-fed.** Auto-adding examples teaches the bot its own mistakes, and an answer
cache is not learning — `qa_cache` was removed in v26 precisely because it was poisonable.

---

## 5. Build order

| | Ship | Why first |
|---|---|---|
| 1 | **V0 outbound guard** | protects the core promise; ~30 lines |
| 2 | **FACTS block + V4** | stops the bot stating false numbers/dates — the worst failure |
| 3 | **V6 + courtesy route** | "thanks!" must never demand a login |
| 4 | **V1, V2, V5** | catch shape/repeat bugs at runtime |
| 5 | **eval.mjs gate** | nothing regresses silently after this |
| 6 | V3 + telemetry + learning loop | compounding value |

Steps 1–3 are the ones that stop the bot being *confidently wrong*. They touch no routing and can
ship before any of v29's rewrite.
