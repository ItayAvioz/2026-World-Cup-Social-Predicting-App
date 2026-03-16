# World Cup 2026 — F8 Nightly Summary Testing Plan

---

## Production Load Reference

| Variable | Value |
|---|---|
| Min members for summary | ≥3 active members |
| Max members per group | 10 |
| Gap between groups | 2s |
| Claude calls per night | 1 per qualifying group |
| Capacity milestones | 10 / 50 / 100 groups |
| Claude model | TBD (Haiku vs Sonnet — decide before build) |

---

## Test User Plan

| Phase | Groups needed | Members per group | Total users needed |
|---|---|---|---|
| Phase 1 — Basic flow | 1 | 3 | 3 (use existing: alice, bob, carol) |
| Phase 2 — Multi-game | 1 | 5 | 5 (use existing: alice, bob, carol, dave, eve) |
| Phase 3 — Multi-group | 3 | 3 each | 9 → create 4 new (test_f1–f4) |
| Phase 4 — Edge cases | 3 | 2 / 3 / mixed | reuse existing |
| Phase 5 — Error scenarios | 1 | 3 | reuse existing |
| Phase 6 — Capacity (10 groups, 50 members, streak data) | 10 | 5 avg | 50 → create ~45 new (test_g1–g45) |

> Later stages: replace test users with real users when available.
> All test users: password `Test1234!` — consistent with existing test users.

---

## Existing Test Users

| Email | Username |
|---|---|
| alice@test.com | alice_wc |
| bob@test.com | bob_wc |
| carol@test.com | carol_wc |
| dave@test.com | dave_wc |
| eve@test.com | eve_wc |

---

## Testing Scenarios

| # | Scenario | What it tests |
|---|---|---|
| S1 | 1 group, 1 game finished | Basic end-to-end flow |
| S2 | 1 group, 4 games finished | Claude handles multi-game context |
| S3 | 3 groups same night | Sequential processing, 2s gap, each group gets own summary |
| S4 | Group with exactly 3 members | Threshold — must get summary |
| S5 | Group with 2 members | Below threshold — must be skipped silently |
| S6 | Group with inactive members | Inactive flag in context, still on leaderboard |
| S7 | Member with auto-predict | is_auto flag visible in summary context |
| S8 | ET/penalty game day | Summary handles full knockout result |
| S9 | Force Claude error | Fallback message saved, admin alert fires |
| S10 | Force DB read failure | Group skipped, fallback saved, admin alert |
| S11 | Force ai_summaries write failure | Saved to failed_summaries, retry tomorrow |
| S12 | Capacity — 10 groups | Measure EF runtime vs timeout limit |
| S13 | No finished games today | EF exits immediately, 0 Claude calls |
| S14 | Champion pick eliminated context | Summary handles "your champion is out" roast |
| S15 | failed_summaries retry flow (next-day loop) | Retry reads failed_summaries → inserts → marks resolved |
| S16 | Same-day re-trigger (upsert) | Second trigger overwrites, no duplicate row |
| S17 | All members 0 points day | Claude handles gracefully, no crash on empty winner |
| S18 | Prompt token size check | Token count logged, within model limits |
| S19 | Tournament end (day after Final) | EF exits cleanly or generates final tournament summary |
| S20 | Human tone review | Real human reads 3–5 summaries, confirms quality |

---

## Testing Calendar — 4 Phases

---

### Phase 1 — Basic End-to-End (existing 5 users)

**Setup:**
- Group 1: alice (captain), bob, carol — 3 members ✅ qualifies for summary
- Seed 1 finished game with predictions + scores for all 3 members

**Tests: S1, S13**

```
S13 first:
  → trigger EF with no finished games → verify exits immediately, 0 ai_summaries rows

S1:
  → seed 1 game score
  → trigger EF manually
  → verify: ai_summaries row created for group 1
  → verify: summary mentions member names + points
  → verify: summary length > 50 chars
  → verify: summary is in English, funny tone
  → verify: only group 1 members can read it (RLS)
```

**Expected result:** 1 ai_summaries row, readable by alice/bob/carol only.

---

### Phase 2 — Multi-Game + Full Group (existing 5 users)

**Setup:**
- Group 1: alice (captain), bob, carol, dave, eve — 5 members
- Seed 4 finished games (simulate busiest group stage day)
- All 5 members have predictions for all 4 games

**Tests: S2, S7**

```
S2:
  → seed 4 game scores
  → trigger EF
  → verify: summary covers multiple games (not just 1)
  → verify: leaderboard context includes all 5 members

S7:
  → mark 1 member's predictions as is_auto = true
  → trigger EF
  → verify: auto-predict flag appears in Claude context (get_group_summary_data returns it)
  → verify: summary may reference/roast the auto-predicted member
```

**Expected result:** 1 ai_summaries row, multi-game context, auto-predict visible.

