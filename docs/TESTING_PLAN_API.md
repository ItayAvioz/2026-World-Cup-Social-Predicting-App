# World Cup 2026 — API Testing Plan

---

## Production Load Reference

| Phase | Games | Max games/day | Matchdays |
|---|---|---|---|
| Group stage | 72 | 4 (MD3 simultaneous) | ~18 |
| R32 | 16 | 4 | 4 |
| R16 | 8 | 2 | 4 |
| QF | 4 | 2 | 2 |
| SF | 2 | 1 | 2 |
| Third + Final | 2 | 1 | 2 |
| **Total** | **104** | **4** | **~32 matchdays** |

> Stress target: 4 games same day. Flow target: knockout with ET + penalties.

---

## Testing Scenarios

| Scenario | Complexity | Games needed | ET/Pens? |
|---|---|---|---|
| S1: Single game basic flow | Low | 3 | No |
| S2: Multiple games same day (4) | Medium | 1 day × 4 games | No |
| S3: Same team multiple games (stats accumulation) | Medium | 3+ same team | No |
| S4: Knockout no ET | Medium | 2 | No |
| S5: Knockout with ET, no pens | High | 1 | ET only |
| S6: Knockout with ET + penalties | High | 1 | ET + pens |
| S7: Score > 5 goals (validation test) | Low | 1 historical | No |
| S8: Game not done at KO+120min | Medium | 1 live | No |
| S9: Odds — 3-day window update | Low | 3 days same games | No |
| S10: Rate limit stress (4 games/day) | Medium | 1 day × 4 games | No |
| S11: Force error scenarios | Low | Manual | No |
| S12: Schedule collection — verify all KO times | Medium | All WC fixtures | No |
| S13: 30min pre-game check — KO time + odds | Medium | 3 upcoming games | No |
| S14: UTC timezone handling | Medium | 1 non-UTC country game | No |
| S15: 0-0 score — null vs zero | Medium | 1 historical 0-0 game | No |
| S16: knockout_winner name matching | High | 1 knockout result | No |
| S17: fn_calculate_pick_points on Final | High | 1 seeded Final | No |
| S18: Score idempotency (written twice) | Medium | 1 game, 2 writes | No |
| S19: Full integrated daily morning check | High | 1 full run | No |

---

## Testing Calendar — 3 Weeks

### Week 1 — Static + Single Game

**Day 1–2: Phase 1 — Static endpoints (Teams, Squads, Standings, Injuries)**
- Calls: 4 endpoints × 2 leagues (EPL + La Liga) = ~8 calls
- Verify all DATA_SOURCES.md [OPTIONAL] section field mappings
- Fill validation checklist per endpoint
- Fix any DATA_SOURCES.md discrepancies before moving on

```bash
# Teams
curl "https://v3.football.api-sports.io/teams?league=39&season=2024" -H "x-apisports-key: KEY"
# Squads
curl "https://v3.football.api-sports.io/players/squads?team=33" -H "x-apisports-key: KEY"
# Standings
curl "https://v3.football.api-sports.io/standings?league=39&season=2024" -H "x-apisports-key: KEY"
# Injuries
curl "https://v3.football.api-sports.io/injuries?league=39&season=2024" -H "x-apisports-key: KEY"
```

**Day 3–4: Phase 2 — Single finished game (S1)**
- Pick 3 different finished EPL games from last week
- Per game: 3 calls (fixture + team stats + player stats) = 9 calls total
- Verify: status values, score fields, stats keys, player fields
- Confirm: stats[0] = home, stats[1] = away
- Confirm: player stats are per-game (not cumulative)

```bash
curl "https://v3.football.api-sports.io/fixtures?id=FIXTURE_ID" -H "x-apisports-key: KEY"
curl "https://v3.football.api-sports.io/fixtures/statistics?fixture=FIXTURE_ID" -H "x-apisports-key: KEY"
curl "https://v3.football.api-sports.io/players?fixture=FIXTURE_ID" -H "x-apisports-key: KEY"
```

**Day 5: Phase 3 — Same team multiple games (S3)**
- Pick 1 team (e.g. Manchester City), pull last 3 finished games
- Verify stats per game → manually simulate team_tournament_stats VIEW aggregation
- Confirms our VIEW calculation logic is correct

---

### Week 2 — Live Games + Complexity

