# Agent 1 — Schema Validator

## Role
Verify that every table, column, constraint, and index in the live Supabase DB exactly matches
the SKILL.md ERD (source of truth). Report every mismatch, missing item, and unexpected item.

## STRICT RULE: READ-ONLY
Only run SELECT queries. Never run DDL, DML, or any modifying SQL.

---

## Step 1 — Load Sources of Truth (LEADING — these define what is correct)
Read ALL of these before running any check. These are the authority:
1. `C:\Users\yonatanam\Desktop\World_Cup_APP\CLAUDE.md` — app characterization, schema rules
2. `C:\Users\yonatanam\Desktop\World_Cup_APP\.claude\skills\db-feature\SKILL.md` — live ERD, column specs
3. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\MEMORY.md` — project index (read first to orient)
4. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\db-phase.md` — schema decisions, what's deployed, do-not-re-ask list
5. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\edge-function-phase.md` — EF phase decisions (read to understand what's intentionally pending)

The live DB and migration files are the TARGETS — checked against the sources above, not the other way around.

**IMPORTANT — known intentional absence:**
`api_fixture_id` column on `games` table does NOT exist yet (Migration 22 pending — tracked in A6).
Do NOT flag its absence as a bug. Note it as "pending by design".

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

For each check below: run it, record result. Then run it again (Run 2). Then again (Run 3).
Compare R1=R2=R3. If all match → CONSISTENT. If any differ → FLAKY.

---

### CHECK S-01: Tables Exist
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
**Expected tables (from SKILL.md):**
profiles, groups, group_members, games, predictions, champion_pick, top_scorer_pick,
ai_summaries, game_team_stats, game_player_stats, game_odds, failed_summaries

**Also check views exist:**
```sql
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;
```
**Expected views:** leaderboard, team_tournament_stats, player_tournament_stats

---

### CHECK S-02: games — columns and types
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'games'
ORDER BY ordinal_position;
```
**Expected (from SKILL.md):**
- id: uuid, NOT NULL, gen_random_uuid()
- team_home: text, NOT NULL
- team_away: text, NOT NULL
- kick_off_time: timestamptz, NOT NULL
- score_home: int, nullable (NULL = unplayed)
- score_away: int, nullable
- knockout_winner: text, nullable
- went_to_extra_time: bool, nullable
- went_to_penalties: bool, nullable
- et_score_home: int, nullable
- et_score_away: int, nullable
- penalty_score_home: int, nullable
- penalty_score_away: int, nullable
- group_name: text, nullable (CHECK A-L)
- phase: text, NOT NULL (CHECK group/r32/r16/qf/sf/third/final)

**CRITICAL check — `status` column must NOT exist:**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'status';
```
Expected: 0 rows (status column must not exist per CLAUDE.md)

---

### CHECK S-03: profiles — columns
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;
```
**Expected:** id (uuid NOT NULL), username (text NOT NULL)
**No email column** (per CLAUDE.md: "No email stored here")

---

### CHECK S-04: predictions — columns
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'predictions'
ORDER BY ordinal_position;
```
**Expected:** id, user_id, game_id, pred_home (int NOT NULL), pred_away (int NOT NULL),
points_earned (int NOT NULL default 0), is_auto (bool NOT NULL default false),
submitted_at (timestamptz NOT NULL), updated_at (timestamptz NOT NULL)

---

### CHECK S-05: champion_pick + top_scorer_pick — columns
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('champion_pick','top_scorer_pick')
ORDER BY table_name, ordinal_position;
```
**Expected on champion_pick:** id, user_id, team (text NOT NULL), points_earned (default 0),
is_auto (bool NOT NULL default false), submitted_at, updated_at

**Expected on top_scorer_pick:** id, user_id, player_name (text NOT NULL),
top_scorer_api_id (int nullable), points_earned (default 0),
is_auto (bool NOT NULL default false), submitted_at, updated_at

---

### CHECK S-06: group_members — columns
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'group_members'
ORDER BY ordinal_position;
```
**Expected:** group_id (uuid NOT NULL), user_id (uuid NOT NULL),
joined_at (timestamptz NOT NULL), is_inactive (bool NOT NULL default false)

**Must NOT have `role` column** (CLAUDE.md uses is_inactive flag, not role field):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'role';
```
Expected: 0 rows

---

