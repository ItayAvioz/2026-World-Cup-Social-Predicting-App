---
name: bosnia-team-name-mismatch
description: "Bosnia stats+scorer flag missing — api stores \"Bosnia & Herzegovina\" but canonical is \"Bosnia-Herzegovina\"; frontend exact-matches by name"
metadata: 
  node_type: memory
  type: project
  originSessionId: 96a9c962-1117-49bc-9399-b10242a99be6
---

**Found 2026-06-13.** Canada v Bosnia (game `c7a4521b`, 1-1): Match Stats column for Bosnia all "—", and scorer Jovo Lukić had no flag. **Single root cause = team-name mismatch between the api-sourced stats tables and the canonical name used everywhere else.**

**Canonical name = `Bosnia-Herzegovina` (hyphen)** in: `teams`, `games`, `top_scorer_candidates` (28 rows), and frontend `TEAMS` (lib/teams.js, flag `ba`).
**api-football stores `Bosnia & Herzegovina` (ampersand)** in the stats tables: `game_team_stats.team` (1 row) and `game_player_stats.team` → `player_tournament_stats` view (26 rows). Bosnia's stats DO exist (possession 40, shots 8, corners 4) — just under the wrong name string.

**Why it breaks both symptoms:**
- Game.jsx MATCH STATS matches `game_team_stats.team` to `games.team_away` ("Bosnia-Herzegovina") by **exact string** → no match → "—".
- Scorer flag (post-fix `TEAM_CODE[p.team]`, see [[scorer-flags-and-champion-row]]) keys on `player_tournament_stats.team` = "Bosnia & Herzegovina"; `TEAM_CODE` built from `TEAMS[].name` = "Bosnia-Herzegovina" → no flag. (The team-flag fix is correct — this is a DATA mismatch.)

**Why only Bosnia (Mexico/SK matched fine):** the EF `football-api-sync` HAS `normalizeTeam()` + `TEAM_ALIASES` map (`korea republic→south korea`, `cote divoire→ivory coast`, `turkiye→turkey`, etc.). normalizeTeam lowercases + strips non-alphanumeric (so "&" and "-" both vanish → both become "bosnia herzegovina") — BUT it's only used for **fixture-verify matching** (line ~555), NOT for the value **written** into the stats tables. Stats store the **raw api team name**. Bosnia is the first WC team whose raw api stats name ("Bosnia & Herzegovina") differs from the seed name by punctuation. **Recurrence risk: Bosnia plays 2 more group games** (Switzerland v Bosnia `59640b6d`, Bosnia v Qatar `173211d6`) → each re-stores the "&" name.

**Fix options:**
- **A — data backfill (immediate, prod):** `UPDATE game_team_stats SET team='Bosnia-Herzegovina' WHERE team='Bosnia & Herzegovina'` + same on `game_player_stats`. View auto-fixes; scorer flag + stats both render (team-flag change already live SW v41).
- **B — durable (sync-side):** stats-write path should store the **canonical DB games home/away name** (the sync already matched the fixture to the DB game) instead of the raw api name — OR add `"bosnia and herzegovina"`→`"bosnia-herzegovina"` style canonicalization to the stats writer. Prevents recurrence for Bosnia + any future team whose api stats name diverges. Pattern echoes [[topscorer-position-format]]: normalize data on every write.

**Status: ✅ FIXED 2026-06-13.**
- **Fix A (data backfill, prod):** `UPDATE game_team_stats/game_player_stats/game_events SET team='Bosnia-Herzegovina' WHERE team='Bosnia & Herzegovina'` → 1/26/1 rows. Verified: 0 bad rows remain, Bosnia team-stats row now == games.team_away, Jovo Lukić resolves to flag `ba`. Match-stats column + scorer flag now render. DEV had 0 such rows (no real WC games).
- **Fix B (durable, EF):** football-api-sync **PROD v14** — `writeStats` canonicalizes the stored team name via `canon()` (uses existing `normalizeTeam` to match api name → DB games team_home/away) for all 3 write sites; `rcBy` red-card lookup kept on raw api name. Deployed from the byte-verified deployed-v13 source (NOT the local WIP); fetched-back deploy diff = ONLY the canon change. Prevents recurrence for Bosnia's next 2 games + any future divergent team.
- ⚠️ **Local `supabase/functions/football-api-sync/index.ts` is a large uncommitted WIP rewrite** that does NOT contain the canon fix. NOT committed/deployed. When that WIP lands, it MUST re-add `canon()` **and** the `cape verde islands` alias (below). Committed only the `supabase/CLAUDE.md` doc note (commit on main).

**🔁 RECURRENCE 2026-06-15 — Cape Verde (same class, different team).** Spain 0–0 Cape Verde (game `3f1fdcdb…`, fixture 1489380): CV stats column "—". **canonical = `Cape Verde`**, but the api stats endpoints return **`Cape Verde Islands`** (a THIRD spelling — note `TEAM_ALIASES` already had `cabo verde→cape verde`, just not this one). **Key lesson on the v14 canon():** `canon()` only maps when `normalizeTeam(apiName)` already equals `normalizeTeam(DB name)`; on no-match it **falls through to the raw api name**. `normalizeTeam("Cape Verde Islands")` = `"cape verde islands"` ≠ `"cape verde"` → fell through → stored raw. So the durable fix for a divergent spelling lives in **`TEAM_ALIASES`, not `canon()` itself**. Fix = football-api-sync **PROD v15**: added `"cape verde islands":"cape verde"` (only that line vs v14; diacritic ranges rewritten `̀-ͯ`, identical). Smoke-tested OK. + PROD backfill (rename in place, NOT re-pull — re-pull duplicates `game_team_stats`/`game_events` on the team-key): `UPDATE game_player_stats/game_team_stats SET team='Cape Verde' WHERE game_id='3f1fdcdb…' AND team='Cape Verde Islands'` (26/1 rows; events=0). Full scan confirmed CV was the ONLY remaining mismatch tournament-wide. Verify alias holds after Uruguay v CV (Jun 21) + CV v Saudi (Jun 27) syncs. Logged in docs/MANUAL_DATA_CORRECTIONS.md ([[manual-data-corrections]]).
