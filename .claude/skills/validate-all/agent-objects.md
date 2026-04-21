# Agent 4 — DB Objects Validator

## Role
Verify that every function (RPC + trigger fn), trigger, view, index, and cron job
listed in SKILL.md actually exists in the live DB with the correct signature,
security model, and configuration. Check nothing is missing and nothing unexpected
has crept in.

## STRICT RULE: READ-ONLY
Only SELECT queries. Never modify schema, functions, or cron jobs.

---

## Step 1 — Load Sources of Truth (LEADING — these define what is correct)
Read ALL of these before running any check. These are the authority:
1. `C:\Users\yonatanam\Desktop\World_Cup_APP\CLAUDE.md` — app characterization (what features exist, what objects are required)
2. `C:\Users\yonatanam\Desktop\World_Cup_APP\.claude\skills\db-feature\SKILL.md` — Helper Functions section (complete expected list)
3. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\db-phase.md` — DB Objects Summary + what's deployed + fn_schedule_ai_summaries status
4. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\MEMORY.md` — project index
5. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\edge-function-phase.md` — which functions are needed for EF phase (e.g. fn_schedule_ai_summaries, get_group_summary_data)

The live DB is the TARGET — its objects are verified against the sources above.

---

## Step 2 — SQL Helper

```bash
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SQL_HERE"}'
```

---

## Step 3 — Run ALL checks 3 times each

---

### CHECK O-01: All Expected Functions Exist
```sql
SELECT proname, prosecdef, pronargs
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
ORDER BY proname;
```

**Expected functions (from SKILL.md + db-phase.md):**
| Function | SECURITY DEFINER? | Notes |
|---|---|---|
| create_profile | YES | raises username_taken, invalid_username |
| delete_account | YES | raises account_locked, cannot_delete_in_group |
| create_group | YES | raises max_groups_reached, invalid_name |
| join_group | YES | raises invalid_invite_code, already_member, group_full |
| is_group_member | YES | helper for RLS policies |
| share_a_group | YES | helper for predictions RLS |
| fn_generate_invite_code | NO | trigger function |
| fn_creator_joins_group | YES | trigger function |
| fn_handle_captain_delete | YES | trigger function |
| fn_calculate_points | any | trigger function for scoring |
| fn_calculate_pick_points | YES | trigger function, SECURITY DEFINER needed |
| fn_auto_predict_game | YES | cron-called, inserts predictions |
| fn_auto_assign_picks | any | assigns random picks at KO |
| fn_schedule_auto_predictions | any | called once to register 104 cron jobs |
| fn_schedule_ai_summaries | any | NOT YET CALLED — just verify it exists |
| get_leaderboard | YES | returns all users ranked |
| get_group_leaderboard | YES | membership-gated group ranking |
| get_group_summary_data | YES | called from Edge Function (service role) |
| get_game_prediction_distribution | YES | W/D/L distribution per game |

**Critical SECURITY DEFINER check:**
```sql
SELECT proname, prosecdef
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
AND proname IN (
  'is_group_member','share_a_group','create_profile','delete_account',
  'create_group','join_group','fn_creator_joins_group','fn_handle_captain_delete',
  'fn_calculate_pick_points','fn_auto_predict_game',
  'get_leaderboard','get_group_leaderboard','get_group_summary_data',
  'get_game_prediction_distribution'
)
ORDER BY proname;
```
Expected: prosecdef = true for ALL listed above.
Any prosecdef = false → ❌ Critical (RLS bypass won't work correctly)

---

### CHECK O-02: All Expected Triggers Exist
```sql
SELECT tgname, tgrelid::regclass AS table_name, tgenabled,
       pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgname IN (
  'trg_group_invite_code',
  'trg_group_creator_join',
  'trg_captain_delete',
  'trg_calculate_points',
  'trg_calculate_pick_points',
  'trg_predictions_updated_at'
)
ORDER BY tgname;
```

**Expected triggers:**
| Trigger | Table | Fires |
|---|---|---|
| trg_group_invite_code | groups | BEFORE INSERT |
| trg_group_creator_join | groups | AFTER INSERT |
| trg_captain_delete | auth.users | BEFORE DELETE |
| trg_calculate_points | games | AFTER UPDATE OF score_home, score_away |
| trg_calculate_pick_points | games | AFTER UPDATE OF knockout_winner |
| trg_predictions_updated_at | predictions | BEFORE UPDATE |

**Critical — trg_calculate_points must fire on score_home AND score_away:**
```sql
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgname = 'trg_calculate_points';
```
Verify `UPDATE OF score_home, score_away` in definition.

**Critical — trg_calculate_pick_points fires on knockout_winner ONLY:**
```sql
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgname = 'trg_calculate_pick_points';
```
Verify `UPDATE OF knockout_winner` in definition.

---

### CHECK O-03: All Expected Views Exist
```sql
SELECT table_name, view_definition
FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;
```

**Expected views:**
| View | Key columns |
|---|---|
| leaderboard | user_id, username, champion_team, total_points, exact_scores, rank |
| team_tournament_stats | team, W/D/L, avg stats |
| player_tournament_stats | api_player_id, player_name, team, total_goals, total_assists, games_played |

**Critical — player_tournament_stats must NOT have ORDER BY in definition:**
After migration 9 Fix 4, the ORDER BY was removed.
Read view_definition — should not contain `ORDER BY`.

**Critical — leaderboard includes top_scorer_player (added migration 16):**
Check that `top_scorer_player` column appears in leaderboard view_definition.
This was added in migration 16 — if missing, migration 16 may not have applied correctly.
```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('leaderboard')
ORDER BY ordinal_position;
```
Note: leaderboard is a VIEW — check its columns via information_schema.

---

### CHECK O-04: get_leaderboard() return columns
```sql
SELECT column_name, data_type
FROM information_schema.routine_columns
WHERE specific_schema = 'public'
AND routine_name = 'get_leaderboard'
ORDER BY ordinal_position;
```
If information_schema.routine_columns doesn't work, use:
```sql
SELECT pg_get_function_result('public.get_leaderboard()'::regprocedure);
```
**Expected return columns:** rank, user_id, username, champion_team, top_scorer_player, total_points, exact_scores

**Note:** `top_scorer_player` was added in migration 16. If missing → migration 16 not fully applied.

---

### CHECK O-05: get_group_leaderboard() return columns
```sql
SELECT pg_get_function_result('public.get_group_leaderboard(uuid)'::regprocedure);
```
**Expected:** group_rank, global_rank, user_id, username, champion_team, top_scorer_player, total_points, exact_scores

---

### CHECK O-06: Cron Jobs — auto-predict count
```sql
SELECT COUNT(*) AS total_jobs,
       COUNT(*) FILTER (WHERE jobname LIKE 'auto-predict-%') AS auto_predict_jobs
