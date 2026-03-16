> ⚠️ OUTDATED — Preliminary design document. This ERD was created early in planning and does NOT reflect the live database schema.
> For the live schema, see: `.claude/skills/db-feature/SKILL.md`
> Notable differences: this doc contains tables that were never built (teams, players, standings, leaderboard_snapshots, user_achievements, player_unavailability), uses forbidden columns (games.status, group_members.role, predictions.confidence), and has different column names than the live DB.

---

# World Cup 2026 — Entity Relationship Diagram (Early Design)

```mermaid
erDiagram
    users {
        uuid id PK
        text username
        timestamptz created_at
    }

    teams {
        uuid id PK
        text name
        char code
        text flag_url
        int fifa_rank
        char group_letter
        text confederation
        int wc_appearances
        text wc_best_result
    }

    players {
        uuid id PK
        uuid team_id FK
        int api_football_id
        text name
        text position
        int shirt_number
        int age
        text club
    }

    games {
        uuid id PK
        uuid team_home_id FK
        uuid team_away_id FK
        timestamptz kick_off_time
        timestamptz completed_at
        int score_home
        int score_away
        int score_home_et
        int score_away_et
        text status
        text phase
        char group_letter
        int matchday
        bool extra_time
        bool penalties
        text venue
        int api_football_id
    }

    game_results {
        uuid id PK
        uuid game_id FK
        uuid team_id FK
        text result
        int goals_scored
        int goals_conceded
        int shots_total
        int shots_on_target
        int corners
        int fouls
        int yellow_cards
        int red_cards
        int offsides
        int possession
    }

    team_tournament_stats {
        uuid id PK
        uuid team_id FK
        int games_played
        int wins
        int draws
        int losses
        int goals_scored_total
        int goals_conceded_total
        decimal avg_goals_scored
        decimal avg_goals_conceded
        decimal avg_shots_total
        decimal avg_shots_on_target
        decimal avg_corners
        decimal avg_fouls
        decimal avg_yellow_cards
        decimal avg_possession
        text form
        timestamptz updated_at
    }

    standings {
        uuid id PK
        uuid team_id FK
        char group_letter
        int position
        int played
        int points
        int goals_scored
        int goals_conceded
        int goal_diff
        timestamptz updated_at
    }

    player_tournament_stats {
        uuid id PK
        uuid player_id FK
        int goals
        int assists
        int games_played
        int yellow_cards_phase
        int yellow_cards_total
        int red_cards
        bool is_top_scorer
        timestamptz updated_at
    }

    player_unavailability {
        uuid id PK
        uuid player_id FK
        uuid team_id FK
        uuid game_id FK
        text reason
        text status
        text injury_type
        int yellow_cards_in_phase
        timestamptz updated_at
    }

    odds {
        uuid id PK
        uuid game_id FK
        text bookmaker
        decimal home_win
        decimal draw
        decimal away_win
        decimal home_prob
        decimal draw_prob
        decimal away_prob
        timestamptz fetched_at
    }

    predictions {
        uuid id PK
        uuid user_id FK
        uuid game_id FK
        int pred_home
        int pred_away
        text confidence
        int points_earned
        timestamptz submitted_at
        timestamptz last_modified_at
    }

    champion_pick {
        uuid id PK
        uuid user_id FK
        uuid team_id FK
        int points_earned
        timestamptz submitted_at
    }

    top_scorer_pick {
        uuid id PK
        uuid user_id FK
        uuid player_id FK
        text player_name
        int points_earned
        timestamptz submitted_at
    }

    groups {
        uuid id PK
        text name
        char invite_code
        uuid created_by FK
        timestamptz created_at
    }

    group_members {
        uuid group_id FK
        uuid user_id FK
        text role
        timestamptz joined_at
    }

    leaderboard_snapshots {
        uuid id PK
        uuid group_id FK
        uuid user_id FK
        date date
        int total_points
        int rank
    }

    user_achievements {
        uuid id PK
        uuid user_id FK
        text achievement
        timestamptz earned_at
    }

    ai_summaries {
        uuid id PK
        uuid group_id FK
        date date
        text content
        timestamptz generated_at
    }

    %% User relationships
    users ||--o{ predictions           : "makes"
    users ||--o| champion_pick         : "picks"
    users ||--o| top_scorer_pick       : "picks"
    users ||--o{ group_members         : "belongs to"
    users ||--o{ groups                : "creates"
    users ||--o{ leaderboard_snapshots : "tracked in"
    users ||--o{ user_achievements     : "earns"

    %% Team relationships
    teams ||--o{ players                  : "has"
    teams ||--o{ game_results             : "accumulates"
    teams ||--o| team_tournament_stats    : "summarised in"
    teams ||--o{ standings                : "ranked in"
    teams ||--o{ player_unavailability    : "reports"
    teams ||--o{ champion_pick            : "picked as"
    teams ||--o{ games                    : "plays as home"
    teams ||--o{ games                    : "plays as away"

    %% Player relationships
    players ||--o| player_tournament_stats : "has stats"
    players ||--o{ player_unavailability   : "flagged in"
    players ||--o{ top_scorer_pick         : "picked as"

    %% Game relationships
    games ||--o{ predictions           : "receives"
    games ||--o{ game_results          : "produces"
    games ||--o{ odds                  : "has"
    games ||--o{ player_unavailability : "misses"

    %% Group relationships
    groups ||--o{ group_members        : "has"
    groups ||--o{ ai_summaries         : "receives"
    groups ||--o{ leaderboard_snapshots: "tracked in"
```

