# Ask Bot v29 — plan for a complete, reliable, independent bot

**Status:** proposed (2026-07-14). Supersedes the "add another rule" approach.
**Baseline:** DEV EF v48 (v28 rule table). `wide_test` **99/99**. `real_chat_test` **11/17**.
Those two numbers together are the whole story — see §1.

---

## 1. The evidence

A real user session produced ~7 wrong answers in a row while the 99-case suite was green.
I turned that session into `scripts/ask/real_chat_test.mjs` and ran it against live v48: **11/17**.

**The 99-case suite tests what I thought to test. The real-chat suite tests what users type.**
When they disagree, the real one is right. Every acceptance gate below is measured on real-chat.

Confirmed live failures (all reproduced, all in `ask_log`):

| # | Question | Got | Should be |
|---|---|---|---|
| A1 | `in how much group i can be?` | World Cup **Group I** standings | "up to 3 groups" |
| A2 | `in how much group i can be member?` | World Cup **Group I** standings | "up to 3 groups" |
| B1 | `where i can see game stat?` | a dump of **my group standings** | "open the game → Match Stats" |
| C1 | `what is the nexg game?` | **the previous answer** (red-card list), verbatim | the next fixture |
| D1 | `who finishe 1 in group a?` | a **57-row table** | one team name |
| D2 | `in which of my groups i have the best streak?` | a **global** Exact%/streak line | names a group |
| E1 | `how many trivia questions are there in total?` | the trivia **points** rule | "40" |

---

## 2. Root cause — five classes, only one of which is a "bug"

**A. Word-sense / entity ambiguity.** The rule is `/\bgroup ([a-l])\b/`. In "in how much group **i**
can be", the substring `group i` is literally present — but the `i` is the *pronoun*.
**A regex cannot do word-sense disambiguation.** There is no ordering of regexes that fixes this,
and the same hole reappears for any friend group named with a single letter.

**B. Intent misroute on sloppy word order.** The how-to rule requires `where (do|can) I`; the user
typed `where i can`. Regexes match *strings*, and users type *language*.

**C. Context bleed.** A typo (`nexg`) matched nothing, so the borrow logic filled the gap from the
**previous answer** and replayed a red-card list for a schedule question. The bot would rather
repeat itself than admit confusion. **This is the worst class**: confidently, silently wrong.

**D. Answer shaping.** The tool ran fine and returned its default payload; nobody checked whether it
answered *the question asked*. "Who finished 1st" wants one name, not a table. "In which of my
groups" wants a group, not a global rate.

**E. Coverage.** `how many trivia questions` had no tool to call, so it fell through to a rules FAQ
that matched on "trivia" and answered about *points*. The bot guessed because it had nothing to read.

> **D1's table had 57 rows because on DEV `group_name='A'` holds 52 club games** — the test data we
> deliberately keep ([[dev-data-scope-decision]]). On PROD Group A has 4 teams. So half of D1 is a
> data artifact, not a bot bug. The other half — dumping a table when asked for one name — is real.

**The unifying diagnosis:** the router matches **strings**; it needs to resolve **meaning**. The v28
rule table made *ordering* visible and testable, which was worth doing and stays. But the matcher
underneath is still regex-over-raw-text, and that is the ceiling we keep hitting.

---

## 3. Data coverage map — "does everything have a reference?"

Every `public` table vs. the tool that reads it (from `grep from('…')` on `index.ts`):

| Table | Read by bot | Tool |
|---|---|---|
| games | ✅ ×21 | schedule, lastGame, gameDetail, gameStats, tournamentGroupTable, … |
| predictions | ✅ | myExact, groupHistory, dayPoints |
| player_tournament_stats (view) | ✅ | statLeaderboard, playerStat, playerCount |
| team_tournament_stats (view) | ✅ | teamStat, compareTeams |
| groups / group_members / profiles | ✅ | groupMeta, groupStandings, whoPicked |
| game_team_stats / game_events | ✅ | box score, scorers |
| game_odds / champion_odds | ✅ | gameOddsAnswer, championOddsAnswer |
| knockout_pick | ✅ | myBracket |
| ai_summaries | ✅ | latestRoast |
| champion_pick / top_scorer_pick | ✅ *(indirect, via leaderboard RPCs)* | whoPicked |
| **trivia_questions** | ❌ **NONE** | — |
| **trivia_answers** | ❌ **NONE** | — |
| **teams** | ❌ **NONE** | — |
| **top_scorer_candidates** | ❌ **NONE** | — |

**Four real gaps:**
1. **Trivia has zero tools.** The user asked about trivia *twice*; both answers were LLM prose, one
   of them wrong. Needs: question count, schedule/window, *my* trivia score, today's status.
