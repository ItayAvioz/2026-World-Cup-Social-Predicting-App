# Lineup-Based ID Resolution Plan

**Created:** 2026-06-02
**Goal:** Every `top_scorer_candidates` row picks-eligible by tournament start (2026-06-11 19:00 UTC), with a clear post-game resolution path for placeholder rows.

---

## ⚠️ MANDATORY: normalize `position` to full names on every write

`top_scorer_candidates.position` MUST store api-football **full names** — `Attacker | Midfielder | Defender | Goalkeeper` — because the frontend Picks position filter (`Picks.jsx`) does an exact string compare. The source `data/wc2026_squads.json` stores FIFA **short codes** (`GK | DF | MF | FW`); these are NOT directly insertable.

M128 (2026-06-02) synced the JSON without normalizing → DB column went mixed (~1278 rows in short codes) → the position filter silently matched nothing for synced players. Fixed in PROD 2026-06-07 by a normalize UPDATE.

**Every sync/insert/resolve that touches `position` must map at the boundary:**

```sql
-- run as the final step of any JSON re-sync, or bake into the staging INSERT
UPDATE top_scorer_candidates SET position='Goalkeeper' WHERE position='GK';
UPDATE top_scorer_candidates SET position='Defender'   WHERE position='DF';
UPDATE top_scorer_candidates SET position='Midfielder' WHERE position='MF';
UPDATE top_scorer_candidates SET position='Attacker'   WHERE position IN ('FW','F','Forward');
-- verify: zero short codes remain
SELECT position, count(*) FROM top_scorer_candidates GROUP BY position ORDER BY 2 DESC;
```

Do NOT change the frontend filter to accept short codes — full names are the contract.

---

## Why placeholders

