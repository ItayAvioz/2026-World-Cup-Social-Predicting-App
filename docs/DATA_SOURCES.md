# World Cup 2026 — Data Sources (Exact Fields)

---

## ⚠️ Source Selection — PENDING

Two candidate APIs. Must be chosen before building any sync Edge Function.

**Option A: api-football.com (RapidAPI / v3.football.api-sports.io)**
- Free: 100 req/day. Paid plans available.
- Coverage: scores, ET/penalties, team stats, player stats, standings, injuries, squads

**Option B: football-data.org**
- Free: 10 req/min
- Coverage: scores, standings. Less detailed stats (no player per-game stats on free tier)

**Odds API: theoddsapi.com** — separate source, only for betting odds (1X2). No alternative evaluated yet.

> Decision pending. Both options documented below using api-football.com field names as reference.
> **When source is chosen: verify all API field names and column names match before building.**

---

## ⚠️ Column Names — DB is the Determinant

Field names in this document may not match the current DB schema exactly.

**Rule: when there is a conflict between this doc and the DB schema, the DB wins.**

Before building any sync Edge Function:
- Compare every "Column" cell in this doc against the actual DB column name
- Update this doc to match the DB (not the other way around)
- Known mismatches already identified:
  - `api_football_id` → DB will use `api_fixture_id` (Migration 22 pending)
  - `score_home_et` → DB uses `et_score_home`
  - `score.penalty → bool` → DB stores actual scores: `penalty_score_home/away int`
  - `game_results` table → DB uses `game_team_stats`
  - `status` column on games → **does not exist in DB** (use `score_home IS NOT NULL`)
  - `player_tournament_stats` → DB has this as a **VIEW**, not a table (no direct write — aggregated automatically from `game_player_stats`)

> Sections marked **[OPTIONAL]** below = features not yet in DB scope.
> Define and add to DB when data source is chosen and field mapping is verified.

---

## API Call Logic

> ✅ Same pattern as DB auto-predict crons: one pg_cron job per game, fires at scheduled time,
> calls Edge Function, self-unschedules when done. For knockout ET cases, EF schedules a new cron
> dynamically when ET is detected (KO+120min result → ET detected → new cron at KO+200min).

### Odds — The Odds API

- Run daily in the morning (same fixed UTC time each day)
- Fetch odds for all games with `kick_off_time` within the next 3 days
- Update if there is a change (upsert — safe to re-run)
- **Stop after game's `kick_off_time` passes** — odds no longer relevant once game starts

```
Example: game on Monday
  → Saturday morning run  → fetch + upsert
  → Sunday morning run    → fetch + upsert
  → Monday morning run    → fetch + upsert
  → Monday KO passes      → no more updates for this game
```

---

### Pre-Game KO Verification — All Games

```
30min before each KO:
  GET /fixtures?id={api_fixture_id}
    → verify fixture.date matches games.kick_off_time in DB
    → if mismatch → update DB + reschedule sync cron
    → WC games don't get postponed — sanity check only
```

---

### Group Stage Games — Post-Game Sync

```
KO + 120min:
  Call 1: GET /fixtures?id={api_fixture_id}
    FT → write score_home/away (90-min)
         → fn_calculate_points fires (trigger)
         → Call 2: GET /fixtures/statistics → write game_team_stats
         → Call 3: GET /players             → write game_player_stats
         → if last game of day              → trigger nightly-summary EF
         → DONE

    not finished → retry every +5min until FT
```

---

### Knockout Games — Post-Game Sync

```
KO + 120min:
  Call 1: GET /fixtures?id={api_fixture_id}

    FT (no ET) → write score_home/away (90-min)
                  went_to_extra_time = false
                  → fn_calculate_points fires
                  → Call 2 + Call 3 (stats)
                  → if last game of day → trigger nightly-summary EF
                  → DONE

    not finished → retry every +5min until FT or AET/PEN

    AET or goes to ET:
      → write score_home/away (90-min) + went_to_extra_time = true
      → wait +40min then:

      Call 1 again:
        AET (ET ended, no pens) → write et_score_home/away
                                   went_to_penalties = false
                                   knockout_winner
                                   → fn_calculate_points + fn_calculate_pick_points fire
                                   → Call 2 + Call 3 (stats)
                                   → if last game of day → trigger nightly-summary EF
                                   → DONE

        PEN (went to penalties) → write et_score_home/away
                                   went_to_penalties = true
                                   penalty_score_home/away
                                   knockout_winner
                                   → fn_calculate_points + fn_calculate_pick_points fire
                                   → Call 2 + Call 3 (stats)
                                   → if last game of day → trigger nightly-summary EF
                                   → DONE

        not finished → retry every +5min until AET or PEN
```

