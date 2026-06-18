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

---

## 2026-06-15 — Ivory Coast 1–0 Ecuador: missing goal (Amad Diallo)

**Game:** `42d347e5-e281-4d17-acdd-3f7afc74b769` · api_fixture_id `1489375`
**Symptom:** Ivory Coast scorer **Amad Diallo** missing from Top Scorers.

**Root cause:** same KO+120 player-stats lag as Khoukhi — `game_events` had
`Ivory Coast:A. Diallo/Normal Goal`, but his `game_player_stats` row was `goals=0`
(minutes also null), so he was absent from `player_tournament_stats`.
Live api (dev `probe_stats` fixture 1489375) now reports Diallo `goals=1`.

**Correction applied (PROD):**
```sql
UPDATE game_player_stats SET goals=1
 WHERE game_id='42d347e5-e281-4d17-acdd-3f7afc74b769' AND api_player_id=157997; -- Amad Diallo
```
Confirmed: row `goals=1`, view total_goals=1.

**Full-dataset verification (run this to find ALL such gaps):** compared, per finished
game, scoring events (`event_type='goal'` AND `detail IN ('Normal Goal','Penalty')`)
vs `SUM(game_player_stats.goals)`. After this fix, **every finished game matches**
(Diallo was the only remaining gap; Khoukhi already fixed). Tunisia (Omar Rekik) was a
false alarm — already correctly `goals=1`, just below nobody's cutoff; it shows fine.
```sql
-- gap scan: any row returned = a missing/extra scorer to investigate
WITH ev AS (SELECT game_id, count(*) c FROM game_events
            WHERE event_type='goal' AND detail IN ('Normal Goal','Penalty') GROUP BY game_id),
     ps AS (SELECT game_id, coalesce(sum(goals),0) g FROM game_player_stats GROUP BY game_id)
SELECT g.id, coalesce(ev.c,0) AS event_goals, coalesce(ps.g,0) AS playerstat_goals
FROM games g LEFT JOIN ev ON ev.game_id=g.id LEFT JOIN ps ON ps.game_id=g.id
WHERE g.score_home IS NOT NULL AND coalesce(ev.c,0) <> coalesce(ps.g,0);
```

---

## 2026-06-15 — Spain 0–0 Cape Verde: missing Cape Verde stats (team-name mismatch)

**Game:** `3f1fdcdb-2e6c-46d4-9e22-c1bfe1aeb587` · api_fixture_id `1489380`
**Symptom:** Cape Verde's column on the Game page showed "—" (team + player stats), and
its scorer flags were dropped. Spain rendered fine.

**Root cause:** the api's **stats endpoints** (`/fixtures/statistics`, `/fixtures/players`)
return the team as **`Cape Verde Islands`**, but the `games` table (and the frontend) use
the canonical **`Cape Verde`**. `writeStats` `canon()` normalizes both names and compares;
`TEAM_ALIASES` only had `cabo verde → cape verde`, not `cape verde islands → cape verde`,
so `canon()` found no match and **fell through to the raw api name**, storing 27 rows under
`Cape Verde Islands`. The frontend matches stats by the canonical name → no match → "—".
This is the same class as the Bosnia mismatch (memory `bosnia-team-name-mismatch`); the
data **was pulled correctly (26 players + 1 team row), only mislabeled**.

A full scan of every finished game found this was the **only** mismatched game in the
tournament (Bosnia already fixed).

**Fix — two parts (EF for the future, DB for the past):**

1. **EF (prevents recurrence)** — football-api-sync **PROD v15**: added one alias
   `"cape verde islands":"cape verde"` to `TEAM_ALIASES` (only that line changed vs v14;
   diacritic ranges rewritten as `̀-ͯ`, identical behavior). Now `canon()` maps
   the stats-endpoint spelling to `Cape Verde` at sync time. Covers the upcoming Cape Verde
   games — Uruguay (Jun 21, `e100e75f-…`) and Saudi Arabia (Jun 27, `73192fb4-…`).
   Smoke-tested (unknown-mode → `{"error":"Unknown mode"}`, loads clean).

2. **DB backfill (fixes the already-synced Spain game) — rename in place, NOT re-pull:**
```sql
UPDATE game_player_stats SET team='Cape Verde'
  WHERE game_id='3f1fdcdb-2e6c-46d4-9e22-c1bfe1aeb587' AND team='Cape Verde Islands';  -- 26
UPDATE game_team_stats SET team='Cape Verde'
  WHERE game_id='3f1fdcdb-2e6c-46d4-9e22-c1bfe1aeb587' AND team='Cape Verde Islands';  -- 1
-- game_events: 0 rows (0–0 game), nothing to do
```
Confirmed: 0 rows remain under `Cape Verde Islands`; both tables now read `Cape Verde`.