**Weekend Day 1: Phase 4 — Multiple same-day games (S2 + S10)**
- Full EPL Saturday — pick 4 games, run full call sequence per game after FT
- Total: 4 games × 3 calls = 12 core + ~8 retries/verify = ~20 calls
- Count total calls → verify ≤ 42 (50% safety factor)
- Verify no 429 rate limit errors

**Weekend Day 2: Phase 5 — Live game retry test (S8)**
- Pick a live game this weekend
- Call fixture API at KO+120min → log `fixture.status.short`
- If still in play → retry every +5min → log how many retries until FT
- Calibrate: average retries needed → adjust retry interval if needed

**Midweek: Phase 6 — Cup game ET/penalty (S5 + S6)**
- Champions League or FA Cup knockout game
- S5: game that went to ET (no pens) → verify `score.extratime` fields exist
- S6: game that went to pens → verify `score.penalty` fields + `fixture.status.short = PEN`
- Monitor fixtures list in advance — these games are rare, plan ahead

---

### Week 3 — Error Simulation + Odds

**Day 1: Phase 7 — Error scenarios (S11)**
- Wrong API key → verify 401 response format
- Wrong fixture ID (e.g. `id=999999999`) → verify 404 response format
- Call stats for unfinished game → verify "no data" response format
- Log all error response structures → use in EF error handling code

**Day 2–4: Phase 8 — Odds 3-day window (S9)**
- Day 1: call odds for 5 upcoming EPL games → record prices
- Day 2: same 5 games → verify prices updated or unchanged
- Day 3 (game day morning): call → verify still available. After KO: verify game dropped
- Confirm: `draw` always present in h2h market
- Confirm: response format matches DATA_SOURCES.md odds mapping

```bash
curl "https://api.the-odds-api.com/v4/sports/soccer_epl/odds?apiKey=KEY&regions=eu&markets=h2h"
```

**Day 5: Phase 9 — Historical score validation (S7)**
- Find game with score > 5 goals (e.g. 9-0 Man Utd vs Southampton, fixture ID known)
- Verify API returns the high score correctly
- Confirm our validation logic (score > 5 → flag → re-call) works without false-blocking

---

### Phase 10 — Schedule Collection + KO Time Verification (S12 + S13)

**S12 — Game schedule collection:**
```bash
# Pull all WC fixtures once published
curl "https://v3.football.api-sports.io/fixtures?league=1&season=2026" -H "x-apisports-key: KEY"
```
- For each of 104 fixtures: match `fixture.date` → our seeded `games.kick_off_time`
- Verify: all 104 KO times match exactly (UTC)
- Any mismatch → update DB before seeding `api_fixture_id`
- Verify: all team names match `team_home / team_away` in DB

**S13 — 30min pre-game check (KO time + odds):**

Using a live EPL game:
```
30min before KO:
  → call GET /fixtures?id={fixture_id}
  → verify: fixture.date matches expected KO time
  → verify: fixture.status.short = 'NS' (not started)
  → if different → log mismatch (simulates reschedule detection)

  → call The Odds API for same game
  → verify: odds still available 30min before KO
  → record prices

After KO passes (+5min):
  → call The Odds API again
  → verify: game no longer returned (odds closed)
  → confirms our "stop after KO" logic is correct
```

---

### Phase 11 — Production Edge Cases (S14–S19)

**S14 — UTC timezone handling:**
```bash
# Pick a game in a non-UTC country (e.g. Mexico City = UTC-6)
curl "https://v3.football.api-sports.io/fixtures?id=FIXTURE_ID" -H "x-apisports-key: KEY"
```
- Check `fixture.date` format in response (is it UTC or local time?)
- Compare against our seeded `kick_off_time` (stored as UTC)
- If API returns local time → EF must convert before writing to DB
- If API returns UTC → no conversion needed → confirm and document

---

**S15 — 0-0 score (null vs zero):**
```bash
# Find a historical 0-0 game (e.g. many available in any league)
curl "https://v3.football.api-sports.io/fixtures?id=FIXTURE_ID_0_0" -H "x-apisports-key: KEY"
```
- Verify: `goals.home = 0` and `goals.away = 0` (integers, not null)
- If null → our schema breaks (`score_home IS NOT NULL` = finished — 0 must be 0)
- Verify: `fixture.status.short = 'FT'` on a 0-0 game

---