`top_scorer_candidates.api_player_id` is `NOT NULL + UNIQUE`. We can't insert null. But 47 WC2026 squad players (mostly low-coverage leagues + provisional-team backups) aren't reachable through:
- `/players/squads?team=X` (api-football's preliminary WC squad — incomplete)
- `/players/profiles?search=NAME` (returns no candidate or wrong namesakes)
- `/players?team=ClubID&season=Y` (some players aren't indexed in any club season)

Rather than block their selection, we **insert them with negative placeholder ids** (`-19` through `-65`) and resolve to real positive ids once they appear in a real match's `/fixtures/players` payload.

---

## id_verification reference (8 states)

| Status | Confidence | How resolved |
|---|---|---|
| `fully_verified` | ★★★★★ | id in api's WC squad AND profile name matches |
| `club_match` | ★★★★★ | id pulled from api's recent club roster (`/players?team=X&season=Y`) |
| `squad_missing_name_ok` | ★★★★ | profile name matches but missing from api preliminary WC roster (api roster incomplete — e.g. Ronaldo, Davies, Isak) |
| `squad_ok_name_mismatch` | ★★★★ | id in api WC squad but profile endpoint returned different display name (squad endpoint authoritative) |
| `lookup_match` | ★★★ | resolved via `/players/profiles?search=` with strict last+first name match |
| `squad_ok_name_suspect` | ★★★ | id in api squad, name flagged (mostly initial-format false positives — safe) |
| `squad_missing_name_flagged` | ★★ | doubly flagged — initial format + missing from squad. ~4 truly obscure backups. |
| **`placeholder_lineup_pending`** | ☆☆☆ | **negative api_player_id. Resolves via post-game lineup/stats sync.** |

**JSON snapshot at 2026-06-02 (1,278 total):**

| Status | Count |
|---|---|
| fully_verified | 1,014 |
| squad_missing_name_ok | 111 |
| squad_ok_name_suspect | 46 |
| placeholder_lineup_pending | 47 |
| club_match | 21 |
| squad_ok_name_mismatch | 17 |
| squad_missing_name_flagged | 17 |
| lookup_match | 5 |

---

## Resolution SQL recipe (post-game)

`writeStats()` in `football-api-sync` populates `game_player_stats` with one row per player who got any minute, including `api_player_id` (positive, authoritative from `/fixtures/players`).

After each finished game, run:

```sql
-- Step 1: identify resolutions (name match within same team)
WITH potential AS (
  SELECT
    tsc.id              AS candidate_id,
    tsc.api_player_id   AS old_id,
    tsc.player_name     AS our_name,
    gps.api_player_id   AS new_id,
    gps.player_name     AS api_name,
    tsc.team_name
  FROM top_scorer_candidates tsc
  JOIN game_player_stats gps
    ON gps.team = tsc.team_name
   AND tsc.api_player_id < 0
   AND (
     -- token-overlap match: lowercase + strip accents
     lower(unaccent(gps.player_name)) = lower(unaccent(tsc.player_name))
     OR lower(unaccent(gps.player_name)) ILIKE '%' || lower(unaccent(split_part(tsc.player_name, ' ', -1))) || '%'
   )
)
SELECT * FROM potential;   -- review before applying

-- Step 2: UPDATE candidates (preserves picks via FK if used)
UPDATE top_scorer_candidates tsc
SET
  api_player_id = potential.new_id,
  id_verification = 'lineup_resolved',
  updated_at = now()
FROM potential
WHERE tsc.id = potential.candidate_id;

-- Step 3: CASCADE to top_scorer_pick.top_scorer_api_id (so picks score)
UPDATE top_scorer_pick tsp
SET top_scorer_api_id = potential.new_id
FROM potential
WHERE tsp.top_scorer_api_id = potential.old_id;
```

**Per-game runbook:**
1. Wait for `writeStats` cron to populate `game_player_stats` (~150 min post-KO)
2. Run Step 1 SQL — review candidate matches (catch wrong matches before applying)
3. Apply Steps 2 + 3 in a transaction
4. Spot-check one resolved row visually

**Trigger version (optional, defer until verified safe):**
A trigger on `game_player_stats` INSERT could automate this, but during the first match-day or two, prefer manual to catch edge cases (homonyms, transliteration ambiguity).

---

## Teams needing FINAL FIFA roster pull (Phase 2 sweep)

7 teams still have **more than 26 players** marked `provisional`. FIFA deadline was 2026-06-02 — these published extended/preliminary lists. Final cuts expected before 2026-06-11.

| Team | Players now | Status |
|---|---|---|
| Türkiye | 35 | extended |
| Qatar | 34 | extended |
| Saudi Arabia | 30 | preliminary |
| Jordan | 30 | extended |
| Uzbekistan | 30 | preliminary |
| Senegal | 28 | provisional |
| Portugal | 27 | provisional |

**Action (Jun 4-6 sweep):**
1. Re-paste final FIFA-confirmed 26-man squads when published
2. Diff against current JSON, deactivate cuts in DB (set `is_active=false`)
3. Add any new names with placeholder ids if not findable via lookup

**Trim placeholders for these teams once final squad known:**
- Türkiye placeholders today: -56 (Tiknaz), -57 (Demiral). If cut, deactivate; otherwise resolve via lineup.
- Qatar: -41 to -46 (6 players). Likely several get cut.
- Saudi: -47, -48. Both might survive cut.
- Jordan: -34 to -39 (6 players).
- Uzbekistan: -58 to -65 (8 players).

---

## 47 placeholder roster (snapshot)

| Team | Players | Negative ID range |
|---|---|---|
| Paraguay | Gamarra | -19 (existing) |
| Bosnia-Herzegovina | Celik | -20 |
| Canada | Alfie Jones | -21 |
| Curaçao | Bodack | -22 |
| Egypt | Fatouh, Abdulkarim, Lashin | -23, -24, -25 |
| Ghana | Thomas-Asante, Ati-Zigi | -26, -27 |
| Iran | Eiri, Dargahi, Hajsafi, Kanaani | -28, -29, -30, -31 |
| Iraq | Younis, Saadoon | -32, -33 |
| Jordan | Nasib, Badawi, Abu Hashish, Al Dawoud, Bani Attiah, Fakhoury | -34 to -39 |
| Morocco | El Kajoui | -40 |
| Qatar | Al Janhi, Al Alawi, Al Amin, Issa Lay, Manaai, Niall Mason | -41 to -46 |
| Saudi Arabia | Attia, Al Hajji | -47, -48 |
| Scotland | Tyler Fletcher | -49 |
| South Africa | Ndamane | -50 |
| South Korea | Cho Wije, Lee Kihyuk | -51, -52 |
| Tunisia | Dahmene, Ben Hamida, Ben Hassan | -53, -54, -55 |
| Türkiye | Tiknaz, Demiral | -56, -57 |
| Uzbekistan | Abdullaev, Nematov, Ganiev, Jaloliddinov, Urunov, Nasrullaev, Rakhmonaliev, Eshmuradov | -58 to -65 |

---

## Backstop

Even if step-by-step resolution is skipped, **`fn_award_top_scorer_points`** (fires after final, ~2026-07-19) reads `player_tournament_stats` which is aggregated by real `api_player_id`. As long as `top_scorer_pick.top_scorer_api_id` was cascaded to the real id before the final game, points award correctly.

**Risk = zero** for any placeholder where the player either:
- Never plays a minute (no scoring opportunity anyway), OR
- Plays at least once → captured by `/fixtures/players` → resolvable

The only failure mode: someone picks a placeholder, the player plays + scores, but we **forget to cascade**. → Operational discipline solves this. Build a check query that lists "placeholder picks where the player has appeared but pick.top_scorer_api_id is still negative" and run daily during tournament.

---

## Daily safety query (run during tournament)

```sql
-- Picks pointing to a negative id whose name has appeared in game_player_stats
SELECT
  tsp.user_id,
  tsp.group_id,
  tsc.player_name        AS picked_name,
  tsc.team_name,
  tsc.api_player_id      AS still_negative,
  gps.api_player_id      AS real_id_in_game_stats
FROM top_scorer_pick tsp
JOIN top_scorer_candidates tsc ON tsc.id = tsp.candidate_id
JOIN game_player_stats gps
  ON gps.team = tsc.team_name
 AND lower(unaccent(gps.player_name)) = lower(unaccent(tsc.player_name))
WHERE tsp.top_scorer_api_id < 0;
-- If non-empty → run resolve SQL above for those rows
```

---

## Files referenced

- `data/wc2026_squads.json` — source of truth for JSON state
- `supabase/migrations-prod/20260602000128_…sql` — applies this state to PROD DB
- `supabase/functions/football-api-sync/index.ts` v13 — `writeStats()` populates `game_player_stats`
- `memory/wc2026-squad-seed.md` — operational state
- `memory/lineup-resolve-runbook.md` — quick-reference per-game playbook
