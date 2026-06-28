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


---

## 2026-06-18 — Ghana 1–0 Panama: scorer missing from Top Scorers (timing lag)

**Game:** `1fa94b1f-d67b-4077-89aa-ba8d82e8577d` · api_fixture_id `1489385`
**Symptom:** Found in the end-of-round-1 full verification (25 finished group games). Ghana's only
goal (Caleb Yirenkyi) was in `game_events` but his `game_player_stats` row had `goals=0` →
reconciliation failed (Σ player goals 0 ≠ score 1) and he was **absent from Top Scorers**
(`player_tournament_stats` sums `game_player_stats.goals`).

**Root cause:** **Pattern A** timing lag (same class as Case 1 Khoukhi / Case 3 Diallo). api
attributed the goal in player stats after the KO+120 one-shot sync; never auto-picked-up. Team name
was correct (`Ghana`) — NOT a Pattern B mismatch.

**Verify-first (DEV probe):** `POST {mode:'probe_stats',fixture_id:1489385}` to the DEV
football-api-sync EF → Caleb Yirenkyi (`api_player_id 475575`) now reports **`goals: 1`** (rating
7.9, 90 min). Confirmed before touching PROD.

**Fix (single field, NOT a re-sync):**
`UPDATE game_player_stats SET goals=1 WHERE game_id='1fa94b1f-…' AND api_player_id=475575 AND goals=0`
(1 row). Post-fix: Σ player goals = 1 = goal_events 1 = score 1–0 ✓. Yirenkyi now in Top Scorers.
Display-only impact; prediction points were always correct (read from `games.score_home/away`).

> End-of-round-1 verification result (2026-06-18, all 25 finished group games): zero name
> mismatches, zero missing stat blocks, zero negative-id scorers, 24/25 reconciled — this was the
> single gap, now closed. Tournament total: 77 goals.

---

## 2026-06-18 — Player-id verification pass #2 (end of round 1, all 48 teams played)

Re-ran the active-candidate `api_player_id` audit vs real match data (`game_player_stats`) now that
all 48 teams have played. Denominator = 1248 active. Result: **SAME 1162 / COMPLETABLE 18 /
MISMATCH 6 / UNCONFIRMABLE 62**. Every id below was confirmed against `game_player_stats` ground
truth (api's own match name). Method = match by api_player_id, then accent-stripped full name;
UNIQUE(api_player_id) collisions resolved by **parking the duplicate/holder on a fresh negative
placeholder — never deleting inactive rows** (user rule).

**Applied 24 id changes (23 squad rows resolved + cascades), 0 collisions, 0 pick cascades**
(no `top_scorer_pick` referenced any affected name).

**A) 18 COMPLETABLE → 17 completed (1 held):**
- Free-id direct: Brandon Thomas-Asante (Ghana) → 82090; Abdullah Abdullaev (Uzbekistan) → 73418.
- Inactive-twin (active row gets real id; the variant-spelling inactive dup parked on −101..−111):
  Mario Pasalic (Croatia) 2763; Ahmed Fatouh (Egypt) 2649; Ehsan Hajsafi (Iran) 2685; Hossein
  Kanaani (Iran) 2687; Abdallah Nasib (Jordan) 310835; Mohannad Abu Taha (Jordan) 310785;
  Khulumani Ndamane (S.Africa) 474630; Abduvohid Nematov (Uzb) 73507; Oston Urunov (Uzb) 72127;
  Sherzod Nasrullaev (Uzb) 73514; Umarbek Eshmuradov (Uzb) 73510.
- Active tangle (id belonged to a DIFFERENT teammate → reassigned; displaced twin parked active+pending):
  Brazil **Danilo** → 618 (618 was wrongly on "Danilo Santos" → now −112 pending);
  Panama **Jose Luis Rodriguez** → 2979 (was on "Tomas Rodriguez" → −113 pending);
  Spain **Joan Garcia** → 182718 (was on "Eric Garcia" → −114 pending);
  Iraq **Hussein Ali** → 145465 + **Mohanad Ali** corrected 145465→154767 (both ids in match data).
