# WC2026 Top-Scorer-Candidates Seed Plan

**Goal**: Populate `top_scorer_candidates` (PROD only) with every player in the official WC2026 26-man rosters, each with an `api_player_id` so end-of-tournament top-scorer scoring works.

**Why two more rounds**: FIFA's deadline for the final 26-man rosters is **2026-06-01**. api-football's `/players/squads` endpoint refreshes 1–3 days later. Today (2026-05-31) we've seeded with what's published so far + best-effort api-football enrichment. The 6.1% missing ids will be filled by the post-deadline re-pulls.

---

## Status snapshot (2026-05-31)

| | Count |
|---|---|
| FIFA-published teams pasted into `data/wc2026_squads.json` | 42/48 |
| Players in JSON | 1140 |
| Players with `api_player_id` matched | 1070 (93.9%) |
| **Seeded to PROD `top_scorer_candidates` (active)** | **1051** |
| Old players deactivated (`is_active=false`) | 472 |
| Pending teams (not yet FIFA-published) | 6 — Mexico, Paraguay, Australia, Ecuador, Uruguay, Algeria |
| Provisional (>26, extended preliminary lists awaiting cutdown) | 11 — Czech Republic, Iran, Iraq, Jordan, Ghana, Portugal, Qatar, Saudi Arabia, Senegal, Turkey, Uzbekistan |
| Unmatched players in JSON (no `api_player_id`) | 70 — deferred to Phase 2 |

Migration: `supabase/migrations-prod/20260531000124_wc2026_official_squad_seed.sql` (applied to PROD via MCP in 5 statements: 1 deactivate + 4 upsert chunks).

EF used for enrichment: `football-api-sync v9` on PROD (`/players/squads`, `/players?team=X&season=2026`, `/players/profiles?search=X` via `lookup_players` mode).

---

## Phase 2 — 2026-06-04 to 06-06: post-FIFA-deadline pull

**Trigger**: FIFA publishes final 26-man rosters on **2026-06-02** at `fifa.com/.../canadamexicousa2026/articles/all-world-cup-squad-announcements`. api-football reflects it ~24-72h later.

### Steps
1. **Paste remaining FIFA squads into `data/wc2026_squads.json`**:
   - The 6 pending teams (Mexico, Paraguay, Australia, Ecuador, Uruguay, Algeria) when FIFA publishes
   - Replace the 11 provisional teams' extended rosters with the cut-down final 26
2. **Re-pull api-football `/players/squads`** for all 48 teams via `football-api-sync mode=bootstrap_squads` (3-6 retries to clear rate limit)
3. **Re-run enrichment scripts**:
   - `C:\tmp\enrich_squads2.py` — primary match against `/players/squads`
   - `C:\tmp\enrich_squads3.py` — fallback against `/players?team&season=2026`
   - `C:\tmp\apply_lookup_strict.py` — final fallback via `/players/profiles`
4. **Apply incremental SQL** to PROD: same UPSERT pattern as M124, but only for newly-matched players or teams that changed
5. **Verify**: every team has between 23-26 active rows in `top_scorer_candidates`

### Expected outcome
- Match rate ≥ 99%
- All 48 teams represented
- All star strikers (Kane, Mbappé, Salah, Ronaldo, Haaland, Vinicius, Isak, Williams) confirmed with stable api_player_id

### Manual touch-ups if needed
If any star strikers still unmatched after Phase 2 enrichment, hand-verify their api_player_id at `https://www.api-football.com/players/<name>` and insert directly with a tiny SQL statement.

---

## Phase 3 — 2026-06-07 to 06-10: verification pull (catch injury swaps)

FIFA allows squad changes up to 24h before each team's MD1 for serious injury. Re-pull `/players/squads` once more on **2026-06-10** evening to catch any last-minute replacements before the opener (2026-06-11 19:00 UTC).

### Steps
1. `bootstrap_squads` one more time
2. For each team, diff the api-football response vs current `wc2026_squads.json`
3. If a player was swapped: `UPDATE top_scorer_candidates SET is_active=false WHERE api_player_id=<removed>` and INSERT the replacement
4. Sanity check: 48 × 26 = 1248 players max, expect ~1180-1248 active depending on teams submitting 23-26

---

## Phase 4 — Mid-tournament backfill (if needed)

Goals only count toward scoring at end of tournament (after final's `knockout_winner` is set, the `fn_award_top_scorer_points` trigger reads `player_tournament_stats` aggregated by `api_player_id` from `game_player_stats`).

**Risk**: If a user picks "Nico Williams" as top scorer and Nico Williams scores 5 goals in WC2026, but their `top_scorer_pick.top_scorer_api_id` is NULL because we never matched them, the user gets 0 points.

### Backfill strategy
- After each game, `game_player_stats` is written from `/fixtures/players` (which returns `api_player_id`). So we KNOW every scorer's api_player_id from match data.
- Run a backfill SQL on a regular cadence (daily during tournament):
  ```sql
  -- Bind top_scorer_pick.top_scorer_api_id where currently NULL but the player_name matches a known scorer
  UPDATE top_scorer_pick tsp
  SET top_scorer_api_id = gps.api_player_id
  FROM (SELECT DISTINCT api_player_id, player_name FROM game_player_stats WHERE goals > 0) gps
  WHERE tsp.top_scorer_api_id IS NULL
    AND lower(tsp.player_name) = lower(gps.player_name);
  ```
- Run this same backfill once before the final game so end-of-tournament scoring is clean.

---

## Why all this complexity

api-football has **no dedicated tournament-roster endpoint**. The three available endpoints each have flaws:
- `/players/squads?team=X` — returns latest call-up; missing foreign-based players until federation publishes WC squad to FIFA
- `/players?team=X&season=2026` — appearance-based; empty until WC matches play (June 11+)
- `/fixtures/lineups?fixture=X` — authoritative but only available 20-40 min before kickoff

So we manually paste FIFA-official names → enrich with api-football for `api_player_id` mapping → re-enrich after FIFA deadline when the squads endpoint refreshes → verify final time + ongoing backfill from match data.

---

## Files involved

| File | Role |
|---|---|
| `data/wc2026_squads.json` | Source of truth for FIFA-official rosters + matched api_player_ids |
| `data/wc2026_squads_EXAMPLE.json` | Reference format for hand-pasting new teams |
| `supabase/functions/football-api-sync/index.ts` | v9 — adds `lookup_players`, `bootstrap_wc_players`, `probe_wc_team` modes |
| `supabase/migrations-prod/20260531000124_wc2026_official_squad_seed.sql` | Applied seed (1051 active rows in PROD) |
| `C:\tmp\enrich_squads2.py` / `C:\tmp\enrich_squads3.py` / `C:\tmp\apply_lookup_strict.py` | Enrichment scripts (re-runnable for Phase 2/3) |