---

### Phase 3 — Multi-Group + Edge Cases (create 4 new users: test_f1–test_f4)

**Setup:**
- Group 1: alice, bob, carol (3 members — threshold) ← S4
- Group 2: dave, eve (2 members — below threshold) ← S5
- Group 3: alice, bob, carol, dave, test_f1, test_f2 — one member inactive ← S6
- Seed 1 finished game, all groups have predictions

**Tests: S3, S4, S5, S6**

```
S4:
  → Group 1 has exactly 3 active members
  → verify: summary generated ✅

S5:
  → Group 2 has 2 members
  → verify: skipped silently, no ai_summaries row for group 2
  → verify: no error, no fallback message

S3:
  → Groups 1 + 3 both qualify (≥3 active members)
  → trigger EF
  → verify: 2 summaries generated (one per group)
  → verify: each summary is different (group-specific context)
  → verify: 2s gap in processing (check EF logs/timing)

S6:
  → In Group 3: mark test_f1 as is_inactive = true
  → trigger EF
  → verify: inactive member still in leaderboard context (dimmed)
  → verify: summary handles the inactive member correctly
```

**Expected result:** 2 ai_summaries rows (groups 1 + 3), group 2 skipped.

---

### Phase 4 — Error Scenarios (existing users)

**Setup:**
- Group 1: alice, bob, carol
- Seed 1 finished game

**Tests: S8, S9, S10, S11**

```
S8 — ET/penalty game:
  → seed a knockout game with went_to_extra_time=true, went_to_penalties=true
  → trigger EF
  → verify: get_group_summary_data returns ET/penalty data
  → verify: Claude prompt includes full result (90-min + ET + pens + winner)

S9 — Force Claude error:
  → temporarily set invalid ANTHROPIC_API_KEY secret
  → trigger EF
  → verify: fallback message saved to ai_summaries
  → verify: admin alert fired
  → verify: fallback text matches expected message
  → restore valid key

S10 — Force DB read failure:
  → temporarily break get_group_summary_data (rename function or revoke access)
  → trigger EF
  → verify: group skipped, fallback message saved
  → verify: admin alert fired
  → restore function

S11 — Force ai_summaries write failure:
  → temporarily add constraint that blocks insert
  → trigger EF
  → verify: Claude response saved to failed_summaries instead
  → verify: admin alert fired
  → restore table
```

---

### Phase 6 — Capacity Test: 10 Groups, 50 Members, Streak Data (create ~45 new users: test_g1–test_g45)

**Why 50 members and streak data:**
- Claude prompt context grows with group size — need to verify it handles large payloads
- Streak data (consecutive W/D/L) requires multiple game days seeded — tests `get_group_summary_data` aggregation
- 10 groups × 5 members avg = 50 people total in Claude context across all groups

**Setup:**
- Create 10 groups, 5 members each (mix of existing + new test users)
- Seed **5 consecutive game days** (minimum for meaningful streak data):
  - Day 1: 2 games — seed scores + predictions for all members
  - Day 2: 2 games — vary outcomes (some members correct, some wrong)
  - Day 3: 2 games — build streak (same members correct/wrong again)
  - Day 4: 1 game — someone has +3 streak, someone has -3
  - Day 5: 1 game — trigger EF on this day (streak data fully populated)
- Ensure variety across groups: different leaders, different streaks, different prediction patterns

**Streak scenarios to seed:**
| Member | Streak | How to seed |
|---|---|---|
| Member A | +3 (3 correct in a row) | 3 consecutive correct W/D/L predictions |
| Member B | -3 (3 wrong in a row) | 3 consecutive wrong outcomes |
| Member C | +1 (just recovered) | 2 wrong then 1 correct |
| Member D | 0 (mixed) | alternating correct/wrong |

**Tests: S12**

```
S12 — 10 groups, 50 members, streak data:
  → trigger EF for day 5
  → verify: all 10 summaries generated (no timeout)
  → verify: get_group_summary_data returns streak per member correctly
  → verify: Claude prompt includes streak context (+ / - counts)
  → verify: summary references streaks (crowns climbers, roasts losers)
  → measure total runtime → compare vs EF timeout (150s free / 400s pro)
  → log: time per group, time per Claude call
  → calculate: avg_group_ms + 2000ms gap × 10 groups = total
  → update capacity formula in ERROR_HANDLING.md with real numbers
```

**Formula check:**
```
10 groups × (claude_avg_ms + 2000ms + db_call_ms) < EF_timeout
Target: result ≤ 70% of timeout limit

If 10 groups passes comfortably → extrapolate to 50/100 groups
If 10 groups approaches 70% → plan batching now
```

**Streak data verification (before triggering EF):**
```sql
-- Verify streak data is populated correctly
SELECT * FROM get_group_summary_data('GROUP_ID', '2026-XX-XX');
-- Check: each member has streak field, positive for winners, negative for losers
```

