# PLAN_KNOCKOUT_FIXES.md

Knockout-game correctness sprint — 4 bugs found 2026-05-30 while validating dev's PSG-Arsenal ET+pens test fixture (`game_id=ab8b2b63-2563-4d5d-8b4b-c9f7b546cc23`, `api_fixture_id=1544371`).

**Scope:** Knockout-only fixes. Group stage already verified working on dev + prod; all 4 fixes are surgically gated on `phase <> 'group'` or shootout-specific timing markers (`time.elapsed=120 AND time.extra IS NOT NULL`). **Zero group-stage code paths touched.**

**Target window:** Jun 15–25 2026 (between group-stage launch on Jun 11 and first knockout on Jun 27).

**Test fixture (single source of truth):** dev game `ab8b2b63-2563-4d5d-8b4b-c9f7b546cc23` (PSG 1–1 Arsenal, 90min → ET 0–0 → Pens 4–3 → PSG wins).

---

## Rollout rules

1. **Dev first, prod second.** Every change goes to dev via `apply_migration` / `deploy_edge_function`, gets validated against PSG-Arsenal, then forward-ported to prod via the same MCP tools (same SQL/code, same migration name).
2. **Each bug = independent commit.** No bundling. If one needs to be rolled back, the others stand.
3. **No frontend deploy without backend ready.** Frontend changes (Bug 3, Bug 4) require backend (EF + DB) to be in dev first.
4. **Verify against PSG-Arsenal before promoting to prod.** A migration that "looks right" but doesn't fix the actual broken state is worse than no migration.

---

## Bug 4 — Penalty shootout shots misclassified as goals **(IMPLEMENT FIRST)**

**Why first:** Bug 3's display fix depends on this. Without correct event classification, the scorers section will keep showing shootout shots.

### Root cause
`football-api-sync.writeStats()` classifies any `{type:'Goal', detail:'Penalty'}` as `event_type='goal'`. api-football returns penalty SHOOTOUT shots with the same shape, distinguishable only by `time.elapsed=120 AND time.extra IS NOT NULL`. Result: 7 PSG-Arsenal shootout shots are stored as in-play goals, polluting the scorers list and making the "real" goal count wrong.

### Implementation

**Step 4.1 — Schema migration (dev + prod)**
File: `supabase/migrations/20260615000121_game_events_expand_event_types.sql`
```sql
ALTER TABLE public.game_events DROP CONSTRAINT IF EXISTS game_events_event_type_check;
ALTER TABLE public.game_events ADD CONSTRAINT game_events_event_type_check
  CHECK (event_type IN (
    'goal','red_card',
    'penalty_missed',              -- in-play missed penalty (new)
    'penalty_shootout_scored',     -- successful shootout kick (new)
    'penalty_shootout_missed'      -- failed shootout kick (new)
  ));
```

**Step 4.2 — Probe api-football for shootout shape (one-time read)**
Need to confirm whether api-football returns MISSED shootout shots and what their `detail` value is. Run on dev:
```sql
SELECT net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_edge_function_url') || '/football-api-sync',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_service_role_key')),
  body := jsonb_build_object('mode', 'probe_stats', 'fixture_id', 1544371)
);
```
Then `SELECT * FROM net._http_response WHERE id=<id>` and inspect the events. Note any `detail` values seen at `elapsed=120` (likely candidates: `Missed Penalty`, `Penalty`, `Saved`).

**Step 4.3 — EF update**
Deploy football-api-sync vNEXT to dev. Change `writeStats` event classification:
```ts
for (const ev of eventsRaw) {
  const type   = ev.type   as string
  const detail = ev.detail as string
  const elapsed = ev.time?.elapsed ?? 0
  const extra   = ev.time?.extra
  const isShootout = elapsed === 120 && extra != null  // shootout = 120+N format

  let event_type: string | null = null
  if (type === 'Goal') {
    if (detail === 'Normal Goal' || detail === 'Own Goal') {
      event_type = 'goal'
    } else if (detail === 'Penalty') {
      event_type = isShootout ? 'penalty_shootout_scored' : 'goal'
    } else if (detail === 'Missed Penalty') {
      event_type = isShootout ? 'penalty_shootout_missed' : 'penalty_missed'
    }
  } else if (type === 'Card' && ['Red Card', 'Second Yellow card'].includes(detail)) {
    event_type = 'red_card'
  }
  if (!event_type) continue
  eventRows.push({ /* same shape, new event_type */ })
}
```