**What knockout sync writes:**

| Column | When set |
|---|---|
| `score_home / score_away` | Always (90-min result) |
| `went_to_extra_time` | Always (true/false) |
| `et_score_home / et_score_away` | Only if went_to_extra_time = true |
| `went_to_penalties` | Only if went_to_extra_time = true |
| `penalty_score_home / penalty_score_away` | Only if went_to_penalties = true |
| `knockout_winner` | Always (actual winner after all stages) |
| `game_team_stats` | Always (Call 2) |
| `game_player_stats` | Always (Call 3) |

---

## API-Football — Fixtures & Scores

**Endpoint:** `GET /fixtures?id={api_fixture_id}`

| Field from API | Stored In | DB Column | Match? |
|---|---|---|---|
| fixture.id | games | `api_fixture_id` | ⚠️ col not yet in DB — Migration 22 pending |
| fixture.status.short | — | — | logic only, not stored |
| goals.home | games | `score_home` | ✅ |
| goals.away | games | `score_away` | ✅ |
| score.extratime.home | games | `et_score_home` | ✅ verify API field name |
| score.extratime.away | games | `et_score_away` | ✅ verify API field name |
| score.penalty.home | games | `penalty_score_home` | ✅ verify API field name |
| score.penalty.away | games | `penalty_score_away` | ✅ verify API field name |
| — | games | `went_to_extra_time` | ⚠️ derived — set to true when status=AET or PEN |
| — | games | `went_to_penalties` | ⚠️ derived — set to true when status=PEN |
| — | games | `knockout_winner` | ⚠️ derived — set from teams.home/away.name based on result |

---

## API-Football — Match Statistics

**Endpoint:** `GET /fixtures/statistics?fixture={api_fixture_id}`
**When:** once, after game confirmed finished

| Field from API | Stored In | DB Column | Match? |
|---|---|---|---|
| statistics[0] = home / statistics[1] = away | game_team_stats | `game_id` + `team` (PK) | ✅ table name confirmed |
| "Ball Possession" | game_team_stats | `possession` | ✅ verify API key string |
| "Total Shots" | game_team_stats | `shots_total` | ✅ verify API key string |
| "Shots on Goal" | game_team_stats | `shots_on_target` | ✅ verify API key string |
| "Corner Kicks" | game_team_stats | `corners` | ✅ verify API key string |
| "Fouls" | game_team_stats | `fouls` | ✅ verify API key string |
| "Yellow Cards" | game_team_stats | `yellow_cards` | ✅ verify API key string |
| "Red Cards" | game_team_stats | `red_cards` | ✅ verify API key string |
| "Offsides" | game_team_stats | `offsides` | ✅ verify API key string |

---

## API-Football — Player Statistics

**Endpoint:** `GET /players?fixture={api_fixture_id}`
**When:** once, after game confirmed finished

| Field from API | Stored In | DB Column | Match? |
|---|---|---|---|
| player.id | game_player_stats | `api_player_id` | ✅ table name confirmed |
| player.name | game_player_stats | `player_name` | ✅ verify API field path |
| statistics[0].team.name | game_player_stats | `team` | ✅ verify API field path |
| statistics[0].games.minutes | game_player_stats | `minutes_played` | ✅ verify API field path |
| statistics[0].goals.total | game_player_stats | `goals` | ✅ verify API field path |
| statistics[0].goals.assists | game_player_stats | `assists` | ✅ verify API field path |
| statistics[0].cards.yellow | game_player_stats | `yellow_cards` | ✅ verify API field path |
| statistics[0].cards.red | game_player_stats | `red_cards` | ✅ verify API field path |

> `player_tournament_stats` is a VIEW — aggregated automatically from game_player_stats. No direct write needed.

---

## API-Football — Fixtures Setup (pre-tournament, once)

**Endpoint:** `GET /fixtures?league=1&season=2026`
**When:** manual run before tournament starts

| Field from API | Stored In | DB Column | Match? |
|---|---|---|---|
| fixture.id | games | `api_fixture_id` | ⚠️ col not yet in DB — Migration 22 pending |
| fixture.date | games | `kick_off_time` | ✅ cross-check matches seeded values |