### CHECK S-07: game_team_stats + game_player_stats — columns
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'game_team_stats'
ORDER BY ordinal_position;
```
**Expected:** game_id, team, possession, shots_total, shots_on_target,
corners, fouls, yellow_cards, red_cards, offsides

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'game_player_stats'
ORDER BY ordinal_position;
```
**Expected:** game_id, api_player_id, player_name, team, minutes_played,
goals, assists, yellow_cards, red_cards

---

### CHECK S-08: game_odds — columns and types
```sql
SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'game_odds'
ORDER BY ordinal_position;
```
**Expected:** game_id (uuid), source (text NOT NULL default 'football-api'),
home_win (numeric 6,2 NOT NULL), draw (numeric 6,2 NOT NULL),
away_win (numeric 6,2 NOT NULL), updated_at (timestamptz NOT NULL)

---

### CHECK S-09: ai_summaries — columns
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ai_summaries'
ORDER BY ordinal_position;
```
**Expected:** id, group_id, date, content, games_count, model,
prompt_tokens, completion_tokens, generated_at
**UNIQUE constraint:** (group_id, date)

---

### CHECK S-10: failed_summaries — columns
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'failed_summaries'
ORDER BY ordinal_position;
```
**Expected:** id, group_id, date, content, error_msg, created_at,
resolved (bool NOT NULL default false), resolved_at

---

### CHECK S-11: CHECK Constraints
```sql
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (
  'public.games'::regclass,
  'public.profiles'::regclass,
  'public.groups'::regclass,
  'public.predictions'::regclass,
  'public.champion_pick'::regclass,
  'public.top_scorer_pick'::regclass
)
AND contype = 'c'
ORDER BY conrelid::text, conname;
```
**Expected constraints:**
- games: games_scores_non_negative, games_group_name_phase
- profiles: username length + pattern CHECK (char_length 3-20, alphanumeric+underscore)
- groups: char_length(name) <= 30
- predictions: pred_home >= 0, pred_away >= 0

---

### CHECK S-12: UNIQUE Constraints
```sql
SELECT tc.table_name, kcu.column_name, tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'UNIQUE'
AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;
```
**Expected UNIQUE constraints:**
- groups.invite_code
- champion_pick.user_id
- top_scorer_pick.user_id
- predictions.(user_id, game_id)
- ai_summaries.(group_id, date)

---

### CHECK S-13: Foreign Keys (ON DELETE behavior)
```sql
SELECT
  tc.table_name, kcu.column_name,
  ccu.table_name AS ref_table, ccu.column_name AS ref_col,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
```
**Expected ON DELETE behavior (from SKILL.md):**
- groups.created_by → auth.users: SET NULL
- group_members.group_id → groups: CASCADE
- group_members.user_id → auth.users: CASCADE
- predictions.user_id → auth.users: CASCADE
- predictions.user_id → profiles: CASCADE (PostgREST FK)
- champion_pick.user_id → auth.users: CASCADE
- top_scorer_pick.user_id → auth.users: CASCADE
- ai_summaries.group_id → groups: CASCADE
- game_team_stats.game_id → games: CASCADE
- game_player_stats.game_id → games: CASCADE
- game_odds.game_id → games: CASCADE
- failed_summaries.group_id → groups: CASCADE

---

### CHECK S-14: games row count sanity
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE phase = 'group') AS group_stage,
  COUNT(*) FILTER (WHERE phase != 'group') AS knockout,
  COUNT(*) FILTER (WHERE score_home IS NOT NULL) AS finished
FROM public.games;
```
**Expected:** total = 104, group_stage = 48, knockout = 56, finished = 0 (no games played yet)

---

## Step 4 — Report Format

For each check, produce one row:
```
CHECK   | S-01
NAME    | Tables exist
RUN 1   | [result]
RUN 2   | [result]
RUN 3   | [result]
MATCH   | ✅ CONSISTENT / ⚠️ FLAKY
STATUS  | ✅ PASS / ❌ FAIL / ⚠️ PARTIAL
FINDING | [what matched / what was different]
SOURCE  | [which SKILL.md / CLAUDE.md line drove this expectation]
```

Severity legend:
- ❌ Critical — DB missing required column, wrong ON DELETE, status column exists
- ⚠️ Gap — column nullable when should be NOT NULL, missing constraint
- ℹ️ Improvement — column name slightly different, extra unexpected column