**Step 4.4 — Backfill PSG-Arsenal events**
After EF update lands, re-run sync_stats:
```sql
SELECT net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_edge_function_url') || '/football-api-sync',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_service_role_key')),
  body := jsonb_build_object('mode', 'sync_stats', 'game_id', 'ab8b2b63-2563-4d5d-8b4b-c9f7b546cc23')
);
```
Alternative one-shot UPDATE if probe shows shootout-only `detail='Penalty'`:
```sql
UPDATE game_events
SET event_type = 'penalty_shootout_scored'
WHERE event_type = 'goal' AND detail = 'Penalty'
  AND minute = 120 AND minute_extra IS NOT NULL;
```

### Test plan
- [ ] `SELECT event_type, COUNT(*) FROM game_events WHERE game_id='ab8b2b63...' GROUP BY event_type;`
  Expected: `goal=2, penalty_shootout_scored=7` (or 7 split into scored/missed if api returns misses)
- [ ] No row in `game_events` for this game with `event_type='goal' AND minute=120 AND minute_extra IS NOT NULL`
- [ ] Run a fresh in-play penalty in dev (find any league/season game with a 65th-minute pen via probe_stats) and confirm it still classifies as `goal` (NOT shootout)
- [ ] CHECK constraint accepts all 5 new values via test INSERT (rolled back)
- [ ] CHECK constraint rejects an invalid value via test INSERT (expect error)

### Risk
- Group games: `time.elapsed` never exceeds ~90+extra, never 120, so `isShootout=false` always. Group-game goal classification unchanged.
- Existing rows: 'goal' and 'red_card' values still valid in expanded CHECK.
- Predictions/scoring: read `score_home/away` only, ignore `game_events` entirely. **Zero impact on points.**
- Rollback: revert EF to v36, restore CHECK to original. Existing rows with new event_types would need cleanup if we rolled back AFTER backfill — write rollback migration just in case.

