---
name: manual-data-corrections
description: "When api-football revises stats after the one-shot sync, fix scoring-relevant gaps with a single-field manual UPDATE (not a re-sync); log in docs/MANUAL_DATA_CORRECTIONS.md"
metadata: 
  node_type: memory
  type: project
  originSessionId: ef073047-e11c-4c80-a614-14c5d2442f52
---

**Recurring pattern + playbook for hand-fixing PROD stat gaps.** Log file: `docs/MANUAL_DATA_CORRECTIONS.md` (commit each correction there).

**Why gaps happen:** `football-api-sync` writes stats ONCE at KO+120min then unschedules its crons. api-football **revises match data afterward** (normalizes minutes 94→90, revises ratings, adds late goal/assist attributions, tweaks team shots/corners/xG). Those revisions are never auto-picked-up. Classic symptom: a scorer present in `game_events` but `goals=0` in `game_player_stats` → **missing from Top Scorers** (the `player_tournament_stats` view sums `game_player_stats.goals`).

**Two flavours of the lag:**
- **goals** (`game_player_stats`) — player-stats block returns 0 for a scorer → missing from Top Scorers (functional, must fix).
- **team stats** (`game_team_stats`) — `Total passes` (`passes_total`/`passes_accuracy`) and `expected_goals` (`xg`) compute LATER than the score, so at sync they're NULL → blank on Game-page team stats (display-only). `writeStats` preserves NULL for these (no `?? 0`).

**Case 1 — 2026-06-14, Qatar 1–1 Switzerland** (`game aba02fa5…`, fixture `1489373`): Boualem Khoukhi (`api_player_id 2532`) scored but had `goals=0`. Fixed `UPDATE game_player_stats SET goals=1 WHERE game_id=… AND api_player_id=2532`. View → 1.

**Case 2 — 2026-06-14, Brazil 1–1 Morocco** (`game 2c551443…`, fixture `1489371`): `passes_total`/`passes_accuracy`/`xg` NULL for both teams. Filled via 2-row `UPDATE game_team_stats SET passes_total=…, passes_accuracy=…, xg=…`. `game_team_stats` has no event/player coupling → zero risk. Goals were fine.

**Case 3 — 2026-06-15, Ivory Coast 1–0 Ecuador** (`game 42d347e5…`, fixture `1489375`): Amad Diallo (`api_player_id 157997`) scored (in events) but `goals=0`. Fixed `UPDATE game_player_stats SET goals=1`. Same lag as Case 1.

**Case 5 — 2026-06-16, Iran 2–2 New Zealand** (`game 840b0883…`, fixture `1489378`): `passes_total`/`passes_accuracy`/`xg` NULL for both teams (same lag as Case 2). DEV `probe_stats` → Iran 405/77%/1.50, NZ 446/85%/1.24 (possession 48/52 + shots 17/14 matched existing rows). Filled via 2-row `UPDATE game_team_stats`. Display-only, zero scoring impact.

**Case 6 — 2026-06-17, Austria 3–1 Jordan** (`game 634786fd…`, fixture `1489382`): **Pattern A EXTREME — entire `game_player_stats` block empty (0 rows)**, so 3 scorers (Schmid `7562`, Arnautović `18830`, Olwan `164026`) absent from Top Scorers though goals were in events/history. Found via goal reconciliation (score 4 = events 4 ✓ but Σ player goals=0). **⚠️ NEW LESSON: PROD re-pull (`sync_stats`) returned 0 player rows 3× (status ok, no ef_errors) — PROD's api-football account returns an EMPTY `/fixtures/players` for this fixture, while DEV's account HAS the full 52-player block.** So PROD cannot self-heal; data was sourced from DEV `probe_stats` and INSERTed into PROD (51 rows; two id=0 bench players collapsed via `ON CONFLICT DO NOTHING`). Verified Σgoals=3, events still 4 (no dups), team rows 2, Top Scorers shows all 3. **When PROD writeStats writes 0 players but DEV probe has data → manual INSERT from DEV, don't keep re-pulling PROD.** (Olwan's api_id resolved from the DEV pull.)

**Case 4 — 2026-06-15, Spain 0–0 Cape Verde** (`game 3f1fdcdb…`, fixture `1489380`): DIFFERENT class — **team-name mismatch, not a stat revision** (see [[bosnia-team-name-mismatch]]). api stats endpoints returned `Cape Verde Islands`; canonical = `Cape Verde` → 27 rows stored unmatchable, CV stats column "—". Two-part fix: (1) EF football-api-sync **PROD v15** adds `TEAM_ALIASES` `cape verde islands→cape verde` (future games); (2) PROD backfill **rename in place, NOT re-pull**: `UPDATE game_player_stats/game_team_stats SET team='Cape Verde' WHERE game_id='3f1fdcdb…' AND team='Cape Verde Islands'` (26/1 rows, events=0). **Why rename not re-pull here:** data was complete, only mislabeled — and re-pull would DUPLICATE rows because `game_team_stats` upserts on `(game_id,team)` and `game_events` on a key incl. `team`, so a new canonical row orphans the old one. (Contrast Cases 1/3 where the missing field needed a value, not a relabel.)

**Reusable gap-scan for ALL missing/extra scorers** (run periodically — any row = investigate): per finished game compare scoring events vs player-stat goals sum:
```sql
WITH ev AS (SELECT game_id,count(*) c FROM game_events WHERE event_type='goal' AND detail IN ('Normal Goal','Penalty') GROUP BY game_id),
     ps AS (SELECT game_id,coalesce(sum(goals),0) g FROM game_player_stats GROUP BY game_id)
SELECT g.id, coalesce(ev.c,0) event_goals, coalesce(ps.g,0) playerstat_goals
FROM games g LEFT JOIN ev ON ev.game_id=g.id LEFT JOIN ps ON ps.game_id=g.id
WHERE g.score_home IS NOT NULL AND coalesce(ev.c,0) <> coalesce(ps.g,0);
```
As of 2026-06-15 after the Diallo fix: **zero gaps** across all finished games. NOTE: a 1-goal scorer not visible in Top Scorers is usually NOT a bug — the Picks Top-5 view uses a tie-aware cutoff at the 5th-place goal count (Picks.jsx ~252); when ≥? players have 2+ goals the cutoff rises above 1. Verify against the gap-scan before "fixing".

**Decision rule (manual UPDATE > re-sync):**
- A full live-api-vs-DB diff for that fixture showed **47 revised fields**, but **only `goals` is functional** (feeds Top Scorers + top-scorer pick points). `assists`/`minutes`/`rating`/team shots-corners-passes-xG are **display-only — no scoring/leaderboard logic reads them**.
- So fix the **single scoring field manually** (zero collateral, zero risk). Do NOT `sync_stats` re-pull just to refresh cosmetics — it rewrites all 47 fields AND re-pulls `/fixtures/events`, risking `game_events` duplication ([[game-events-duplication-risk]]).
- Manual fix is durable: api is now correct, so a future re-sync keeps the value.
- **Verify the api before touching the DB** via dev EF `probe_stats` (mode returns `/fixtures/players` with no DB write): `POST {mode:'probe_stats',fixture_id:N}` to the dev function (verify_jwt=false, key stays in EF env). Confirm the api now has the right number before correcting prod.

**How to read prod stats for a diff:** PROD project id = `asugxlvgcmkxspzokydk` (Frankfurt); dev = `ftryuvfdihmhlzvbpfeu`. Top-scorer source `player_tournament_stats` is a plain (non-materialized) view over `game_player_stats` → manual UPDATE reflects live, no refresh, no deploy.