FROM cron.job;
```
**Expected:** auto_predict_jobs = 104 (one per game)

**Spot check — sample 5 jobs:**
```sql
SELECT jobname, schedule, command
FROM cron.job
WHERE jobname LIKE 'auto-predict-%'
ORDER BY jobname
LIMIT 5;
```
Verify command calls `fn_auto_predict_game(game_id)` and schedule is a valid cron expression.

**Check for duplicate game IDs in cron (each game should have exactly 1 job):**
```sql
SELECT command, COUNT(*) AS cnt
FROM cron.job
WHERE jobname LIKE 'auto-predict-%'
GROUP BY command
HAVING COUNT(*) > 1;
```
Expected: 0 rows (no duplicate cron jobs per game)

---

### CHECK O-07: fn_schedule_ai_summaries — exists but NOT called
```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
AND proname = 'fn_schedule_ai_summaries';
```
**Expected:** 1 row (function exists)

**Verify it has NOT been called (no ai_summary cron jobs registered):**
```sql
SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'ai-summary-%' OR command LIKE '%nightly-summary%';
```
**Expected:** 0 (not yet activated — this is correct behavior pre-EF deployment)
Note in report: "fn_schedule_ai_summaries exists ✅ but not called ✅ (correct — awaiting EF URL)"

---

### CHECK O-08: Key Indexes Exist
```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```
**Expected indexes (beyond PKs and unique constraints):**
- top_scorer_pick: `top_scorer_pick_api_player_idx` on `top_scorer_api_id` (added migration 9)
- predictions: index on (user_id) and/or (game_id) for fast RLS checks

Check: does `top_scorer_pick_api_player_idx` exist?
```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'top_scorer_pick' AND indexname = 'top_scorer_pick_api_player_idx';
```
Expected: 1 row

---

### CHECK O-09: Test Users Exist (F1 seed data)
```sql
SELECT email FROM auth.users ORDER BY email;
```
**Expected test users (from supabase/CLAUDE.md):**
- alice@test.com
- bob@test.com
- carol@test.com
- dave@test.com
- eve@test.com

```sql
SELECT username FROM public.profiles ORDER BY username;
```
**Expected profiles:** alice_wc, bob_wc, carol_wc, dave_wc, eve_wc

---

### CHECK O-10: Function Source Code — critical functions readable
```sql
SELECT proname, LEFT(prosrc, 200) AS src_preview
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
AND proname IN ('fn_calculate_points','fn_calculate_pick_points','fn_auto_predict_game')
ORDER BY proname;
```
Read the first 200 chars of each function to confirm they're not empty/placeholder.
If prosrc is NULL or very short → ❌ Critical (function shell only, no logic)

---

## Step 4 — Report Format

```
CHECK   | O-01
NAME    | All expected functions exist
RUN 1   | [list of found functions]
RUN 2   | [list of found functions]
RUN 3   | [list of found functions]
MATCH   | ✅ CONSISTENT
STATUS  | ✅ PASS / ❌ FAIL
FINDING | Missing: [fn_name] / Extra unexpected: [fn_name] / All present ✅
SOURCE  | SKILL.md Helper Functions list
```

Severity:
- ❌ Critical — required SECURITY DEFINER function missing or has wrong security, trigger missing, cron count wrong
- ⚠️ Gap — function exists but wrong return columns, index missing
- ℹ️ Note — fn_schedule_ai_summaries not called (expected, correct state)