### Rollback migration
File: `supabase/migrations/20260615000121_REVERT.sql` (write but don't apply unless needed)
```sql
UPDATE game_events SET event_type='goal' WHERE event_type IN ('penalty_shootout_scored','penalty_shootout_missed','penalty_missed');
ALTER TABLE game_events DROP CONSTRAINT game_events_event_type_check;
ALTER TABLE game_events ADD CONSTRAINT game_events_event_type_check CHECK (event_type IN ('goal','red_card'));
```

---

## Bug 3 — ET-score display is confusing **(IMPLEMENT SECOND)**

**Why second:** Depends on Bug 4 so the "scorers" section doesn't contain 120+N shootout entries anymore.

### Root cause
The DB stores `et_score_home/away` as **ET-only delta** (0 here because no goals in ET). Display shows "E.T. 0-0" — technically correct, perceived as wrong because user expects cumulative through 120 min.

### Implementation

**Step 3.1 — Game.jsx label fix**
Replace `E.T. {et_h}–{et_a}` with `After ET: {score_h + et_h}–{score_a + et_a}`. Add small subscript "(ET +{et_h}–{et_a})" for transparency. Adjust scorers section to filter `event_type='goal'` only (Bug 4 fix lets this be clean).

New section under "Pens X-Y" (only when `went_to_penalties=true`):
```
Penalty shootout:
PSG       Arsenal
  ✓ Ramos    ✓ Gyokeres
  ✓ Doue     ✓ Rice
  ✓ Hakimi   ✓ Martinelli
  ✓ Beraldo  — Saka (missed)
```
Read from `game_events WHERE event_type IN ('penalty_shootout_scored','penalty_shootout_missed') ORDER BY minute_extra, team`.

### Test plan
- [ ] PSG-Arsenal page shows: `1–1 FT` · `After ET: 1–1 (ET +0–0)` · `Pens 4–3`
- [ ] Scorers section shows only Havertz 6', Dembele 65' (pen) — no 120+N entries
- [ ] Penalty shootout section shows 7 shots (4 PSG ✓, 3 Arsenal ✓, plus any Arsenal miss if api returns it)
- [ ] Group game (any West Ham vs Arsenal) renders unchanged: no "After ET" or "Penalty shootout" sections, scorers list intact

### Risk
- Pure frontend, no schema/EF change
- Group games: `went_to_extra_time IS NULL` → ET/pens sections not rendered → identical to today
- Rollback: revert Game.jsx commit

---

## Bug 2 — AI summary fires at KO+150min before knockout_winner is set **(IMPLEMENT THIRD)**

**Why third:** Needed for first knockout match-day (Jun 27). Lower urgency than Bug 4/3 because no live impact until then.

### Root cause
`fn_schedule_ai_summaries` uses `MAX(kick_off_time) + 150 min` for every match-day. Knockout games can run KO+0 → KO+~200min (90 + HT + ET + break + pens + sync write). The AI summary fires at +150 → reads incomplete data (no `knockout_winner`, no ET/pen scores).

### Implementation

**Step 2.1 — fn_schedule_ai_summaries: knockout-aware delay**
```sql
v_fire_at := v_day.last_kickoff +
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.games g
      WHERE (g.kick_off_time - interval '7.5 hours')::date = v_day.game_date
        AND g.phase <> 'group'
    ) THEN interval '210 minutes'
    ELSE interval '150 minutes'
  END;
v_push_at := v_day.last_kickoff +
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.games g
      WHERE (g.kick_off_time - interval '7.5 hours')::date = v_day.game_date
        AND g.phase <> 'group'
    ) THEN interval '220 minutes'
    ELSE interval '160 minutes'
  END;
```

**Step 2.2 — nightly-summary EF defense-in-depth pre-check**
Before processing groups, check no knockout game is unresolved:
```ts
const { data: koPending } = await supabase.from('games')
  .select('id, team_home, team_away')
  .gte('kick_off_time', dayStart).lt('kick_off_time', dayEnd)
  .neq('phase', 'group')
  .is('knockout_winner', null)
  .not('score_home', 'is', null)
if (koPending && koPending.length > 0) {
  return json({ reason: 'ko_unresolved', pending: koPending, defer_to: 'next_safety_cron' })
}
```

### Test plan
- [ ] After applying migration, query: `SELECT command FROM cron.job WHERE jobname LIKE 'ai-summary-2026-06-27-%' LIMIT 1;` — schedule should be `MAX(KO) + 210 min`, not +150
- [ ] Insert a test future knockout game for tomorrow, then `SELECT fn_schedule_ai_summaries()` — verify the cron schedule for tomorrow uses 210 min
- [ ] Insert a test future group-stage game for a different day, then re-run — verify that day's cron uses 150 min (unchanged)
- [ ] Manually call nightly-summary EF for PSG-Arsenal's date BEFORE running sync → should return `ko_unresolved`
- [ ] Manually call nightly-summary EF for the same date AFTER sync completes → should process normally

### Risk
- Group-only days: CASE evaluates to ELSE branch → 150 min unchanged → byte-identical behavior
- Mixed days (group + knockout same day, only possible on Jun 27 + R16 dates): pushes summary 60 min later → ~01:30 IL instead of 00:30 IL — acceptable
- Push notification timing: also delayed 60 min on knockout days — accepted trade-off for correctness
- Rollback: revert function definition + redeploy EF v35

---

## Bug 1 — Dashboard hides knockout game after 90-min score writes **(IMPLEMENT LAST)**

**Why last:** Cosmetic / UX bug. Game IS being scored correctly by sync EF (just invisible to user during ET/pens). Lower priority than data-correctness fixes.

### Root cause
`get_dashboard_payload`: gating condition `score_home IS NULL` means as soon as 90-min score is written, the game stops counting as "today's" and dashboard jumps to next day. Knockout games in ET/pens become invisible while still live.

### Implementation

**Step 1.1 — get_dashboard_payload migration**
```sql
-- Replace the two existing EXISTS checks:
IF EXISTS (
  SELECT 1 FROM games
  WHERE ((kick_off_time AT TIME ZONE 'UTC') - interval '7.5 hours')::date = v_today
    AND (
      score_home IS NULL
      OR (phase <> 'group' AND knockout_winner IS NULL)
    )
) THEN
  v_day_date := v_today;
ELSE
  SELECT MIN(((kick_off_time AT TIME ZONE 'UTC') - interval '7.5 hours')::date)
  INTO v_day_date
  FROM games
  WHERE ((kick_off_time AT TIME ZONE 'UTC') - interval '7.5 hours')::date > v_today;
END IF;
```

**Step 1.2 — Dashboard.jsx LIVE badge enhancement**
For knockout games with `score_home IS NOT NULL AND knockout_winner IS NULL`:
- Show badge "LIVE — Extra Time" or "LIVE — Penalties" depending on `went_to_penalties`
- Continue showing through KO+4h safety cap (matches the EF sync hard-stop window)

### Test plan
- [ ] Set a dev test game to `score_home=1, score_away=1, phase='r16', knockout_winner=NULL, kick_off_time=now()-90min` → dashboard shows it
- [ ] Set `knockout_winner='Team A'` on same game → dashboard moves on to next day (correct)
- [ ] Group-stage finished game (`phase='group', score_home NOT NULL`) → dashboard moves on (unchanged behavior)
- [ ] Knockout game with `kick_off_time > now() + 4h` → dashboard shows correctly via next-day logic (no leak into past)

### Risk
- Group games: `phase = 'group'` → second OR clause is `false` → behavior identical to today
- Future-date jump logic untouched
- Rollback: revert function definition

---

## Sequencing summary

| Order | Bug | Surface | Verify against | Days |
|---|---|---|---|---|
| 1 | Bug 4 — event classification | DB CHECK + EF + backfill | PSG-Arsenal event counts | 2 |
| 2 | Bug 3 — ET display + shootout list | Game.jsx only | PSG-Arsenal Game page render | 1 |
| 3 | Bug 2 — AI summary delay + EF pre-check | `fn_schedule_ai_summaries` + EF | Schedule next dummy KO date | 2 |
| 4 | Bug 1 — Dashboard visibility | `get_dashboard_payload` + Dashboard.jsx | Manual state injection on dev | 1 |

Total: 6 dev-days. Suggested wall clock: **Jun 15–22** (with 3-day buffer Jun 23–26 before Jun 27 first KO).

---

## Promotion path (dev → prod)

Every fix follows the same recipe used in the parity sweep:
1. Apply migration in **dev** via `mcp__supabase__apply_migration`
2. Deploy EF in **dev** via `mcp__supabase__deploy_edge_function`
3. Verify against PSG-Arsenal (see per-bug test plans)
4. Backfill if applicable (e.g., PSG-Arsenal events for Bug 4)
5. Apply **same migration name** to prod via `mcp__supabase__apply_migration`
6. Deploy **same EF source** to prod via `mcp__supabase__deploy_edge_function`
7. Spot-check prod with a probe (no real KO games on prod yet, so no backfill needed)
8. Commit: include both the migration file (lives in `supabase/migrations/` since it's common) and the EF source. One commit per bug.

**No `migrations-prod/` files needed** — all 4 fixes are common (apply to both envs).

---

## Files affected (full inventory)

### New migrations (common — applied to both envs)
- `supabase/migrations/20260615000121_game_events_expand_event_types.sql` (Bug 4)
- `supabase/migrations/20260615000122_fn_schedule_ai_summaries_knockout_aware.sql` (Bug 2)
- `supabase/migrations/20260615000123_get_dashboard_payload_knockout_visibility.sql` (Bug 1)

### Edge Functions
- `supabase/functions/football-api-sync/index.ts` → vNEXT (Bug 4)
- `supabase/functions/nightly-summary/index.ts` → vNEXT (Bug 2 pre-check)

### Frontend
- `src/pages/Game.jsx` (Bug 3 — ET label + shootout section)
- `src/pages/Dashboard.jsx` (Bug 1 — LIVE-ET/LIVE-Pens badge)

### Docs
- `supabase/CLAUDE.md` — add M121/M122/M123 entries + EF version bumps
- `docs/PLAN_KNOCKOUT_FIXES.md` (this file) — mark each phase complete as it ships

### Memory
- `memory/knockout-fixes-plan.md` (new) — short pointer to this plan
- `memory/MEMORY.md` — add index entry under "Audits"

---

## Verification queries (for use during the sprint)

```sql
-- PSG-Arsenal current state
SELECT id, team_home, team_away, phase,
       score_home, score_away,
       et_score_home, et_score_away,
       penalty_score_home, penalty_score_away,
       went_to_extra_time, went_to_penalties, knockout_winner
FROM games WHERE id = 'ab8b2b63-2563-4d5d-8b4b-c9f7b546cc23';

-- Event counts by type
SELECT event_type, COUNT(*)
FROM game_events
WHERE game_id = 'ab8b2b63-2563-4d5d-8b4b-c9f7b546cc23'
GROUP BY event_type ORDER BY event_type;

-- AI summary cron for a future KO day (after Bug 2 fix + test KO insert)
SELECT jobname, schedule
FROM cron.job
WHERE jobname LIKE 'ai-summary-2026-06-27-%'
ORDER BY jobname;

-- Dashboard "today" date resolution
SELECT * FROM get_dashboard_payload();  -- run as the test user; check day_date field
```

---

## Out of scope

- Champion + top-scorer scoring on knockout_winner (already works via `fn_calculate_pick_points` — verified)
- Knockout game INSERT flow (already documented as Option C in `memory/feedback_knockout_insert_strategy.md`)
- ET/pen prediction UI (intentionally not implemented — predictions are 90-min only per scoring rules)
- API-football switch to `/fixtures/players` endpoint for shootout shots (current `/fixtures/events` is sufficient if probe_stats confirms misses are returned)

---

## When this plan is done

Mark each bug section "✅ SHIPPED `<commit_sha>`" at the top. Once all 4 are checked and PSG-Arsenal page renders correctly + AI summary fires post-knockout_winner on prod, archive this plan to `docs/archive/` and remove the memory pointer.