2. **`teams` is never read.** It is the natural **entity registry** (48 WC teams, flags, WC group).
   Because we derive WC groups from `games.group_name` instead, club test rows leak into Group A —
   and there is no authoritative "is this a WC team?" check anywhere.
3. **`top_scorer_candidates`** — no "who can I pick for top scorer?" tool.
4. Everything else (feedback, app_events, edit logs, prompt_versions) is admin-only. Correctly absent.

---

## 4. Architecture — understanding-first (the actual fix)

Today: **regex rules decide; the LLM parse (`llmUnderstand`) is a fallback** after they fail.
v29: **flip it.** The LLM becomes the *parser*, never the answerer. The rules become the fast path
and the outage net.

```
question
  ├─ 0. FAST PATH        exact/high-confidence deterministic rules (ROUTE_RULES, from v28)
  │                       hit -> execute. Cheap, no LLM. Covers the common, unambiguous asks.
  │
  ├─ 1. UNDERSTAND       ONE structured LLM call: question text -> typed spec
  │                       { intent, entities[{type,value,confidence}], output_shape, slots, ambiguity[] }
  │                       Knows "group i" is a pronoun. Knows "nexg" is "next". Knows word order.
  │                       ⚠️ PRIVACY BOUNDARY UNCHANGED: only the question text + the caller's OWN
  │                       group/member NAMES go up. No predictions, no picks, no ranks. Ever.
  │
  ├─ 2. RESOLVE          every entity -> exactly one TYPED reference, against a registry:
  │                       wc_group(A-L) | friend_group(caller's only) | team | player | phase |
  │                       screen | rule_topic | member.  `teams` table becomes the source of truth.
  │                       Unresolvable or 2+ candidates -> ambiguity.
  │
  ├─ 3. CLARIFY GATE     required slot missing, or ambiguity -> ONE targeted question and STOP.
  │                       ("World Cup Group A, or your friend group?")  Guessing is banned:
  │                       a confident wrong answer costs more than a question.
  │
  ├─ 4. EXECUTE          deterministic SQL tools. UNCHANGED. This is where correctness already lives.
  │
  └─ 5. SHAPE + CHECK    render to the ASKED shape (one|list|count|table), then verify:
                          - does the answer contain what was asked for?
                          - is it byte-identical to the previous answer for a DIFFERENT question?
                            -> that is always a bug -> clarify instead.
```

**Degraded mode keeps working.** If OpenAI is down, step 1 is skipped and the v28 rules answer
alone — exactly today's behaviour. The rules stop being the brain and become the safety net.

**Cost/latency.** Step 1 replaces the current embedding+classify round-trip for the non-fast-path
cases, so it is roughly cost-neutral: still ≤1 LLM call per question. `ask_log` already records
latency, so this is measurable rather than argued.

---

## 5. Phases (each ships independently, each has a gate)

| Phase | Work | Gate |
|---|---|---|
| **P0 — Entity registry** | Read `teams`. Build the typed registry + resolver. WC-group answers sourced from `teams`, not `games.group_name`. Pronoun/letter disambiguation lands here. | A1, A2, A3, D1 pass |
| **P1 — Trivia tools** | `triviaInfo` (count/schedule/window), `myTrivia` (own score — private, deterministic). Kill the FAQ shadowing. | E1, E2 pass |
| **P2 — Understand-first** | Structured-spec LLM call promoted to primary router; rules become fast path + degraded net. | B1, B2, C1, C2 pass |
| **P3 — Clarify gate** | Per-tool required slots; ambiguity → one question. Ban silent guessing. | new ambiguity cases pass; no regression |
| **P4 — Answer shaping** | Output-shape renderer + "answered the question?" and "not a repeat" post-checks. | D1, D2 pass |
| **P5 — Eval loop** | `real_chat_test` grows from `ask_log` every week. Both suites in one command. | real-chat **17/17**, wide **99/99** |

**Definition of done:** real-chat 17/17 **and** wide 99/99, on DEV EF, with `ask_log` showing a
`route` on every answer.

---

## 6. What we are NOT doing

- **Not** deleting the v28 rule table. It is the fast path and the outage net, and it is the only
  reason routing is testable at all.
- **Not** sending data to the LLM. The privacy boundary (question text + own group/member names only)
  is the one invariant that never moves.
- **Not** cleaning the DEV club data ([[dev-data-scope-decision]]) — but P0 makes the bot robust to
  it, which is the durable fix.
- **Not** touching PROD. DEV-only until after the tournament.