- **HELD: Azizbek Ganiev (Uzbekistan)** — match id 73520 = "Azizjon Ganiev" (given-name diff) →
  later resolved in Group B below per user decision (treat as same player / seed typo).

**B) Name-discrepancy resolved per user OK:** Azizbek Ganiev (Uzb) −60 → 73520 (inactive
"A. Gʻaniyev" parked −118).

**C) 6 MISMATCH (wrong stored id → verified real id):**
- Safe (target free): Cristian Martínez (Panama) 554208→50911; Farrukh Sayfiev (Uzb) 532759→53830;
  Alejandro Zendejas (USA) 51248→35885 (match name "Alex Zendejas" — same player).
- Parked-dup: Danley Jean Jacques (Haiti) 237292→338367 (park "D. Jean-Jacques" −115);
  Zaid Ismail (Iraq) 72131→626479 (park "Z. Ismaeel" −116);
  El Hadji Malick Diouf (Senegal) 176541→409303 (park "E. Diouf" −117).

**STILL PENDING (Group A — real id unknown, parked active):** Brazil "Danilo Santos" (−112),
Panama "Tomas Rodriguez" (−113), Spain "Eric Garcia" (−114). Their stored id provably belonged to a
teammate; their own id isn't in match data yet → resolve when they appear (or via club lookup).

**Post-state:** active 1248, active placeholders 33 (was 48), all placeholders 62, no duplicate
api_player_id. `data/wc2026_squads.json` regenerated (placeholders 48→33). **Zero scoring impact** —
`top_scorer_pick` stores its own id and scores vs `game_player_stats`; no pick referenced any
affected player.

---

## 2026-06-19 — Player-id verification pass #2b: 7 more resolved (placeholders 33→26)

Follow-up to pass #2: a deeper name-scan (accent-strip + last-token LIKE against `game_player_stats`)
found that **7 active placeholders DID have their own id in match data**, under a spelling the
exact-name match missed — including the 3 "pending tangle twins" wrongly thought unfindable. Each
option id verified vs `game_player_stats` ground truth + UNIQUE-collision checked. 0 dup ids after,
0 pick cascades.

**7 resolved** (4 needed parking an inactive duplicate on −119..−122; never deleted):
- Brazil **Danilo Santos** → 275170 (park inactive "Danilo" −119) — its own id, distinct from captain Danilo 618.
- Panama **Tomas Rodriguez** → 57910 (free) — distinct from José Luis 2979.
- Spain **Eric Garcia** → 619 (free) — distinct from GK Joan García 182718 (note 618 Danilo / 619 Eric adjacency).
- Qatar **Hommam Al Amin** → 175439 ("Homam Al-Amin"; park inactive "Homam Ahmed" −120).
- Qatar **Issa Lay** → 366516 ("Issa Laye"; free).
- Saudi **Mohammed Abu Al Shamat** → 403087 ("Mohammed Abu Al-Shamat"; park inactive "Saleh Abu Al Shamat" −121).
- Saudi **Salem Al Dawsari** → 44340 ⚠️ star forward / scoring-relevant ("Salem Al-Dawsari"; was wrongly on inactive "Abdullah Al Salem" −122).

**Post-state:** active 1248, active placeholders 33→**26**, no dup ids. JSON regenerated (placeholders
26). **26 remaining placeholders = Group 2** (players whose team played but they were never fielded —
unused subs / not in matchday squad; no match-data id to verify). They auto-resolve when fielded;
list in session notes. Lesson: after a tangle reassign, RE-SCAN with a fuzzy (last-token) name match —
the displaced twin's real id is often already in match data under a variant spelling.

---

## 2026-06-19 — Switzerland 4–1 Bosnia: ROOT CAUSE of recurring Bosnia mismatch found + fixed

**Game:** `59640b6d-53f2-467f-b26e-5d84d2e069d5` · api_fixture_id `1539005` (round 2).
**Symptom:** Bosnia's whole MATCH STATS column "—" + scorer flags gone — AGAIN. User: "it happens
each game, doesn't make sense." It recurs on EVERY Bosnia game; aliases never helped. Found why.