---

## Views (derived — no extra storage)

| View | Derives From | Purpose |
|---|---|---|
| `leaderboard` | predictions + champion_pick + top_scorer_pick | Total points, rank, tiebreakers (exact score count) |
| `daily_leaderboard` | predictions + games.completed_at (today) | Points earned today per user |
| `user_streaks` | predictions + games ordered by kick_off_time | Current and best correct outcome streak per user |
| `top_10_scorers` | player_tournament_stats ORDER BY goals DESC LIMIT 10 | Tournament golden boot race |
| `top_10_assisters` | player_tournament_stats ORDER BY assists DESC LIMIT 10 | Tournament top assist providers |

---

## Table Notes

### `teams`
- `wc_appearances`, `wc_best_result` — seeded from `Team data.txt` at setup
- Static for the tournament, no sync needed

### `games`
- `team_home_id` / `team_away_id` nullable — knockout rows inserted only once matchups confirmed
- `score_home` / `score_away` — score at 90 min, used for prediction comparison
- `score_home_et` / `score_away_et` — null unless game went to extra time, display only
- Final display score: `COALESCE(score_home_et, score_home)`
- `extra_time`, `penalties` — booleans set on completion
### `game_team_comparison` view
- Given a `game_id`, returns for each team: avg goals scored per game, avg goals conceded, avg yellow cards, avg corners, W/D/L record in tournament so far
- Derived entirely from `game_results` + `games` — no extra storage
- Displayed side-by-side on `game.html` pre-kickoff

### `player_tournament_stats`
- One row per player, updated after each game
- `yellow_cards_phase` — resets after Round of 16 (WC rules)
- `yellow_cards_total` — full tournament count, display only
- `is_top_scorer` — set at tournament end to trigger `top_scorer_pick` points awarding

### `player_unavailability`
- `reason`: `injury` / `yellow_card_suspension` / `red_card_suspension`
- `status`: `out` / `doubtful` — doubtful only for injuries, not suspensions
- `injury_type`: text, nullable — only for injuries
- `yellow_cards_in_phase`: int, nullable — context shown on UI ("2nd yellow — suspended")
- `game_id`: the specific game the player will miss
- Populated by `sync-injuries` (injuries) and `sync-results` (card suspensions) Edge Functions

### `predictions`
- UNIQUE constraint on `(user_id, game_id)`
- Scored against `games.score_home` / `score_away` (90 min score)
- `confidence`: `low` / `medium` / `high` — user self-rated, social + AI roast material
- `last_modified_at` — for AI summary fun facts ("changed pick 3 min before kickoff")

### `user_achievements`
- One row per achievement per user
- Examples: `perfect_score`, `underdog_3x`, `streak_5`, `early_bird`, `last_minute_change`
- Awarded by `sync-results` Edge Function after each game
- UNIQUE constraint on `(user_id, achievement)` — can't earn same badge twice

### `champion_pick` / `top_scorer_pick`
- UNIQUE constraint on `user_id`
- Lock permanently at June 11 2026 kickoff

### `leaderboard_snapshots`
- Written nightly by the same cron that runs AI summaries
- Enables "climbed X spots today" logic in the AI roast

### `odds`
- `home_prob` / `draw_prob` / `away_prob` — implied probability stored pre-calculated
- Avoids recalculating on every frontend render

### `group_members`
- PK: `(group_id, user_id)`
- `role`: `captain` / `member`

---

## Constraints Summary

| Table | Constraint |
|---|---|
| `predictions` | UNIQUE (user_id, game_id) |
| `champion_pick` | UNIQUE (user_id) |
| `top_scorer_pick` | UNIQUE (user_id) |
| `group_members` | PK (group_id, user_id) |
| `player_tournament_stats` | UNIQUE (player_id) |
| `standings` | UNIQUE (team_id, group_letter) |
| `odds` | UNIQUE (game_id, bookmaker) |
| `user_achievements` | UNIQUE (user_id, achievement) |

---

## Edge Function → Table Mapping

| Edge Function | Writes To |
|---|---|
| `setup-tournament` | teams, players, games (group stage) |
| `sync-results` | games, game_results, standings, player_tournament_stats, player_unavailability (suspensions), user_achievements |
| `sync-knockouts` | games (new knockout rows) |
| `sync-odds` | odds |
| `sync-injuries` | player_unavailability (injuries only) |
| `nightly-summary` | leaderboard_snapshots, ai_summaries |
