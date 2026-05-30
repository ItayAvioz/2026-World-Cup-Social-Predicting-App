# football-api-sync — Edge Function reference

WC2026 game data sync — fixtures, scores, team stats, player stats, odds, lineups, full squads.

Source: api-football.com (v3). Auth via `FOOTBALL_API_KEY` (EF env, NOT vault).

## Modes

| Mode | When called | What it does | Triggered by |
|---|---|---|---|
| `probe` | Manual test | Fetch fixtures for any league/season (no DB write). Returns sample + account info. | Manual via SQL `net.http_post` |
| `probe_date` | Manual test | Fetch fixtures for specific dates + leagues. For nightly-summary testing. | Manual |
| `probe_ns` | Manual test | Today's "Not Started" fixtures. | Manual |
| `probe_stats` | Manual test | Full stats + players for one fixture. | Manual |
| `snap_stats` | Manual test | Team stats only (no DB write). Used for post-game polling CSV. | Manual |
| `probe_odds` | Manual test | Odds for one fixture (pre + live + inplay). | Manual |
| `setup` | One-time | Map api-football fixture IDs to existing `games` rows (UPDATE only — does NOT insert games). | Manual after game inserts |
| `setup_lineups` | Per-fixture, mid-tournament | Pulls one fixture's lineups → adds new forwards to `top_scorer_candidates`, fills missing `api_player_id` for existing candidates. Uses `ON CONFLICT (api_player_id)`. | Manual after games finish |
| **`bootstrap_squads`** | **PROD ONLY, one-time** | **Pulls all 48 WC2026 teams + their full squads (1383 players) from api-football. Returns raw JSON. 49 api-football calls (1 + 48). SQL caller reads from `net._http_response` to seed `teams` + `top_scorer_candidates`.** | **Manual via SQL on prod cutover** |
| `verify` | KO−30min cron | Confirms api kickoff time matches DB. If diff >5min, UPDATEs `games.kick_off_time` + reschedules crons via `fn_reschedule_game`. | pg_cron `verify-game-{id}` |
| `sync` | KO+120min cron | Writes score + stats + unschedules crons. Handles ET/penalty mid-flight + terminal statuses. | pg_cron `sync-game-{id}` |
| `sync_af_odds` | Daily cron | Pre-match h2h + over/under 2.5 from Bet365 (fallback first bookmaker) → `game_odds`. | pg_cron `af-odds-daily` (07:15 UTC) |
| `sync_stats` | Backfill (manual) | Re-runs `writeStats` for all finished games (or one). | Manual |

## bootstrap_squads — PROD setup detail

**Purpose:** one-time seed of the `teams` (48 rows) + `top_scorer_candidates` (1383 rows incl. position) tables on prod.

**Why it exists:** dev's M45 seeded ~30 hardcoded star strikers with manually-entered api_player_ids. For prod, we need:
- All 48 teams with real `api_team_id` (so per-team API calls work)
- All players (forwards + midfielders + defenders + GKs) with real `api_player_id` (so per-fixture `setup_lineups` enrichment + top-scorer scoring matches reliably)
- `position` column populated (so frontend can optionally filter the top-scorer pick dropdown)

**Invocation (prod only):**
```sql
SELECT net.http_post(
  url := 'https://asugxlvgcmkxspzokydk.supabase.co/functions/v1/football-api-sync',
  body := '{"mode":"bootstrap_squads"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_service_role_key')
  ),
  timeout_milliseconds := 180000
);
-- Response cached in net._http_response — read it back via id
```

**Response shape:**
```jsonc
{
  "status": "bootstrap_squads_ok",
  "teams_count": 48,
  "squads_count": 48,
  "total_players": 1383,
  "total_forwards": 360,
  "errors": [],
  "teams":  [{api_team_id, name, code, country, logo}, ...],
  "squads": [{api_team_id, team_name, players: [{api_player_id, name, position, number, age}]}, ...]
}
```

**Subsequent SQL** in `supabase/migrations-prod/`:
- `20260530000001_seed_teams_and_top_scorer_candidates.sql` — seeds `teams` + first attempt at `top_scorer_candidates` (Attackers only)
- `20260530000002_reseed_top_scorer_candidates_all_players.sql` — re-seeds with ALL 1383 players + position

**Schema migration that paired with this** (in `supabase/migrations/`, applied to dev + prod):
- `20260530000115_top_scorer_candidates_add_position_and_apiid_unique.sql` — ADD COLUMN position; DROP name UNIQUE; ADD api_player_id UNIQUE.

**Cost:** 49 api-football calls (1 + 48). Pro plan allows 7500/day, 450/min — plenty of room. Runtime: ~30s sequential.

**Idempotent:** safe to re-run. The seed SQL uses `ON CONFLICT (api_player_id) DO UPDATE` everywhere.

**Not deployed to dev:** dev still has the v36 baseline without `bootstrap_squads`. Dev keeps its 27 M45-seeded stars. If dev ever needs the same bulk seed, deploy this function to dev too and re-run the prod migrations against dev.

## Team name normalization

`TEAM_ALIASES` lookup (lowercase) in code:
- `cote divoire` → `ivory coast`
- `korea republic` → `south korea`
- `cabo verde` → `cape verde`
- `usa` → `united states`
- `ir iran` → `iran`
- `turkiye` → `turkey`

These are used by `normalizeTeam()` for fuzzy matching in `setup` mode. Frontend + DB use the unaliased forms (United States, Turkey, etc.); api-football uses some of the aliased forms (USA, Türkiye).

For the **bulk seed** (`bootstrap_squads`), a separate SQL-level mapping is applied (see migration `20260530000001_seed_teams_and_top_scorer_candidates.sql`):
- `USA` → `United States`
- `Türkiye` → `Turkey`
- `Bosnia & Herzegovina` → `Bosnia-Herzegovina`
- `Congo DR` → `DR Congo`
- `Cape Verde Islands` → `Cape Verde`

## Other notes

- `WC_LEAGUE_ID = 1`, `WC_SEASON = 2026` hardcoded constants
- `BET365_ID = 8` for `sync_af_odds` (prefers Bet365, falls back to first bookmaker)
- Stats: `red_cards` derived from player-level data (VAR-correct), not team aggregate
- `writeStats` errors are caught + logged to `ef_errors` so a stats failure doesn't block score write
- Rate limit (429) → `ef_errors('quota')` + retry +10min via `fn_schedule_retry_sync`
- Terminal statuses (PST/SUSP/ABD/CANC/AWD/WO/INT) → unschedule + admin alert + stop (no infinite retry)
- KO+6h hard-stop safety net (covers unknown statuses)