**ROOT CAUSE (a real bug in `normalizeTeam`, not a missing alias):**
`normalizeTeam` does `.replace(/[^a-z0-9\s]/g,'')` — strips punctuation to the EMPTY string. So:
- DB `"Bosnia-Herzegovina"` → the hyphen (no surrounding spaces) is deleted with nothing in its
  place → **`"bosniaherzegovina"`** (two words FUSED, no space).
- api `"Bosnia & Herzegovina"` → the `&` HAS spaces around it → **`"bosnia herzegovina"`** (a space
  survives).
`"bosniaherzegovina"` ≠ `"bosnia herzegovina"` → `canon()` can't match either side → it falls
through to the raw api name and re-stores `"Bosnia & Herzegovina"` every single sync. Bosnia is the
only WC team whose canonical name contains a hyphen, which is why ONLY Bosnia recurs and why no
`TEAM_ALIASES` entry ever fixed it (the DB side normalized wrong too).

**Fix (two parts):**
1. **EF football-api-sync PROD v18** — added 2 `TEAM_ALIASES` entries that force BOTH normalized
   forms to the same key: `"bosnia herzegovina"→"bosnia-herzegovina"` AND
   `"bosniaherzegovina"→"bosnia-herzegovina"`. Now `normalizeTeam(api "Bosnia & Herzegovina")` and
   `normalizeTeam(DB "Bosnia-Herzegovina")` both = `"bosnia-herzegovina"` → `canon()` resolves to the
   DB games name. Durable for all future Bosnia games (next: Bosnia v Qatar, Jun 24). Smoke-tested OK.
   (Deeper option — change the punctuation strip from `''` to `' '` so hyphens become spaces — left
   for a future holistic cleanup; would also require re-keying the `cote divoire` alias. The alias
   fix is the surgical, low-risk choice consistent with v15–v17.)
2. **DB backfill (rename in place, NOT re-pull):** `game_player_stats` (26) + `game_team_stats` (1) +
   `game_events` (2): `'Bosnia & Herzegovina' → 'Bosnia-Herzegovina'`. 0 bad rows remain. Full
   tournament-wide mismatch scan = empty (Canada–Bosnia fix from 2026-06-13 still holding).

**Zero scoring impact** — score 4–1 correct, points always read from `games.score_home/away`; only
the display column + scorer flags were affected. ⚠️ Eyeball Bosnia v Qatar (Jun 24) to confirm v18
holds.

---

## 2026-06-19 — Proactive team-name audit: ALL 26 played fixtures, all 48 teams (DEV read-only)

Since all 48 teams have now played, ran a read-only DEV `probe_stats` sweep over **all 26 played
fixtures** to catch any hidden team-name variant BEFORE it breaks a future game. For each fixture,
pulled the api's team name from `/fixtures/statistics` + `/fixtures/players` and compared it
(normalized with the exact v18 alias map) to our canonical home/away.

**Result: 26/26 fixtures covered (both teams returned, no empty probes), 0 unmatched, 0 new aliases
needed.** v18 + existing aliases cover every spelling the api has used so far.

**The api spells exactly 6 teams differently from us — all already aliased:**
| Canonical | api spelling | alias since |
|---|---|---|
| Czech Republic | `Czechia` | v17 |
| Bosnia-Herzegovina | `Bosnia & Herzegovina` | v18 |
| United States | `USA` | (orig) |
| Turkey | `Türkiye` | (orig) |
| Cape Verde | `Cape Verde Islands` | v15 |
| DR Congo | `Congo DR` | v16 |

The other 42 teams: api spelling == our canonical. **Conclusion: all teams are safe for their
next games (round-3 group + knockouts).** The only residual risk is the unguessable "Czech-style
flip" — a team that has only sent its canonical spelling so far suddenly switching to a new variant
in a later game; the per-game eyeball still catches that. Scan method: DEV EF `probe_stats` per
`api_fixture_id`; normalize = lowercase + NFD strip + remove non-alnum + collapse + v18 aliases.

---

## 2026-06-23 — France 3–0 Iraq: missing team stats (passes + xG) — lightning-suspended game

