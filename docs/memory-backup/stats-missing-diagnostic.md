---
name: stats-missing-diagnostic
description: "Triage heuristic for missing Game-page stats — one field/player missing = api timing lag (fix the field); a whole team blank = team-name mismatch (data is in DB under wrong name, rename+alias)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 56ea34c0-49c9-40f4-9508-f542bca3427f
---

**Diagnostic model for "stats are missing on the Game page."** Two distinct root causes with different fixes — identify which before acting. Ties together [[manual-data-corrections]] (Pattern A) and [[bosnia-team-name-mismatch]] (Pattern B).

**Pattern A — a SPECIFIC field/player is missing** (one scorer `goals=0`; `passes_total`/`passes_accuracy`/`xg` NULL):
- **Cause:** api hadn't computed/attributed that value yet at sync time (KO+120). Sync writes once then unschedules → late api revision never auto-picked-up.
- **In DB:** the row EXISTS under the **correct team name**, only one field is `0`/`NULL`; surrounding data is fine.
- **Fix:** manual single-field `UPDATE` (verify live api first via DEV `probe_stats`). See [[manual-data-corrections]].

**Pattern B — a WHOLE TEAM is blank** (entire stats column "—", all that team's scorer flags gone, **but the other team renders perfectly**):
- **Cause:** team-name mismatch. api stored that team's stats under a **variant spelling** (e.g. `Cape Verde Islands` vs canonical `Cape Verde`, `Bosnia & Herzegovina` vs `Bosnia-Herzegovina`); frontend matches by exact canonical name.
- **In DB:** data is **fully present** (all players + team row, real non-null values) — just under the **wrong name string** → frontend can't match it.
- **Tell:** one whole team blank + other team perfect + the data is COMPLETE (not zero/null) when you look it up by the variant name.
- **Fix:** EF `TEAM_ALIASES` entry (future games, auto) + one-time PROD **rename** backfill (past game — NOT a re-pull, which duplicates on the team-key). See [[bosnia-team-name-mismatch]].

**ALWAYS verify against the live api in DEV FIRST (read-only, no DB write) before changing PROD.** Use the DEV `football-api-sync` EF in `probe_stats` mode — `POST {mode:'probe_stats', fixture_id:N}` to the dev function (verify_jwt=false; api key stays in the EF env). It returns `/fixtures/statistics` + `/fixtures/players` with NO write. Confirm BEFORE touching prod:
- **Pattern A:** the api now actually reports the right value (e.g. scorer `goals=1`, real `passes`/`xg`) — only then `UPDATE` the prod field.
- **Pattern B:** what spelling the api uses for the team (e.g. `Cape Verde Islands`) — confirms it's a naming issue and tells you the exact alias to add + name to rename from.

**Quick triage — look at the game's rows in `game_player_stats` / `game_team_stats`:**
- Rows under the RIGHT name but a field is `0`/`NULL` → **Pattern A** (timing) → fix the field.
- A whole team's rows under a DIFFERENT/variant name (other team fine) → **Pattern B** (naming) → rename + alias.
- Whole team genuinely **absent under ANY name** → rare third case (api truly didn't return it) → re-pull justified. But "whole team blank" is almost always Pattern B — **check the DB before re-pulling.**
- **ENTIRE game's `game_player_stats` empty (0 rows, both teams)** = Pattern A extreme — the api `/fixtures/players` block was empty at sync (scorers missing from Top Scorers, but goals present in `game_events`/history). ⚠️ **PROD `sync_stats` re-pull may STILL return 0** because the PROD api-football account can return an empty player block for a fixture even when **DEV's account has it** (verified Austria–Jordan 1489382, 2026-06-17: PROD re-pull 0×3, DEV probe = 52 players). In that case **don't keep re-pulling PROD — source the data from DEV `probe_stats` and INSERT into PROD** (`ON CONFLICT (game_id,api_player_id) DO NOTHING`; watch for shared api_id=0 bench players collapsing). DEV and PROD use different api keys/accounts with divergent data coverage. See [[manual-data-corrections]] Case 6.

PROD project id `asugxlvgcmkxspzokydk`; top-scorer source `player_tournament_stats` is a plain view over `game_player_stats` (manual UPDATE/rename reflects live, no refresh).