**S16 — knockout_winner name matching:**
```bash
# Pull any finished knockout game (e.g. CL last 16)
curl "https://v3.football.api-sports.io/fixtures?id=KO_FIXTURE_ID" -H "x-apisports-key: KEY"
```
- API returns `teams.home.name` and `teams.away.name`
- Compare these exactly against our `team_home / team_away` text in DB
- Any mismatch (e.g. "United States" vs "USA") → define canonical name mapping before building EF
- This is critical: `knockout_winner` must match our DB team name exactly

---

**S17 — fn_calculate_pick_points on Final:**
```sql
-- Seed a Final game result with knockout_winner
UPDATE public.games
SET score_home = 1, score_away = 0,
    knockout_winner = 'Brazil'  -- must match champion_pick entries
WHERE phase = 'final';

-- Verify: users who picked Brazil as champion got 10pt
SELECT user_id, points_earned FROM champion_pick WHERE team = 'Brazil';

-- Verify: top scorer points calculated for correct pick
SELECT user_id FROM top_scorer_pick WHERE top_scorer_api_id = <winner_api_id>;
```
- Confirm fn_calculate_pick_points fires on knockout_winner update
- Confirm idempotent: run UPDATE again with same winner → points unchanged

---

**S18 — Score idempotency (written twice):**
```sql
-- Write score once
UPDATE public.games SET score_home = 2, score_away = 1 WHERE id = 'GAME_ID';
-- Record all predictions.points_earned values

-- Write same score again (simulates duplicate cron fire)
UPDATE public.games SET score_home = 2, score_away = 1 WHERE id = 'GAME_ID';
-- Verify: points_earned unchanged — fn_calculate_points is idempotent
SELECT user_id, points_earned FROM predictions WHERE game_id = 'GAME_ID';
```

---

**S19 — Full integrated daily morning check:**
```
Simulate complete morning run in sequence:
  1. Fixture ID check    → call /fixtures for next 7 days → verify all resolve
  2. KO time check       → compare fixture.date vs games.kick_off_time for today
  3. Cron registration   → query pg_cron → verify each today's game has a cron job
  4. Trigger health      → query pg_trigger → verify fn_calculate_points exists
  5. Missing stats check → query games with score but no game_team_stats row
  6. Odds check          → query game_odds for today's games → verify all present

Run all 6 checks in order → verify:
  → each check passes independently
  → introduce 1 failure at a time → verify admin alert fires for each
  → verify non-failing checks continue after one failure (checks are independent)
```

---

### Phase 12 — WC Fixtures Seed (when published, pre-June 2026)

```bash
curl "https://v3.football.api-sports.io/fixtures?league=1&season=2026" -H "x-apisports-key: KEY"
```
- Confirm WC league ID (1 = FIFA World Cup — verify)
- Match each fixture to our seeded games rows by team names + KO time
- Seed `api_fixture_id` into DB (Migration 22)
- Run daily morning check logic manually for first 7 days of tournament

---

## Call Volume Per Phase

| Phase | Days | Calls | API |
|---|---|---|---|
| Static endpoints (Phase 1) | 2 | ~20 | api-football |
| Single game × 3 (Phase 2) | 2 | ~9 | api-football |
| Same team 3 games (Phase 3) | 1 | ~9 | api-football |
| 4 same-day games (Phase 4) | 1 | ~20 | api-football |
| Live game retry (Phase 5) | 1 | ~10 | api-football |
| ET/penalty game (Phase 6) | 2 | ~6 | api-football |
| Error scenarios (Phase 7) | 1 | ~10 | api-football |
| Odds 3-day (Phase 8) | 3 | ~15 | theoddsapi |
| Historical validation (Phase 9) | 1 | ~3 | api-football |
| Schedule + 30min pre-game check (Phase 10) | 1 | ~10 | api-football + theoddsapi |
| Production edge cases (Phase 11) | 2 | ~15 | api-football |
| **Total** | **~17 days** | **~127 calls** | |

> Free tier: 100 req/day — spread across 15 days = ~7 calls/day average. Well within limits.

---

## Validation Checklist (run after each phase)

- [ ] All DATA_SOURCES.md field paths confirmed or corrected
- [ ] Data types match DB columns
- [ ] Nullable fields noted
- [ ] Any unexpected fields found → add to DATA_SOURCES.md as optional
- [ ] DB column name match confirmed or flagged
- [ ] Update DATA_SOURCES.md before building any EF