**Game:** `40a6c1c4-ebdd-48fe-9259-1bf1bdc5a9b4` · api_fixture_id `1539017`
**Context:** match was **suspended by a lightning storm**, resumed, and finished FT 3-0. The
original KO+120 sync cron had fired during the interruption → api status `INT` ("Interrupted") →
EF logged `Terminal status INT` and **self-unscheduled** (refused to write a non-final score — correct
v35 safety behavior). So the game sat unscored.

**Initial pull (manual, after FT):** fired `mode=sync` directly via `net.http_post` (cron was gone) →
EF returned `score 3-0, api_status FT`. Wrote score + 2 team rows + 52 player rows + 3 goal events;
scoring trigger ran (all 53 predictions scored). **BUT** `passes_total`, `passes_accuracy`, `xg` came
back NULL for both teams — dev `probe_stats` confirmed the api had **not yet published** passes/xG
at that time (computed later than the score; common, and these compute even later for a
suspended/resumed match).

**Backfill (retry, api now had them):** dev EF `probe_stats` fixture 1539017 →
France passes 603 / 90% / xG 2.67, Iraq passes 481 / 86% / xG 0.63.

**Correction applied (PROD) — fill the 6 NULLs only:**
```sql
UPDATE game_team_stats SET passes_total=603, passes_accuracy=90, xg='2.67'
 WHERE game_id='40a6c1c4-ebdd-48fe-9259-1bf1bdc5a9b4' AND team='France';
UPDATE game_team_stats SET passes_total=481, passes_accuracy=86, xg='0.63'
 WHERE game_id='40a6c1c4-ebdd-48fe-9259-1bf1bdc5a9b4' AND team='Iraq';
```
Final verify: **0 NULL columns** remain in either team row; full game complete (3-0, 2 team / 52
player / 3 goal events / 1 odds / 53 predictions all scored). Goals Mbappé 2 + Dembélé 1; Iraq
yellow (Amir Al Ammari) captured at team + player level (yellows are never `game_events` rows — by
design that table holds goals + red cards only). Fixture id unchanged (1539017 = France v Iraq, FT).

**Decision:** minimal manual UPDATE over re-sync (same rationale as Brazil–Morocco). Left the trivial
possession drift (55/45 → api 56/44) untouched — populated, cosmetic, not "missing". UPDATE ran as
service-role via MCP (M132 authenticated-write lock does not apply). Display-only fields; no scoring
impact.

**New wrinkle vs prior cases:** the suspended→resumed flow means (a) the sync cron self-unschedules
on the `INT` status so the game needs a **manual re-pull after FT** (no auto-retry), and (b) passes/xG
land **even later** than usual — took a couple of retries before the api published them.

---

## 2026-06-24 — England 0–0 Ghana: missing team stats (passes + xG)

**Game:** `ec816c1d-451e-4551-b950-832a5838e1cb` · api_fixture_id `1489402`
**Symptom:** Game-page Match Stats showed **Total Passes / % Accuracy Passes / xG = "—"** for both
teams (all other fields populated). Routine passes/xG sync lag (same class as Brazil–Morocco, Iran–NZ,
France–Iraq) — not a suspended game.

**Verification (read-only, dev EF `probe_stats` fixture 1489402):** api now reports
England 633 / 93% / xG 1.36, Ghana 172 / 74% / xG 0.17.

