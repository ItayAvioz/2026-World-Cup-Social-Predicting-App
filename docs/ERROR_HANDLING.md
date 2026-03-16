# World Cup 2026 — API & DB Error Handling

---

## Group 1 — Pre-Game KO Verification (30min before each game)

| # | Error | Solution |
|---|---|---|
| 1 | API returns different KO time | Update `games.kick_off_time` + reschedule sync cron to new KO+120min |
| 2 | API down / timeout | Retry at KO-20min, KO-10min. If still down → skip verify, proceed with seeded KO time (WC games almost never change) |
| 3.1 | Wrong `api_fixture_id` mapping | **Prevention 1:** validate at pre-tournament setup — match by team names + KO time before writing `api_fixture_id`. **Prevention 2:** daily morning check during tournament — verify each upcoming game's fixture ID resolves correctly → alert if mismatch before game day |
| 3.2 | Game not found (404) at 30min check | Retry at KO-20min, KO-10min. If still 404 → alert (should be caught earlier by 3.1 daily check) |

### 3.1 — Fixture ID Validation Logic

```
Pre-tournament setup (once):
  GET /fixtures?league=1&season=2026
    → for each fixture: match team_home + team_away + kick_off_time to our games row
    → no match found  → log + skip (manual review before seeding)
    → match found     → write api_fixture_id to games

Daily morning during tournament (same run as odds sync):
  → for each game with kick_off_time in next 7 days
  → GET /fixtures?id={api_fixture_id} → verify returns valid response + teams match
  → 404 or mismatch  → alert immediately (fix before game day)
```

---

## Group 2 — Call 1: Score Polling (KO+120min + retries)

| # | Error | Solution |
|---|---|---|
| 4 | API down / timeout | Retry every +5min. 3 consecutive failures → alert + keep retrying every 30min (never give up — score is mandatory) |
| 5 | Rate limit (429) | Back off +10min, then resume +5min cycle. Verify plan limits before launch — target ≤42 calls/day with 50% safety factor on busiest matchday (4 games) |
| 6 | Invalid API key (401) | Note only — handle in API testing plan (key expiry alerts, env var validation before launch) |
| 7 | Game still in play at KO+120min | Retry every +5min — normal, not an error (stoppage time, VAR) |
| 8 | Status = FT but score = null | Retry every +5min. 3 failures → alert + keep retrying every 30min. Score is mandatory, never give up silently |
| 9 | Score > 5 goals for either team | Retry +5min to confirm. If same result → write + alert admin to manually verify on external source. Never skip score |
| 10 | Status = PST / CANC | Caught by daily morning check (Group 1, 3.1) → admin cancels cron before game day. If sync cron fires anyway → self-unschedule + alert |
| 11 | ET/PEN already complete at KO+120min | Write 90-min + ET + pens all at once → done |
| 12 | ET in progress at KO+120min | Write 90-min score + ET flag → schedule new cron at KO+200min for ET result |

### Rate Limit Estimate — Busiest Day (4 group stage games)

| Call type | Per game | 4 games |
|---|---|---|
| Verify KO (30min before) | 1 | 4 |
| Score poll (KO+120min) | 1 | 4 |
| Score retries (avg 2) | 2 | 8 |
| Team stats (Call 2) | 1 | 4 |
| Player stats (Call 3) | 1 | 4 |
| Daily fixture ID verify | 1 | 4 |
| **Total** | | **~28 calls** |
| + 50% safety factor | | **target ≤ 42 calls/day** |

> Verify api-football.com plan limits before choosing plan. Odds API is separate (theoddsapi.com).

---

## Group 3 — Calls 2+3: Stats (team + player, post-game)

> Stats are display-only — score is already written before these calls. Never block on stats.
> Retry pattern for all: +5min → +15min → +30min → alert admin + retry next morning.

| # | Error | Solution |
|---|---|---|
| 13 | Stats endpoint down after score written | Retry +5min, +15min, +30min → alert admin + schedule retry next morning |
| 14 | Stats not yet available (API delay after FT) | Same retry chain — normal API lag, usually resolves within minutes |
| 15 | Partial stats (some fields null) | Write what is available → NULL for missing columns. Alert admin. Retry next morning for missing fields |
| 16 | Player row missing player ID | Skip that player → log + alert admin. Retry next morning. Don't block rest of insert |
| 17 | Duplicate write (cron fires twice) | Safe — both tables use upsert `ON CONFLICT DO UPDATE` |

---

## Group 4 — DB Write Errors

| # | Error | Solution |
|---|---|---|
| 18 | `games` UPDATE fails (score write) | Retry 3x immediately → alert admin + keep retrying every 30min. Score is mandatory — points not calculated until written |
| 19 | `fn_calculate_points` trigger fails | Alert admin immediately — points are wrong until fixed. **Block nightly summary** (leaderboard data is wrong). Manual re-trigger required before summary can run |
| 20 | `game_team_stats` INSERT fails | Retry 3x → alert admin + retry next morning. Display-only, not blocking |
| 21 | `game_player_stats` INSERT fails | Same as #20 |
| 22 | Nightly summary trigger fails (last game of day) | Alert admin. Manual trigger available as fallback |

---

## Group 5 — Odds (daily cron)