> Later: repeat Phase 6 with real users when available.
> At 50 groups milestone: re-run capacity calculation, decide on batching strategy.

---

### Phase 7 — Production Edge Cases (S14–S20)

**S14 — Champion pick eliminated context:**
```sql
-- Seed a knockout game where a popular pick team loses
UPDATE public.games
SET knockout_winner = 'Argentina'
WHERE phase = 'r16' AND (team_home = 'Brazil' OR team_away = 'Brazil');
-- Brazil eliminated — members who picked Brazil as champion are now "out"

-- Trigger EF
-- Verify: get_group_summary_data returns champion_pick with eliminated status
-- Verify: Claude prompt includes "champion eliminated" flag per affected member
-- Verify: summary roasts members whose champion is out
```

---

**S15 — failed_summaries retry flow (next-day loop):**
```
Day 1:
  → force ai_summaries write failure (temporary constraint)
  → trigger EF → verify: Claude response saved to failed_summaries
  → verify: failed_summaries row has correct content + group_id + date
  → restore table

Day 2:
  → trigger EF normally (with date = Day 1)
  → verify: EF reads failed_summaries for unresolved rows
  → verify: retries INSERT into ai_summaries
  → verify: failed_summaries row marked as resolved
  → verify: ai_summaries now has Day 1 summary
```

---

**S16 — Same-day re-trigger (upsert):**
```
→ trigger EF → verify: ai_summaries row created (summary v1)
→ trigger EF again same day
→ verify: ai_summaries row count unchanged (no duplicate)
→ verify: row content = summary v2 (new one, not old)
→ verify: updated_at timestamp changed
```

---

**S17 — All members 0 points (bad day for everyone):**
```sql
-- Seed game where all members predicted wrong (nobody gets 1pt or 3pt)
INSERT INTO predictions (user_id, game_id, score_home, score_away)
-- All members predict 1-0, seed actual result as 0-2
UPDATE games SET score_home = 0, score_away = 2 WHERE id = 'GAME_ID';

-- Trigger EF
-- Verify: get_group_summary_data returns all members with points_today = 0
-- Verify: summary generated (no crash on empty winner)
-- Verify: Claude roasts everyone equally or picks the "least wrong" prediction
```

---

**S18 — Prompt token size check:**
```
Setup: 10-member group, 4 games with full stats, 5 days of streak data

→ trigger EF with logging enabled
→ capture full prompt sent to Claude (log in EF before API call)
→ count tokens (estimate: ~4 chars per token)
→ compare against model limits:
   Haiku:  200k context window
   Sonnet: 200k context window
→ if prompt > 100k tokens → flag for optimization
→ log actual token count → update capacity notes in ERROR_HANDLING.md
```

---

**S19 — Tournament end (day after Final, July 20):**
```sql
-- Seed all games as finished (score_home IS NOT NULL for all 104 games)
-- Trigger EF with date = '2026-07-20' (day after Final)

-- Verify: no games with kick_off_time on July 20 → EF exits immediately
-- OR: verify EF generates a special "tournament is over" final summary
-- Decide behavior before build: exit silently or send farewell summary
```
> Decision needed: exit silently vs generate final tournament summary on last day.

---

**S20 — Human tone review (pre-launch gate):**
```
Not a code test — required human sign-off before launch.

Steps:
  1. Run EF on 3 different groups with real varied data
  2. Human reads each summary and checks:
     [ ] Funny, not dry or corporate
     [ ] Correct member names (no hallucination)
     [ ] Correct points referenced
     [ ] Crowns the right climber
     [ ] Roasts the right loser
     [ ] No factual errors (wrong scores, wrong teams)
     [ ] English only
  3. If any failure → adjust Claude prompt → re-test
  4. Sign off before enabling for real users
```

---

## Manual Trigger Command

```bash
curl -X POST https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/nightly-summary \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-06-11"}'
```

---

## Validation Checklist (per phase)

- [ ] ai_summaries rows created for all qualifying groups
- [ ] Groups with <3 active members skipped silently
- [ ] Each summary > 50 chars, in English, mentions member names
- [ ] RLS verified: only group members can read their group's summary
- [ ] Admin alert fired on all error scenarios
- [ ] Fallback messages saved correctly (ai_summaries or failed_summaries)
- [ ] failed_summaries retry loop verified end-to-end
- [ ] Upsert verified: re-trigger same day overwrites, no duplicate
- [ ] EF runtime logged vs timeout limit
- [ ] Token count logged per group
- [ ] Capacity formula updated with real measurements in ERROR_HANDLING.md
- [ ] Champion eliminated context verified in Claude prompt
- [ ] Tournament end behavior decided + tested
- [ ] Human tone review sign-off completed (S20) before launch
