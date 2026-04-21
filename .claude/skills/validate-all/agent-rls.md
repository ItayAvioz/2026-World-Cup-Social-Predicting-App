# Agent 2 — RLS Policy Validator

## Role
Verify that Row Level Security (RLS) is enabled and all policies on every table match
the spec in SKILL.md exactly. Check policy names, commands (SELECT/INSERT/UPDATE/DELETE),
USING clauses, and WITH CHECK clauses. Report any mismatch, missing policy, or
extra unexpected policy.

## STRICT RULE: READ-ONLY
Only run SELECT queries. Never run any policy changes or DDL.

---

## Step 1 — Load Sources of Truth (LEADING — these define what is correct)
Read ALL of these before running any check. These are the authority:
1. `C:\Users\yonatanam\Desktop\World_Cup_APP\CLAUDE.md` — app characterization, self-service rules, deadline rules
2. `C:\Users\yonatanam\Desktop\World_Cup_APP\.claude\skills\db-feature\SKILL.md` — RLS Rules table (authoritative policy spec)
3. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\db-phase.md` — schema decisions including RLS decisions that were finalized
4. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\MEMORY.md` — project index

Migration files are TARGETS — they are checked against the sources above.

Also read the relevant migration files for exact policy SQL:
- `supabase/migrations/20260312000001_groups.sql`
- `supabase/migrations/20260312000002_profiles.sql`
- `supabase/migrations/20260313000004_predictions.sql`
- `supabase/migrations/20260313000005_picks.sql`
- `supabase/migrations/20260313000007_ai_summaries.sql`
- `supabase/migrations/20260314000009_fixes.sql`
- `supabase/migrations/20260314000011_group_rename_lock.sql`
- `supabase/migrations/20260316000020_failed_summaries.sql`
- `supabase/migrations/20260316000021_game_odds.sql`

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

For each check below: run it (R1), run again (R2), run again (R3).
Compare results. All identical → CONSISTENT. Any difference → FLAKY.

---

### CHECK R-01: RLS Enabled on All Tables
```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'profiles','groups','group_members','games','predictions',
  'champion_pick','top_scorer_pick','ai_summaries',
  'game_team_stats','game_player_stats','game_odds','failed_summaries'
)
ORDER BY relname;
```
**Expected:** relrowsecurity = true for ALL tables.
If any table has relrowsecurity = false → ❌ Critical (data exposed without auth).

---

### CHECK R-02: All Policies — Full List
```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
```
This is the master reference query. Run 3 times and capture full output each time.

---

### CHECK R-03: profiles — policy count and commands
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd;
```
**Expected from SKILL.md:**
- SELECT: any authenticated user
- INSERT: own row only (via create_profile RPC — but INSERT policy may not exist if RPC is SECURITY DEFINER and bypasses RLS)
- UPDATE: own row only AND only before 2026-06-11T19:00:00Z (date-locked)
- No DELETE policy

**Critical check:** Does the UPDATE policy include a date check?
Look for `2026-06-11` in the `qual` column.

---

### CHECK R-04: groups — policies
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'groups'
ORDER BY cmd;
```
**Expected from SKILL.md:**
- SELECT: members only — `is_group_member(id, auth.uid())`
- UPDATE: captain only AND before 2026-06-11T19:00:00Z (date-locked)
- No INSERT policy (create_group RPC is SECURITY DEFINER)
- No DELETE policy

**Critical check:** Does UPDATE policy include date lock for rename?
Look for `2026-06-11` in qual.

---

### CHECK R-05: group_members — policies
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'group_members'
ORDER BY cmd;
```
**Expected:**
- SELECT: members only — `is_group_member(group_id, auth.uid())`
- UPDATE: captain only (groups.created_by = auth.uid()) — WITH CHECK must also exist
- No INSERT policy (join_group RPC is SECURITY DEFINER)
- **No DELETE policy** (members are permanent — CLAUDE.md rule)

**Check WITH CHECK exists on UPDATE:**
If with_check is NULL → ⚠️ Gap (captain could update other groups' members)

**Check no DELETE policy exists:**
```sql
SELECT COUNT(*) FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'group_members' AND cmd = 'DELETE';
```
Expected: 0

---

### CHECK R-06: predictions — policies
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'predictions'
ORDER BY cmd;
```
**Expected from SKILL.md:**
- SELECT: own always + group members after kick_off_time
  → USING clause must reference `kick_off_time <= now()` AND `share_a_group(user_id)`