**Correction applied (PROD) — fill the 6 NULLs only:**
```sql
UPDATE game_team_stats SET passes_total=633, passes_accuracy=93, xg='1.36'
 WHERE game_id='ec816c1d-451e-4551-b950-832a5838e1cb' AND team='England';
UPDATE game_team_stats SET passes_total=172, passes_accuracy=74, xg='0.17'
 WHERE game_id='ec816c1d-451e-4551-b950-832a5838e1cb' AND team='Ghana';
```
Final verify: **0 NULL columns** left in either team row; full game complete (0-0, 2 team / 52 player
rows / 0 goal events [correct for 0-0] / 53 predictions all scored). Display-only fields; no scoring
impact. Service-role write via MCP (M132 lock doesn't apply).

---

## 2026-06-26 — Jun-25 match-day: passes + xG missing on ALL 6 games (batch backfill)

**Symptom:** every game from the 2026-06-25 match-day showed Total Passes / % Accuracy / xG = "—"
for both teams. Same routine passes/xG sync lag, all 6 at once (they all synced before the api
published passing/xG).

**Games (all `passes_total`/`passes_accuracy`/`xg` NULL ×2 teams):**
| Game | fixture | game_id |
|---|---|---|
| Curaçao 0-2 Ivory Coast | 1489409 | `1346dae3-7a60-4898-8c75-95f0d9d68bb4` |
| Ecuador 2-1 Germany | 1489410 | `980990f1-66ae-4763-91dd-840ce8ef1b68` |
| Tunisia 1-3 Netherlands | 1489412 | `2e31a86a-d615-4458-ab26-cbbaacc780e6` |
| Japan 1-1 Sweden | 1539011 | `9a803937-2e31-4f48-9d8a-d1b993faea0e` |
| Paraguay 0-0 Australia | 1489411 | `ed232447-7531-4244-a2e5-f43edbea36e5` |
| Turkey 3-2 United States | 1539012 | `f69a79f9-b7e9-4d6a-9a36-32d95000be19` |

**Verification (read-only, DEV `probe_stats` per fixture):** values now published — Curaçao 355/83/0.50,
Ivory Coast 624/89/1.31; Ecuador 378/83/1.27, Germany 592/87/0.65; Tunisia 258/77/0.62, Netherlands
647/93/1.85; Japan 445/85/1.21, Sweden 395/79/0.64; Paraguay 427/77/0.25, Australia 536/82/0.57;
Turkey 435/77/3.21, United States 469/85/2.01.

**Correction applied (PROD):** 12 single-row `UPDATE game_team_stats SET passes_total/accuracy/xg`
(one per team per game). Verified all 6 games → **0 NULL** passes/accuracy/xg. Display-only; no scoring impact.

**Notes / wrinkles:**
- Turkey–USA api `probe_stats` returned a **500 on first attempt** (transient); a single retry succeeded.
- api spells that game's teams **`Türkiye` / `USA`**, but the canonical `game_team_stats` rows are
  `Turkey` / `United States` (EF canon()-izes on write) — so the `UPDATE … WHERE team='Turkey'/'United States'`
  matched correctly. Always key the manual UPDATE on the **DB/canonical** team name, not the api spelling.
- Batch tip: fire all `probe_stats` calls at once (`net.http_post` per fixture in one query), then read
  `net._http_response` once — much faster than one-at-a-time.

**⚠️ Plus a FUNCTIONAL gap the passes/xG check would have missed — caught by goal reconciliation:**
- **Japan 1-1 Sweden** (`9a803937…`): both scorers **Daizen Maeda (api 33224)** and **Anthony Elanga
  (api 153430)** had `game_player_stats.goals=0` (player-stats lag, same as Khoukhi/Diallo) → would be
  **absent from Top Scorers**. api now reports goals=1 each. Fixed:
  `UPDATE game_player_stats SET goals=1 WHERE game_id='9a803937…' AND api_player_id IN (33224,153430)`.
  Reconciles 2=2.
- **Tunisia 1-3 Netherlands** looked off (score 4 vs 3 normal-goal events) but is **correct**: minute-3
  **own goal** (Skhiri, credited to Netherlands) → 3 player goals + 1 OG = 4. No fix needed.
- **Lesson:** after backfilling passes/xG for a batch, ALWAYS run the goal-reconciliation scan
  (`score == Σ game_player_stats.goals + own-goal events`) on the same games — a missing-passes day
  often also has a missing-scorer game, and they're independent gaps.

---

## Case 11 — 2026-06-26, full-tournament re-verification (2 scorer-lag fixes)

**Trigger:** "review all games verify no missing data, verify all goals." Two read-only audit agents
swept all **60 finished PROD games**: (A) goal reconciliation + scorer-lag + empty-block + negative-id;
(B) team_stats row count + passes/xG NULLs + team-name mismatch + unscored predictions.

**Agent B (team-level): ALL CLEAN** — every finished game has exactly 2 `game_team_stats` rows, **zero**
NULL passes/accuracy/xg, zero team-name variants in either stats table (EF v18 alias fix holding), and
every prediction on a finished game is scored. Nothing to backfill on the display side.

**Agent A (goals): 2 functional gaps**, both the player-stats goal-lag class (scorer present in
`game_events`, `goals=0` in `game_player_stats` → missing from Top Scorers + reconciliation short by 1):

- **Switzerland 4–1 Bosnia-Herzegovina** (`59640b6d…`, fixture **1539005**): **Granit Xhaka (api 1464)**,
  penalty min 90, had `goals=0`. dev `probe_stats` 1539005 → goals:1 confirmed.
  `UPDATE game_player_stats SET goals=1 WHERE game_id='59640b6d…' AND api_player_id=1464`. Reconciles 5=5.
- **Panama 0–1 Croatia** (`b2ba3ec8…`, fixture **1489403**): **Ante Budimir (api 46746)**, normal goal
  min 54 (Croatia's only goal), had `goals=0`. dev `probe_stats` 1489403 → goals:1 confirmed.
  `UPDATE game_player_stats SET goals=1 WHERE game_id='b2ba3ec8…' AND api_player_id=46746`. Reconciles 1=1.

**After fixes:** full-tournament reconciliation scan → **0 remaining gaps** across all 60 finished games.

**Probe gotcha (logged so it isn't re-hit):** `app_edge_function_url` vault secret = base
`…/functions/v1` (NO function name), and the dev gateway needs an **`apikey` header** in addition to
`Authorization: Bearer`. Correct call:
`net.http_post(url:='https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/football-api-sync',
headers:=jsonb_build_object('Content-Type','application/json','apikey',<service_key>,'Authorization','Bearer '||<service_key>), body:=jsonb_build_object('mode','probe_stats','fixture_id',N))`.
Without `/football-api-sync` → 404; without `apikey` → 401 "No API key found".

---

## 2026-06-27 — Jun-26/27 match-day: 2 gaps (NZ–Belgium scorer-lag + Cape Verde whole-block 503)

**Trigger:** user reported the EF failed to pull a game's data (screenshot). Full-tournament scan
(team_stats rows/NULLs + goal reconciliation across every finished game) found exactly two gaps.

### A) New Zealand 1–5 Belgium — scorer missing (Pattern A timing lag)
**Game:** `5caade8c-f836-4517-8ff3-080f8a583d01` · api_fixture_id `1489415`
**Symptom:** reconciliation short by 1 (score 6, Σ player goals 5). **Alexis Saelemaekers (api 1417)**,
Belgium's 90' goal, had `game_player_stats.goals=0` → would be absent from Top Scorers. Same class as
Khoukhi/Diallo/Xhaka.
**Verify-first (DEV `probe_stats` 1489415):** api now reports Belgium scorers Trossard 2, De Bruyne 1,
**Saelemaekers 1**, Lukaku 1; NZ Just 1 → confirmed `goals=1`.
**Fix:** `UPDATE game_player_stats SET goals=1 WHERE game_id='5caade8c…' AND api_player_id=1417 AND goals=0`
(1 row). Reconciles 6=6. Display-only; no scoring impact (predictions read `games.score_home/away`).

### B) Cape Verde 0–0 Saudi Arabia — entire stats block missing (transient api 503)
**Game:** `73192fb4-e54e-40d4-9f8b-be0c28b885a1` · api_fixture_id `1489413`
**Symptom:** whole stats block absent — **0 `game_team_stats`, 0 `game_player_stats`, 0 events** (score
0–0 was written).
**Root cause:** the KO+120 sync (2026-06-27 02:00 UTC) hit a **transient api-football 503** during
`stats_write` — `ef_errors`: *"API error 503: upstream connect error or disconnect/reset before headers.
reset reason: connection termination"* (context `game_id 73192fb4…`). Stats fetch failed, the sync cron
self-unscheduled → no auto-retry. This is a one-time outage, **not** a PROD-account data gap.
**Verify-first (DEV `probe_stats` 1489413, read-only):** api has the full data — 50 players, 2 team rows,
no red cards. ⚠️ api spells the team **`Cape Verde Islands`** (Pattern B) → canonicalized to **`Cape Verde`**.
**Fix — manual INSERT from DEV probe (PROD EF has no `probe_stats` mode → "Unknown mode"; cannot self-heal):**
- `game_team_stats` — 2 rows: Cape Verde (poss 51, shots 15/2, corners 4, fouls 10, YC 1, off 2, ins 9,
  xG 1.46, passes 451/85%) · Saudi Arabia (poss 49, shots 7/3, corners 2, fouls 16, YC 3, off 0, ins 5,
  xG 0.40, passes 442/81%).
- `game_player_stats` — 50 rows from the DEV probe (`api_player_id`/`player_name`/canonical `team`/
  `minutes_played`/`position`; `goals=0` for all — 0–0 game). Display cols not returned by the probe
  (assists/cards/rating/gk) left NULL. `ON CONFLICT DO NOTHING` (no pre-existing rows).
- `game_events` — none (0–0, no red cards).
**Verify:** 2 team rows (Cape Verde, Saudi Arabia), 50 player rows (24 CV / 26 SA), Σ goals 0. Zero
scoring impact (0–0). Why INSERT-from-DEV not a re-sync: respects the read-DEV / write-PROD-by-hand
workflow, and the probe confirmed the data exists; PROD EF lacks the probe mode and the block was empty
(no overwrite/dup risk).

**Follow-up — display-field backfill (assists/cards/rating):** the original insert only had
goals/minutes/position because `probe_stats` returned a thin shape. The team stats showed yellow cards
(CV 1 / SA 3), so the per-player block had to carry them. **Extended the DEV `probe_stats` mode to
return the full per-player fields** (assists, yellow_cards, red_cards, rating, gk_saves, gk_conceded) —
**DEV football-api-sync v44**, an *additive read-only* change (reads api, returns JSON, writes nothing;
all other behavior byte-identical to v43; existing thin-shape callers unaffected). Re-probed 1489413 on
DEV, then `UPDATE game_player_stats … FROM (VALUES …)` keyed on `api_player_id` for the 50 PROD rows.
**Verify:** 4 players with yellow cards summing to 4 = team-stat YC (CV 1 / SA 3); 31 players with
ratings (rest = unused subs, api returns null — normal); **0 rows with an all-NULL display block**. Game
now fully complete. (gk_saves/gk_conceded came back NULL from the api for this fixture — that's the
source value, not a gap.)

**Post-fix full re-scan (all finished games): 0 team_stats gaps, 0 goal-reconciliation gaps.**
Two read-only audit agents (goals/player-completeness + team-stats/predictions/names/KO) swept all 66
finished games → fully clean; the only display-incomplete game was this Cape Verde one, now resolved.

---

## 2026-06-28 — End-of-group-stage full audit: Algeria 3–3 Austria scorer-lag (Kalajdžić)

**Trigger:** "review all game data… verify no missing, all group stage completed." Two read-only audit
agents swept the whole tournament. **Group stage = 100% complete (72/72 finished + scored)**; 16 R32 rows
staged & unplayed. Team-stats / player-completeness / names / predictions / odds / red-cards / events all
CLEAN. Exactly ONE functional gap found.

**Game:** `025fa947-9ff4-40dd-8e48-5428765f5cf7` · api_fixture_id `1489418` (group MD3 — note: 1489418 is a
GROUP game, not R32, per the old 1489xxx id block).
**Symptom:** Pattern A scorer-lag. Score 3–3, all 6 goals in `game_events` (Algeria: Belghali 45', Mahrez
60'+90'; Austria: Arnautović 28', Sabitzer 55', **Kalajdžić 90'**), but Σ `game_player_stats.goals` = 5 →
**Saša Kalajdžić (api 7722)** had `goals=0` (minutes 1, late sub) → his goal dropped from Top Scorers.
**Verify-first (DEV `probe_stats` 1489418):** api now reports Austria Sabitzer 1, Arnautović 1, **Kalajdžić 1**
(+ Algeria Mahrez 2, Belghali 1). Confirmed before touching PROD.
**Fix:** `UPDATE game_player_stats SET goals=1 WHERE game_id='025fa947…' AND api_player_id=7722 AND goals=0`
(1 row). Reconciles 6=6. Display-only impact (Top Scorers tally); prediction/score points were always correct.
