# Agent 3 — Business Rules Validator

## Role
Verify that every business rule stated in CLAUDE.md and SKILL.md is actually enforced
in SQL — either via trigger functions, RPC logic, or constraints.
This agent reads migration files locally AND runs live SQL checks.
Reports rules that are missing DB enforcement (UI-only or not enforced at all).

## STRICT RULE: READ-ONLY
SQL checks are SELECT only. File reads are read-only. No modifications.

---

## Step 1 — Load Sources of Truth (LEADING — these define what is correct)
Read ALL of these before running any check. These are the authority:
1. `C:\Users\yonatanam\Desktop\World_Cup_APP\CLAUDE.md` — app characterization, scoring rules, deadline rules, group rules
2. `C:\Users\yonatanam\Desktop\World_Cup_APP\.claude\skills\db-feature\SKILL.md` — Scoring Rules + Helper Functions + RPC specs
3. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\db-phase.md` — Schema Decisions section (do-not-re-ask list — contains finalized rule decisions)
4. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\MEMORY.md` — project index
5. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\edge-function-phase.md` — EF design decisions relevant to business rules

Migration files are TARGETS — their logic is verified against the sources above.

Then read migration files that contain business logic:
- `supabase/migrations/20260312000001_groups.sql` — create_group, join_group
- `supabase/migrations/20260313000004_predictions.sql` — fn_calculate_points, fn_auto_predict_game
- `supabase/migrations/20260313000005_picks.sql` — champion/top scorer logic
- `supabase/migrations/20260314000009_fixes.sql` — fn_calculate_pick_points, create_profile
- `supabase/migrations/20260314000010_user_self_service.sql` — delete_account
- `supabase/migrations/20260315000013_distribution_rpc_v2.sql` — get_game_prediction_distribution (needed for BR-11)
- `supabase/migrations/20260315000015_auto_assign_picks.sql` — fn_auto_assign_picks
- `supabase/migrations/20260316000016_leaderboard_top_scorer.sql` — leaderboard columns

---

## Step 2 — SQL Helper

```bash
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SQL_HERE"}'
```

---

## Step 3 — Business Rules to Validate

For each rule: state the rule source, read the SQL that enforces it, evaluate correctness.
DB checks run 3 times each. File checks run once.

---

### RULE BR-01: Scoring — 3pt for exact score, 1pt for correct outcome, NOT additive
**Source:** CLAUDE.md "Points" table + SKILL.md Scoring Rules

**Find fn_calculate_points in migration SQL and verify:**
1. Exact score: `pred_home = score_home AND pred_away = score_away` → 3 points
2. Correct outcome only: one of (home win/draw/away win) → 1 point
3. NOT additive: exact score gives 3 ONLY (not 3+1=4)
   → The SQL must use CASE or IF: exact → 3, ELSE correct outcome → 1, ELSE 0
   → There must be NO code path that returns 4

**Live check — verify no prediction has points_earned = 4:**
```sql
SELECT COUNT(*) FROM public.predictions WHERE points_earned = 4;
```
Expected: 0 (if any games have been scored)

**Live check — verify valid point values only (0, 1, 3):**
```sql
SELECT DISTINCT points_earned FROM public.predictions ORDER BY points_earned;
```
Expected: only values from {0, 1, 3} — no 2, no 4, no negatives

---

### RULE BR-02: Champion pick = 10pt, Top scorer = 10pt
**Source:** CLAUDE.md scoring table

**Find fn_calculate_pick_points in migration 9 and verify:**
1. Awards exactly 10 points (not 5, not 15)
2. Resets ALL to 0 FIRST before re-awarding (idempotent)
3. Only fires on the FINAL game (phase = 'final')
4. Only fires when knockout_winner is SET or CHANGED (not on every update)

**Live check:**
```sql
SELECT DISTINCT points_earned FROM public.champion_pick ORDER BY points_earned;
SELECT DISTINCT points_earned FROM public.top_scorer_pick ORDER BY points_earned;
```
Expected: only {0} or {0, 10} — no other values

---

### RULE BR-03: Group limits — max 3 per creator, max 10 members
**Source:** CLAUDE.md Feature 1 + SKILL.md groups

**Read create_group RPC from migration SQL and verify:**
- `v_count >= 3` raises `max_groups_reached`
- Count is per `created_by = auth.uid()`

**Read join_group RPC and verify:**
- `v_count >= 10` raises `group_full`
- Count is per `group_id` (includes captain)

**Live check — any group with >10 members:**
```sql
SELECT group_id, COUNT(*) AS member_count
FROM public.group_members
GROUP BY group_id
HAVING COUNT(*) > 10;
```
Expected: 0 rows

**Live check — any creator with >3 groups:**
```sql
SELECT created_by, COUNT(*) AS group_count
FROM public.groups
WHERE created_by IS NOT NULL
GROUP BY created_by
HAVING COUNT(*) > 3;
```
Expected: 0 rows

---

### RULE BR-04: Account deletion guards
**Source:** CLAUDE.md "User Self-Service Rules"
"Delete account: Allowed if not in any group AND before June 11"

**Read delete_account() from migration 10 and verify:**
1. Raises `account_locked` if `now() >= 2026-06-11T19:00:00Z`
2. Raises `cannot_delete_in_group` if user is in any group_members row
3. Deletion cascades all user data

**Live check — fn_delete_account or delete_account exists:**
```sql
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'delete_account'
AND pronamespace = 'public'::regnamespace;
```
Then inspect prosrc for: account_locked, cannot_delete_in_group, both date check and group check.

---

### RULE BR-05: Predictions lock at game kickoff
**Source:** CLAUDE.md "Prediction Deadlines"
"Each game scoreline: locks at that game's individual kick_off_time"

**Check via RLS (verified in Agent 2, cross-reference here):**
In the predictions INSERT/UPDATE policy, the kick_off_time comparison must reference
`games.kick_off_time` — NOT a hardcoded date.

**Read predictions migration SQL** — does the RLS policy join to games table to get kick_off_time?

**Live check — predictions exist for finished games (has score set = kickoff passed):**
```sql
SELECT COUNT(*) FROM public.predictions pr
JOIN public.games g ON g.id = pr.game_id
WHERE g.score_home IS NOT NULL;
```
This will be 0 if no games have been played yet (pre-tournament). That's fine.
If > 0: verify they were submitted before kickoff — no way to check this directly, just note it.

---

### RULE BR-06: Auto-predict is contrarian (lowest distribution outcome)
**Source:** SKILL.md + db-phase.md
"fn_auto_predict_game queries existing predictions, picks outcome with fewest picks.
Falls back to random if no predictions exist yet."

**Read fn_auto_predict_game from migration SQL:**
1. Does it query existing predictions before inserting?
2. Does it calculate outcome distribution (home_win/draw/away_win counts)?
3. Does it pick the LEAST popular outcome (not random, not most popular)?
4. Does it fall back to random when no predictions exist?

**Live check — fn_auto_predict_game exists:**
```sql
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'fn_auto_predict_game'
AND pronamespace = 'public'::regnamespace;
```
Read prosrc and verify the contrarian logic is present.

---

### RULE BR-07: Auto-assign picks are random (not contrarian)
**Source:** db-phase.md
"AUTO-ASSIGN DESIGN: RANDOM from full list — each missing user gets own random pick"

**Read fn_auto_assign_picks from migration 15 and verify:**
1. Uses random() or random selection — NOT distribution-based
2. Assigns from full 48 teams list (champion) and player list (top scorer)
3. Sets is_auto = true on both champion_pick and top_scorer_pick

**Live check — fn_auto_assign_picks exists:**
```sql
SELECT proname FROM pg_proc
WHERE proname = 'fn_auto_assign_picks'
AND pronamespace = 'public'::regnamespace;
```

---

### RULE BR-08: No groups.DELETE + No group_members.DELETE (permanent)
**Source:** CLAUDE.md "Leave group — Never allowed" + "Delete group — Never allowed"

**Live check — both must have 0 DELETE policies:**
```sql
SELECT tablename, COUNT(*) AS delete_policy_count
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('groups','group_members')
AND cmd = 'DELETE'
GROUP BY tablename;
```
Expected: 0 rows (no DELETE policies on either table)

---

### RULE BR-09: Captain-can't-flag-themselves is UI-only (not DB-enforced)
**Source:** CLAUDE.md: "Captain cannot flag themselves as inactive (disabled in UI)"
  + "hide/disable the flag button on the captain's own row"

**Verify this is documented correctly as UI-only:**
Check group_members UPDATE policy — does it have any guard preventing
`user_id = created_by` being flagged as inactive?

```sql
SELECT qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'group_members' AND cmd = 'UPDATE';
```
If there is NO check for `user_id != auth.uid()` → this is confirmed UI-only.
This is NOT a bug — document it as "by design, UI-enforced only".
However, flag as ℹ️ Improvement: could be strengthened with DB check.

---

### RULE BR-10: Leaderboard tie-break order
**Source:** CLAUDE.md "Full Global Leaderboard"
"Ties broken by number of exact scorelines, then username alphabetically"

**Read get_leaderboard() from migration 6 (and migration 16 update):**
Verify ORDER BY is exactly: total_points DESC → exact_scores DESC → username ASC
(in that priority order)

**Live check — call leaderboard and spot-check order:**
```sql
SELECT rank, username, total_points, exact_scores
FROM public.get_leaderboard()
LIMIT 10;
```
Visually verify: rows with same total_points are ordered by exact_scores DESC,
then by username ASC.

---

### RULE BR-11: Predictions visible to group members ONLY after kickoff (not global)
**Source:** SKILL.md: "share_a_group(user_id) + kick_off_time <= now()"
  CLAUDE.md: "group members can see each other's predictions for that game (not global)"

**Read predictions SELECT policy from migration SQL:**
- Must include `share_a_group(user_id)` for the cross-member visibility
- Must include `kick_off_time <= now()` for the post-kickoff gate
- Should NOT have a global "all authenticated" fallback for other users' predictions

---

### RULE BR-12: score_home/score_away = 90-min score ONLY
**Source:** SKILL.md: "API SYNC RULE: score_home/away = 90-min only even if game goes to ET/pens"
  CLAUDE.md: "90-min score only, never ET or penalties"

**Verify fn_calculate_points uses score_home/score_away (not ET scores):**
Read the trigger function — it must compare `pred_home = NEW.score_home`
and `pred_away = NEW.score_away`, never et_score_home/away.

**Live check — fn_calculate_points triggers on which column:**
```sql
SELECT tgname, tgtype, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.games'::regclass
AND tgname = 'trg_calculate_points';
```
Verify trigger fires on UPDATE OF score_home, score_away (not et_score columns).

---

### RULE BR-13: groups.invite_code is 6-char alphanumeric
**Source:** SKILL.md: "6-char alphanumeric, generated by BEFORE INSERT trigger"

**Live check — sample invite codes:**
```sql
SELECT invite_code, char_length(invite_code) AS len
FROM public.groups
LIMIT 10;
```
Expected: all len = 6, all uppercase alphanumeric

```sql
SELECT COUNT(*) FROM public.groups
WHERE invite_code !~ '^[A-Z0-9]{6}$';
```
Expected: 0

---

## Step 4 — Report Format

```
RULE    | BR-01
NAME    | Scoring: 3pt exact, 1pt outcome, NOT additive
SOURCE  | CLAUDE.md + SKILL.md Scoring Rules
METHOD  | File read (fn_calculate_points SQL) + live DB check
RUN 1   | [live check result]
RUN 2   | [live check result]
RUN 3   | [live check result]
MATCH   | ✅ CONSISTENT
STATUS  | ✅ PASS / ❌ FAIL / ℹ️ UI-ONLY
FINDING | [exact SQL behavior observed / discrepancy found]
```

Severity:
- ❌ Critical — scoring calculates 4pt, wrong points awarded, limit not enforced
- ⚠️ Gap — rule exists in CLAUDE.md but no SQL enforcement found
- ℹ️ UI-only — intentionally UI-enforced (document, don't flag as bug)
- ℹ️ Improvement — could be strengthened with DB constraint