- INSERT: authenticated + before kick_off_time
  → WITH CHECK must include `kick_off_time > now()` or equivalent
- UPDATE: own row + before kick_off_time
  → USING must check `user_id = auth.uid()` AND `kick_off_time > now()`
- No DELETE policy
  ```sql
  SELECT COUNT(*) FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'predictions' AND cmd = 'DELETE';
  ```
  Expected: 0

**Critical:** Does INSERT policy prevent prediction after kickoff?
Look for kick_off_time comparison in with_check column.

---

### CHECK R-07: champion_pick + top_scorer_pick — policies
```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('champion_pick','top_scorer_pick')
ORDER BY tablename, cmd;
```
**Expected for each:**
- SELECT: own always; public after 2026-06-11T19:00:00Z
- INSERT: own row, before 2026-06-11T19:00:00Z
- UPDATE: own row, before 2026-06-11T19:00:00Z

**Critical:** Both INSERT and UPDATE policies must enforce the June 11 lock date.
Look for `2026-06-11` in qual and with_check columns.

---

### CHECK R-08: games — policies
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'games'
ORDER BY cmd;
```
**Expected from SKILL.md:**
- SELECT: public (true) — anyone can read game data
- INSERT: service role only (no client INSERT policy → handled by service role bypass)
- UPDATE: service role only

**Check SELECT is truly public:**
Look for `qual = 'true'` or similar unrestricted SELECT.

---

### CHECK R-09: ai_summaries — policies
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ai_summaries'
ORDER BY cmd;
```
**Expected:**
- SELECT: group members only — `is_group_member(group_id, auth.uid())`
- No INSERT policy (Edge Function uses service role — bypasses RLS)
- No UPDATE, No DELETE

---

### CHECK R-10: game_odds — policies
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'game_odds'
ORDER BY cmd;
```
**Expected from SKILL.md:**
- SELECT: public read (true)
- No client INSERT/UPDATE (service role writes)

---

### CHECK R-11: failed_summaries — no client policies
```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'failed_summaries';
```
**Expected from SKILL.md:** service role only — NO client policies at all.
If any client policy exists → ⚠️ Gap (failed summary content could be readable).

---

### CHECK R-12: game_team_stats + game_player_stats — policies
```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('game_team_stats','game_player_stats')
ORDER BY tablename, cmd;
```
**Expected:** Public SELECT (true). Service role for INSERT/UPDATE.

---

### CHECK R-13: Helper Functions are SECURITY DEFINER (critical for RLS bypass safety)
```sql
SELECT proname, prosecdef
FROM pg_proc
WHERE proname IN ('is_group_member','share_a_group')
AND pronamespace = 'public'::regnamespace;
```
**Expected:** prosecdef = true for BOTH.
If false → ❌ Critical (infinite RLS recursion risk).

---

### CHECK R-14: No extra unexpected policies (policy inventory)
From R-02 full output, identify any policy NOT in the expected list above.
An unexpected policy (especially a permissive DELETE or INSERT) is ❌ Critical.

---

## Step 4 — Report Format

```
CHECK   | R-05
NAME    | group_members — no DELETE policy
RUN 1   | 0 DELETE policies
RUN 2   | 0 DELETE policies
RUN 3   | 0 DELETE policies
MATCH   | ✅ CONSISTENT
STATUS  | ✅ PASS
FINDING | group_members correctly has no DELETE policy — permanent membership enforced
SOURCE  | SKILL.md: "No DELETE policy on group_members" / CLAUDE.md: "Leave group — Never allowed"
```

Severity:
- ❌ Critical — DELETE policy exists where it shouldn't, missing kickoff date check, RLS disabled
- ⚠️ Gap — Missing WITH CHECK, policy count wrong, missing date lock
- ℹ️ Improvement — Policy naming convention inconsistent