**Decision: rename vs re-pull.** The data was complete and correct, only the label was
wrong — a re-pull adds nothing and risks **duplicates**: `game_team_stats` upserts on
`(game_id, team)`, so a re-pull writing `Cape Verde` would orphan the old `Cape Verde
Islands` row (two rows); `game_events` keys on `team` too (same trap). A targeted UPDATE
fixes all rows in place with zero duplication and no api quota.

**Verify after Jun 21 / Jun 27 syncs** (alias holds in prod):
```sql
SELECT team, COUNT(*) FROM game_player_stats
WHERE game_id='e100e75f-8ba9-4248-a886-85433f7a62d5' GROUP BY team;  -- expect Uruguay + Cape Verde
```

> **EF source note:** the repo `supabase/functions/football-api-sync/index.ts` is an
> uncommitted WIP rewrite that matches **neither** deployed version (prod v15 / dev v39).
> The v15 alias fix was applied to the **live deployed prod source**, not the repo file.
> When the WIP rewrite eventually lands it must carry both the `cape verde islands` alias
> **and** `canon()` (see memory `ef-repo-not-source-of-truth`, `bosnia-team-name-mismatch`).

---

## 2026-06-16 — Iran 2–2 New Zealand: missing team stats (passes + xG)

**Game:** `840b0883-40c1-449b-b590-2a1a860cfc22` · api_fixture_id `1489378`
**Symptom:** Game-page MATCH STATS showed "—" for **Total Passes, % Accuracy Passes, and xG**
for both teams. Possession/shots/corners/cards all present and correct.

**Root cause:** same KO+120 lag as Brazil v Morocco (Case above) — `Total passes` and
`expected_goals` compute later than the score, so they were still NULL at sync time.
`writeStats` preserves NULL for these (no `?? 0`). **Pattern A** (api timing lag), not a
name issue — rows were under the correct team names, only three fields were NULL.
Goals/scorers were intact (2–2).

**Verification (read-only, DEV EF `probe_stats` fixture 1489378, no DB write):**
Iran passes 405 / 77% / xG 1.50; New Zealand passes 446 / 85% / xG 1.24. Possession (48/52)
and shots (17/14) matched the existing DB rows → same fixture, only passes/xG had lagged.

**Correction applied (PROD) — fill the NULLs only:**
```sql
UPDATE game_team_stats SET passes_total=405, passes_accuracy=77, xg=1.50
 WHERE game_id='840b0883-40c1-449b-b590-2a1a860cfc22' AND team='Iran';
UPDATE game_team_stats SET passes_total=446, passes_accuracy=85, xg=1.24
 WHERE game_id='840b0883-40c1-449b-b590-2a1a860cfc22' AND team='New Zealand';
```
Confirmed both rows now non-null. Touches only 2 `game_team_stats` rows (no events, no
player rows) → zero risk. Minor possession/shots drift, if any, left untouched (cosmetic).

**Decision:** minimal manual UPDATE over re-pull — display-only fields, no scoring impact;
a re-sync would rewrite all player rows + re-pull `/fixtures/events` (dup risk) to refresh
numbers no logic reads.

---

## 2026-06-17 — Portugal 1–1 DR Congo: missing DR Congo stats (team-name mismatch)

**Game:** `ed00190a-10c9-48c7-9669-e3a0771a9d95` · api_fixture_id `1539003`
**Symptom:** DR Congo's whole MATCH STATS column showed "—"; Portugal rendered fully.

**Root cause:** **Pattern B**, same class as Cape Verde / Bosnia. The api stats endpoints
return the team as **`Congo DR`**, but the `games` table / frontend use canonical **`DR Congo`**
(different word order → `normalizeTeam` gives `congo dr` ≠ `dr congo`). `TEAM_ALIASES` had no
entry, so `canon()` fell through to the raw api name → 28 rows stored under `Congo DR`. Data
was complete (26 players + 1 team row + 1 goal event), only mislabeled.

**Fix — two parts:**

1. **EF (prevents recurrence)** — football-api-sync **PROD v16**: added one alias
   `"congo dr":"dr congo"` to `TEAM_ALIASES` (only that line vs v15). Smoke-tested
   (unknown-mode → `{"error":"Unknown mode"}`). Covers DR Congo's future games.

