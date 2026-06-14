# Manual Data Corrections (PROD)

Log of **hand-applied corrections to the PROD database** that bypass the normal
`football-api-sync` Edge Function pipeline. Each entry records what was changed,
why, and why a manual UPDATE was chosen over a full re-sync.

> **Why this file exists:** api-football revises match data after the fact. Our
> sync writes once (at KO+120min) and unschedules its crons, so late api
> revisions are never picked up automatically. When a revision matters (i.e. it
> affects scoring), we correct it by hand and record it here.

---

## 2026-06-14 — Qatar 1–1 Switzerland: missing goal (Boualem Khoukhi)

**Game:** `aba02fa5-5a9b-46aa-811f-7b3b7ab2dcee` · api_fixture_id `1489373`
**Symptom:** Qatar scorer **Boualem Khoukhi** did not appear in the Top Scorers list.

**Root cause:** at sync time (KO+120min) api-football's *player-statistics* block
returned `goals=0` for the entire Qatar squad (data lag), while the *fixtures/events*
block already had Khoukhi's goal. `writeStats` faithfully wrote `goals=0`.
The Top Scorers list (`player_tournament_stats` view) sums
`game_player_stats.goals`, so Khoukhi summed to 0 and was hidden.
`game_events` already contained his goal, so the Game-page scorer display was correct.

**Verification (read-only, via dev EF `probe_stats`, no DB writes):**
The live api **now reports `Khoukhi goals=1`** — the source self-corrected after the match.

**Correction applied (PROD):**
```sql
UPDATE game_player_stats SET goals = 1
WHERE game_id = 'aba02fa5-5a9b-46aa-811f-7b3b7ab2dcee'
  AND api_player_id = 2532;   -- Boualem Khoukhi
```
Confirmed: `game_player_stats.goals=1` and `player_tournament_stats` total_goals=1.

### Decision: manual UPDATE vs full re-sync

A full diff (live api vs PROD DB for this fixture) showed the api had revised
**47 fields**, not just the goal:
- `goals` Khoukhi 0→1 (**the only field that affects scoring**)
- `assists` Homam Al-Amin 0→1, ~broad `minutes` 94→90, ~15 `rating` changes,
  Switzerland team `shots 25→26 / corners 9→10 / passes 569→575 / xG 3.15→3.24`.

**Only `goals` is functional** (feeds Top Scorers + top-scorer pick points). All
other diffs are **display-only** — nothing reads them for points, ranks, or
champion/top-scorer awards.

**Chosen: manual single-field UPDATE.** Rationale:
- Fixes the only real problem with **zero collateral and zero risk**.
- A re-sync would rewrite 47 cosmetic fields **and** re-pull `/fixtures/events`,
  which carries a `game_events` duplication risk (see memory
  `game-events-duplication-risk`). Not worth it to refresh numbers no logic depends on.
- The manual fix is durable: the api is now correct, so any future re-sync keeps `goals=1`.

**If polished display stats are ever wanted:** run `sync_stats` (one game) **then
verify `game_events` stayed at exactly 2 goal events**. Optional polish, not required.

---

## 2026-06-14 — Brazil 1–1 Morocco: missing team stats (passes + xG)

**Game:** `2c551443-76d1-40f6-95f4-d68349b98d83` · api_fixture_id `1489371`
**Symptom:** Game-page team stats showed blanks — **`passes_total`, `passes_accuracy`, and `xg` were NULL** for both teams.

**Root cause:** at KO+120 sync, api-football had not yet populated **Total passes** and
**expected_goals** for this fixture (both compute later than the score). `writeStats`
preserves NULL for these (no `?? 0`), so they were stored blank. The api now has them.
Goals/scorers were intact (Vinícius Júnior 1, I. Saibari 1) — this was stats-only.

**Verification:** dev EF `probe_stats` (fixture 1489371) → Brazil passes 501 / 88% / xG 1.24,
Morocco passes 432 / 87% / xG 1.28.

**Correction applied (PROD) — minimal, fill the NULLs only:**
```sql
UPDATE game_team_stats SET passes_total=501, passes_accuracy=88, xg=1.24
 WHERE game_id='2c551443-76d1-40f6-95f4-d68349b98d83' AND team='Brazil';
UPDATE game_team_stats SET passes_total=432, passes_accuracy=87, xg=1.28
 WHERE game_id='2c551443-76d1-40f6-95f4-d68349b98d83' AND team='Morocco';
```
Confirmed both rows now non-null. Touches only 2 `game_team_stats` rows (no events, no
player rows) → zero risk.

**Decision:** minimal manual UPDATE over re-pull. Re-sync would rewrite team + all 51
player rows + re-pull `/fixtures/events` (dup risk) just to refresh display-only stats.
Left the minor possession/shots/corners drift (52→54, 13→12, etc.) untouched — not
"missing", purely cosmetic. Display-only fields; no scoring impact.