---

## The Odds API

**Endpoint:** `GET /sports/soccer_fifa_world_cup/odds?regions=eu&markets=h2h`
**When:** daily morning run, for games with kick_off_time in next 3 days

| Field from API | Stored In | DB Column | Match? |
|---|---|---|---|
| matched game (via api_fixture_id cross-ref) | game_odds | `game_id` | ✅ |
| bookmakers[0].key | game_odds | `source` | ✅ verify API field path |
| h2h outcome: Home | game_odds | `home_win` | ✅ verify API field path |
| h2h outcome: Draw | game_odds | `draw` | ✅ verify API field path |
| h2h outcome: Away | game_odds | `away_win` | ✅ verify API field path |

> draw always filled — for knockout games it means "goes to ET" (same field, UI labels differently).

---

## [OPTIONAL] API-Football — Standings

> Not in current DB scope. Add if standings display is added to the app.
> **Verify field mapping against DB before implementing.**

**Endpoint:** `GET /standings?league={wc}&season=2026`

| Field from API | Stored In | Column |
|---|---|---|
| team.id | standings | team_id |
| group | standings | group_letter |
| rank | standings | position |
| points | standings | points |
| all.played | standings | played |
| all.win | standings | wins |
| all.draw | standings | draws |
| all.lose | standings | losses |
| goals.for | standings | goals_scored |
| goals.against | standings | goals_conceded |
| goalsDiff | standings | goal_diff |

---

## [OPTIONAL] API-Football — Teams

> Not in current DB scope. Add if a teams table is added (e.g. for logos, API ID mapping).
> **Verify field mapping against DB before implementing.**

**Endpoint:** `GET /teams?league={wc}&season=2026`

| Field from API | Stored In | Column |
|---|---|---|
| team.id | teams | api_football_id |
| team.name | teams | name |
| team.code | teams | code |
| team.logo | teams | flag_url |

---

## [OPTIONAL] API-Football — Players / Squads

> Not in current DB scope. Add if a players table is added (e.g. for squad pages, shirt numbers).
> **Verify field mapping against DB before implementing.**

**Endpoint:** `GET /players/squads?team={id}`

| Field from API | Stored In | Column |
|---|---|---|
| player.id | players | api_football_id |
| player.name | players | name |
| player.age | players | age |
| player.number | players | shirt_number |
| player.pos | players | position |
| statistics[0].team.name | players | club |

---

## [OPTIONAL] API-Football — Injuries

> Not in current DB scope. Add if injury/suspension display is added.
> **Verify field mapping against DB before implementing.**

**Endpoint:** `GET /injuries?league={wc}&season=2026`

| Field from API | Stored In | Column |
|---|---|---|
| player.id | player_unavailability | player_id |
| team.id | player_unavailability | team_id |
| player.name | player_unavailability | player_name |
| fixture.id | player_unavailability | game_id |
| player.type | player_unavailability | injury_type |
| player.reason | player_unavailability | status (out / doubtful) |

---

## Derived / Computed (no external API)

| Data | Derived From | Stored In |
|---|---|---|
| Avg goals/stats per team | game_team_stats aggregated | team_tournament_stats VIEW |
| Total goals/assists/cards per player | game_player_stats aggregated | player_tournament_stats VIEW |
| Points earned | prediction vs score | predictions.points_earned |

---

## Edge Function Run Schedule

| Function | Trigger | API Called | Writes To |
|---|---|---|---|
| `football-api-sync` | pg_cron per game: 30min pre-KO (verify) + KO+120min (results) | API-Football | `games`, `game_team_stats`, `game_player_stats` |
| `sync-odds` | Daily morning, games in next 3 days | The Odds API | `game_odds` |
| `nightly-summary` | Triggered by football-api-sync after last game of day | Claude API | `ai_summaries` |

---

## API Request Volume Estimate

| Function | Frequency | Calls per run | Est. Monthly |
|---|---|---|---|
| `football-api-sync` (verify) | Once per game, 30min pre-KO | 1 | ~104 |
| `football-api-sync` (results) | Once per game post-game | 3 (score + team stats + player stats) | ~312 |
| `football-api-sync` (retries) | Per game, if not finished at KO+120min | up to 5 extra | ~200 worst case |
| `sync-odds` | Daily during tournament | ~1 batch | ~60 |
| **API-Football total** | | | **~616 / month** |
| **The Odds API total** | | | **~60 / month** |