2. **DB backfill (the already-synced game) — rename in place, NOT re-pull** (all 3 tables, incl. the 1 goal event so the scorer flag resolves):
```sql
UPDATE game_player_stats SET team='DR Congo' WHERE game_id='ed00190a-10c9-48c7-9669-e3a0771a9d95' AND team='Congo DR';  -- 26
UPDATE game_team_stats   SET team='DR Congo' WHERE game_id='ed00190a-10c9-48c7-9669-e3a0771a9d95' AND team='Congo DR';  -- 1
UPDATE game_events       SET team='DR Congo' WHERE game_id='ed00190a-10c9-48c7-9669-e3a0771a9d95' AND team='Congo DR';  -- 1
```
Confirmed: 0 rows remain under `Congo DR`; all three tables read `DR Congo`.

**Full-scan after fix:** re-ran the all-finished-games team-name mismatch scan → **empty**.
DR Congo was the only remaining mismatch tournament-wide (Bosnia + Cape Verde already fixed).

> Same EF-source caveat as v15: applied to the **live deployed prod source**, not the repo WIP.
> Running list of api-stats-spelling aliases now in `TEAM_ALIASES`: `cabo verde`,
> `cape verde islands`, `congo dr` (+ pre-existing cote divoire / korea republic / ir iran / turkiye / usa).

---

## 2026-06-17 — Austria 3–1 Jordan: entire player-stats block missing (Pattern A, extreme)

**Game:** `634786fd-0a48-4224-9b98-48e379fd3845` · api_fixture_id `1489382`
**Symptom:** 3 scorers (Schmid, Arnautović, Olwan) missing from **Top Scorers**, though all
goals showed in game **history** (events). Found via goal-reconciliation: score 4 = events 4 ✓,
but `SUM(game_player_stats.goals)` = 0 (should be 3).

**Root cause:** **Pattern A, extreme** — the api `/fixtures/players` block was empty at KO+120
sync, so **NOT A SINGLE `game_player_stats` row was written** for this game (0 rows, both teams).
Events + team stats + score were captured fine; only the per-player block was absent → the 3
real scorers were uncredited (the 76' own goal correctly needs no scorer row).

**⚠️ KEY FINDING — re-pull on PROD does NOT work for this fixture.** Ran `sync_stats` (the EF
re-pull) on PROD **3×** → each returned `status:ok` but **still 0 player rows** and **no
`ef_errors`** → PROD's api-football account returns an **empty `/fixtures/players`** for fixture
1489382. **DEV's api account, however, has the full 52-player block** (confirmed via DEV
`probe_stats`). So DEV and PROD api sources diverge for this fixture; **PROD cannot self-heal via
re-pull — the data must be inserted from the DEV pull.**