| # | Error | Solution |
|---|---|---|
| 23 | Odds API down | Retry once at +1h. If still fails → skip, keep previous odds, try tomorrow. If game day arrives with no odds at all → alert admin in morning run + extra retry 3h after → admin manually checks and completes from web if needed |
| 24 | Game not covered by Odds API | Same as #23 — alert admin 3 days before game + 3h retry. Admin manually fills from web if needed |
| 25 | Odds suspended near KO | Keep last stored odds — stop updating once KO passes |
| 26 | Invalid API key (401) | Note only — handle in API testing plan |
| 27 | Partial response (some games missing) | Write what we have → alert admin immediately. Need to know 3 days before if any game is missing odds |
| 28 | `game_odds` upsert fails (DB write) | Previous odds row stays unchanged in DB — game still shows old odds. Retry 3x → alert admin + retry next morning |

---

## Group 6 — Cron / Infrastructure

| # | Error | Solution |
|---|---|---|
| 29 | EF times out mid-run (score written, stats not) | Score is safe. Daily morning check detects: `score_home IS NOT NULL` but `game_team_stats` missing → schedule stats retry + alert admin |
| 30 | Cron job never fired (Supabase outage) | Alert immediately. Daily morning check verifies all today's game crons are registered → alert if any missing before game day |
| 31 | Wrong game synced (bad `api_fixture_id`) | Validate before write: API team names must match `team_home/team_away` in DB. Caught earlier by daily morning check (3.1) |
| 32 | "Last game of day" detection wrong | Query: `score_home IS NULL` for today → if 0 → trigger summary. Covered by daily morning check: verify all today's games + KO times + crons + trigger → alert if anything missing |

### Daily Morning Check — Full Verifications

```
Every morning during tournament:
  1. Fixture ID check    → each upcoming game (next 7 days) resolves correctly (see Group 1, 3.1)
  2. KO time check       → API KO time matches DB for today's games
  3. Cron registration   → sync cron exists for each of today's games
  4. Trigger health      → fn_calculate_points trigger exists on games table
  5. Missing stats check → any game with score but no game_team_stats → schedule retry + alert
  6. Odds check          → any today's game missing odds → alert + 3h retry (see Group 5, 23/24)
  → alert admin on any failure
```

### 30min Before KO Check — Verifications

```
  1. KO time           → verify API matches DB, reschedule sync cron if different
  2. Cron registered   → verify sync cron for this game exists, re-register if missing
  3. Trigger health    → verify fn_calculate_points trigger is active
  → alert admin on any failure
```

---

## F8 — Nightly Summary Edge Function

### Group A — Trigger / Entry

| # | Error | Solution |
|---|---|---|
| A1 | No finished games today | Exit immediately — 0 Claude calls, 0 groups processed |
| A2 | `fn_calculate_points` trigger failed earlier | Block summary — leaderboard is wrong. Alert admin. Do not run until trigger is manually re-triggered and verified (see Group 4 #19) |
| A3 | EF triggered before last game finished | Check: all today's games have `score_home IS NOT NULL`. If any NULL → exit, re-trigger when last game finishes |

---

### Group B — DB Read (get_group_summary_data)

| # | Error | Solution |
|---|---|---|
| B1 | DB down — all groups fail | Abort → retry x3 at 30min intervals → fallback message to all groups + alert admin |
| B2 | DB returns empty data for a group | Skip Claude → save fallback "no data today" message → alert admin |
| B3 | Specific group query fails | Retry once → fallback message for that group + alert admin → retry tomorrow |

---

### Group C — Claude API

| # | Error | Solution |
|---|---|---|
| C1 | Claude timeout / rate limit | Sequential processing with 2s gap between groups → retry once after 5s → retry after all groups finish → fallback message + alert admin → tomorrow |
| C2 | Empty or malformed response (<50 chars) | Retry once → fallback message + alert admin → tomorrow |
| C3 | Response has no group context (hallucinated / generic) | Validate: response must reference at least one member name or point value. If not → retry once → fallback + alert admin |

---

### Group D — DB Write (ai_summaries)

| # | Error | Solution |
|---|---|---|
| D1 | `ai_summaries` INSERT fails | Retry once → save to `failed_summaries` table + alert admin → retry tomorrow morning |
| D2 | EF crashes midway | Already-saved groups are safe (upsert). Alert admin for missing groups. Re-run tomorrow picks them up |

---

### F8 General Rules

- Admin always alerted on: fallback used, group skipped, DB error, Claude error, EF crash
- Max 2 retries per group (1 immediate + 1 after all groups finish) → then fallback for the day
- Fallback messages saved to `ai_summaries` so group always sees something (never blank)

### F8 Capacity Calculation (required before launch)

```
Formula:
  num_groups × (claude_avg_ms + 2000ms gap + db_call_ms) < EF_timeout

Supabase EF timeout:
  Free: 150s
  Pro:  400s

Safety factor: target ≤ 70% of EF timeout

Check at milestones: 10 groups / 50 groups / 100 groups

Decision matrix:
  - Free Supabase (150s) + Pro Claude   → works up to ~20 groups
  - Pro Supabase (400s) + lower Claude  → works up to ~60 groups
  - Batch runs if groups exceed single EF capacity

If calculation exceeds limit → increase gaps → batch EF runs → upgrade plan
```

### F8 Rate Limit Notes

- Claude rate limits vary by plan — Haiku: faster + cheaper / Sonnet: better quality (decision pending)
- 2s gap between groups is the minimum — increase if rate limit errors appear in testing
- Verify Claude plan limits before launch (requests/min and tokens/min)

### Fallback Messages

- C1/C2: *"Our AI analyst called in sick today (probably still recovering from that last-minute equalizer). Summary coming tomorrow — in the meantime, check the leaderboard and start arguing with your group."*
- B1: *"Connection issue on our end — no summary today. We'll be back tomorrow. Go check the leaderboard manually like it's 2006."*
- B2: *"Nothing to report today — looks like no games finished yet or our data is running late. Check back tomorrow!"*

---