**Correction applied (PROD) — manual INSERT of the full block, sourced from DEV `probe_stats`:**
Generated a 52-row INSERT from the DEV pull (`scripts`-free: curl DEV probe → python → SQL),
applied to PROD with `ON CONFLICT (game_id,api_player_id) DO NOTHING`. **51 rows inserted** (two
Jordan bench players share api_id `0` → `DO NOTHING` collapses them to one; both non-playing,
goals 0 — negligible). Scorers: Romano Schmid `7562`=1, Marko Arnautović `18830`=1, Ali Olwan
`164026`=1 (**Olwan's api_id was previously unknown — resolved from the DEV pull**).

**Verified:** player_rows 51, `SUM(goals)`=3, team_rows 2 (unchanged), event_rows **4 (no dups)**,
no duplicate api_player_ids, and `player_tournament_stats` (Top Scorers) now shows all 3.

**Why INSERT-from-DEV, not re-pull:** the block was *empty* (not stale), so full insert has no
overwrite/dup risk on `game_player_stats`; and PROD's own re-pull returns nothing for this
fixture, so re-pull was simply ineffective. This is the first case where the **manual fix
sourced data from the DEV api** because PROD's api lacked it.

---

## 2026-06-17 — top_scorer_candidates: player-id verification + 27 corrections

**What:** Verified every `top_scorer_candidates.api_player_id` against the **real api ids in
match data** (`game_player_stats`, lineups of the 42 teams that have played). Quote-free, in-DB.

**Method:** match by `api_player_id` first (definitive), then full-name normalized (accent/
punctuation-stripped) against that team's lineup. Categorized the **active 26-man squads** on
played teams (1,092 players): **SAME (verified) 994 · COMPLETE (placeholder→real id) 23 ·
MISMATCH (wrong id) 18 · unconfirmable 57**.

**Applied — 27 safe corrections** (12 placeholder completions + 15 mismatch fixes), e.g.:
Lautaro Martínez `6000→217`, Frenkie de Jong `37524→538`, Bernardo Silva `119612→636`,
Almoez Ali `534032→2543`, Ao Tanaka `33142→32966`, Mikel Merino `-73→47311`, Diogo Costa
`-77→369`, Merih Demiral `-57→30521`, Lisandro Martínez `-69→2467`. Verified after:
SAME 994→**1021**, placeholders 74→**62**, **dup_ids 0** (UNIQUE(api_player_id) intact).

**⚠️ 14 NOT applied — UNIQUE(api_player_id) collisions.** Target id already on another candidate
row → either **duplicate seed entries** (same player, two spellings: "Ehsan Hajsafi"/"E. Hajisafi",
"Ahmed Fatouh"/"Ahmed Abou El Fotouh", "Abdallah Nasib"/"Abdallah Naseeb", "Khulumani Ndamane"/
"K. Ndamase", "El Hadji Malick Diouf"/"E. Diouf", "Zaid Ismail"/"Z. Ismaeel", "Danley Jean Jacques"/
"D. Jean-Jacques", "Mohannad Abu Taha"/"Mohammad Taha", "Mohammed Abu Al-Shamat"/"Saleh Abu Al Shamat")
or **tangled ids** ("Eric Garcia" holds Joan García's `182718`; "Abdullah Al Salem" holds Salem
Al-Dawsari's `44340`; "Mohanad Ali" holds Hussein Ali's `145465`; Brazil "Danilo Santos" holds
Danilo's `618`). These need manual paired/dedup resolution — deferred.

**57 unconfirmable** = active players not in any lineup yet (real players rotated/benched like
Neymar `276`, Darwin Núñez `51617`, Ronald Araújo `101814`, Gavi `1697` — ids likely fine just
unverified) + placeholders whose teams/players haven't appeared (Jurrien Timber, Hommam Al Amin,
Uzbekistan etc.). Resolvable only once they play, or via live-api lookup.

**Zero scoring impact:** no *picked* player (`top_scorer_pick`) had a placeholder or mismatched id
— confirmed earlier. Picks store their own `top_scorer_api_id`, scored vs `game_player_stats`, so
the candidate-table cleanup doesn't change any score.

**JSON:** regenerated `data/wc2026_squads.json` via `scripts/regen-squads-json.cjs` (mirrors PROD
active candidates 1:1) → 48 teams, 1,248 players, placeholders 60→**48**. Frontend Picks reads this
JSON, so the corrected ids reach the UI on next deploy.

---

## 2026-06-18 — Czech Republic 1–1 South Africa: missing Czech stats (team-name mismatch)

**Game:** `eb20c47e-f2c0-4834-b265-4ea07a32c998` · api_fixture_id `1539004`
**Symptom:** Czech Republic's whole MATCH STATS column "—", and the Czech scorer (Sadílek) lost
his flag/attribution on the Game page.

**Root cause:** **Pattern B**, new variant. The api returned the team as **`Czechia`** for this
fixture, but canonical = **`Czech Republic`**. 25 Czech player rows + 1 team-stat row + the
Sadílek goal event all stored under `Czechia` → frontend can't match → blank column + flagless
scorer. **api is INCONSISTENT:** the earlier South Korea v Czech Republic game stored
`Czech Republic` correctly; this game used `Czechia`. Both spellings now coexist in the DB.

**Goals were NOT mis-counted:** score 1–1, events = Sadílek (Normal 6') + Mokoena (Penalty 83'),
player-stat goals sum = 2 ✓. The only "goal" problem was the Czech scorer's flag dropping (he's
counted, just shown without his flag) — a display effect of the name mismatch.

**Fix — two parts:**
1. **EF v17:** added alias `"czechia":"czech republic"` to `TEAM_ALIASES` (only that line vs v16).
   Smoke-tested. Covers future Czech games even when the api flips to "Czechia".
2. **DB backfill (rename in place):** `game_player_stats` (25) + `game_team_stats` (1) +
   `game_events` (1): `'Czechia' → 'Czech Republic'`. Confirmed 0 `Czechia` rows remain; 25 Czech
   player rows now. Post-fix full mismatch scan across all finished games = **empty**.

> Running `TEAM_ALIASES` stats-spelling aliases (PROD v17): cabo verde, cape verde islands,
> congo dr, **czechia** (+ cote divoire / korea republic / ir iran / turkiye / usa).
> Same EF-source caveat: applied to the live deployed prod source, not the repo WIP.

