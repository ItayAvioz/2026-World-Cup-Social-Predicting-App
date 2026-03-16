> ⚠️ SUPERSEDED — This was the preliminary verification and build plan. It has been replaced by the live build status in:
> - `memory/db-phase.md` — authoritative DB build status, migrations 1–21 deployed, schema decisions
> - `supabase/CLAUDE.md` — deployed migration log
> All features F1–F9 have been built. Verification status tracked in memory/db-phase.md.

---

# WorldCup 2026 — Verification & Build Plan (Preliminary)

Testing strategy: each feature is verified with real data and expected results.
SQL tests run in Supabase SQL editor (service role — bypasses RLS).
RLS and auth tests use a lightweight test HTML page loaded in the browser.

---

## Pre-Step — Deploy Migration 9

Run `supabase/migrations/20260314000009_fixes.sql` in the Supabase SQL editor.

**Verify all Fix 9 objects exist:**
```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'games' AND column_name = 'knockout_winner';

SELECT column_name FROM information_schema.columns
  WHERE table_name = 'top_scorer_pick' AND column_name = 'top_scorer_api_id';

SELECT proname FROM pg_proc
  WHERE proname IN ('create_profile', 'fn_calculate_pick_points');

SELECT tgname FROM pg_trigger
  WHERE tgrelid = 'public.games'::regclass
    AND tgname = 'trg_calculate_pick_points';
```

**Expected result — 5 rows:**
```
knockout_winner
top_scorer_api_id
create_profile
fn_calculate_pick_points
trg_calculate_pick_points
```

---

## Feature 1 — User Registration & Profiles

### What it covers
`auth.users` + `profiles` table + `create_profile()` RPC.
The entry point for every user. Username is locked at registration.

### Step 1 — Verify DB objects
```sql
-- Table structure
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'profiles'
  ORDER BY ordinal_position;

-- RLS policies (expect 2: authenticated select, own row insert)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'profiles';

-- RPC exists and is SECURITY DEFINER
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'create_profile';
```

**Expected:**
```
profiles columns: id (uuid, NO), username (text, NO)
policies: "profiles: authenticated can select" SELECT
          "profiles: own row insert" INSERT
create_profile | prosecdef = true
```

### Step 2 — Create 5 test users
In **Supabase Dashboard → Auth → Users**, create:

| Email | Password |
|---|---|
| alice@test.com | Test1234! |
| bob@test.com | Test1234! |
| carol@test.com | Test1234! |
| dave@test.com | Test1234! |
| eve@test.com | Test1234! |

Note all 5 UUIDs. Used throughout the plan as `<alice>`, `<bob>`, `<carol>`, `<dave>`, `<eve>`.

### Step 3 — Seed profiles (service role)
```sql
INSERT INTO public.profiles (id, username) VALUES
  ('<alice>', 'alice_wc'),
  ('<bob>',   'bob_wc'),
  ('<carol>', 'carol_wc'),
  ('<dave>',  'dave_wc'),
  ('<eve>',   'eve_wc');
```

**Expected:**
```sql
SELECT id, username FROM public.profiles;
-- 5 rows
```

### Step 4 — Test RPC error handling (service role)
```sql
-- Too short
SELECT public.create_profile('ab');
-- Expected: ERROR: invalid_username

-- Duplicate
SELECT public.create_profile('alice_wc');
-- Expected: ERROR: username_taken

-- Invalid chars
SELECT public.create_profile('alice wc!');
-- Expected: ERROR: invalid_username
```

### Step 5 — Test with real auth (browser test page)

**Test page:** `test/test-auth.html`

Open `test/test-auth.html` in a browser. It lets you:
- Sign up a new user + call `create_profile()` in one flow
- Sign in as an existing user
- Verify that after sign-in, `SELECT * FROM profiles` returns all 5 users (public read)
- Verify that you cannot `UPDATE profiles` (no UPDATE policy)

**Expected results in page:**
- Sign up + create_profile → "Profile created: alice_wc"
- Duplicate username → "Error: username_taken"
- After sign-in, profiles list shows all 5 users

### Done when
- [x] 5 profiles in DB (6 incl. frank_wc)
- [x] `create_profile()` raises named errors for invalid/duplicate usernames
- [x] Authenticated user can read all profiles
- [x] Username rename works before June 11 cutoff (UPDATE policy)
- [x] delete_account() — blocked if in group or after June 11
- [x] DELETE on profiles row silently blocked (no DELETE policy)

**Note:** alice deleted+recreated during testing (new UUID: 158800e8-8f89-4fbd-8578-5ae3e600dc9f). cannot_delete_in_group re-test pending Feature 2 seed.

---

## Feature 2 — Friend Groups

### What it covers
`groups` + `group_members`. Captain creates group → invite_code auto-generated → captain auto-joined → friends join via code. Max 3 groups per creator, max 10 members per group.

### Step 1 — Verify DB objects
```sql
-- Tables exist
SELECT tablename FROM pg_tables
  WHERE tablename IN ('groups', 'group_members');

-- Triggers on groups table
SELECT tgname, tgtype::text
  FROM pg_trigger
  WHERE tgrelid = 'public.groups'::regclass
  ORDER BY tgname;

-- RPCs
SELECT proname FROM pg_proc
  WHERE proname IN ('create_group', 'join_group', 'is_group_member');

-- RLS policies
SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE tablename IN ('groups', 'group_members')
  ORDER BY tablename, policyname;
```

**Expected triggers:**
```
trg_captain_delete   (on auth.users — check in dashboard manually)
trg_group_creator_join
trg_group_invite_code
```

**Expected policies:**
```
groups        | groups: captain can update   | UPDATE
groups        | groups: members can select   | SELECT
group_members | group_members: captain can update | UPDATE
group_members | group_members: members can select | SELECT
```

### Step 2 — Seed groups (service role)
```sql
-- Create 2 groups (alice is captain of both, bob/carol join group 1)
INSERT INTO public.groups (name, created_by)
  VALUES ('WC Friends', '<alice>');
-- Triggers fire: invite_code generated, alice auto-added to group_members

INSERT INTO public.groups (name, created_by)
  VALUES ('Office Bets', '<alice>');
```

```sql
-- Check invite codes were generated
SELECT id AS group_id, name, invite_code, created_by
  FROM public.groups;
```

**Expected:**
```
group_id | name        | invite_code | created_by
<uuid>   | WC Friends  | AB3X7K      | <alice>    ← 6-char alphanumeric
<uuid>   | Office Bets | QZ9M2P      | <alice>
```

```sql
-- Check alice is in both groups
SELECT group_id, user_id, joined_at
  FROM public.group_members
  WHERE user_id = '<alice>';
-- 2 rows
```

### Step 3 — Test join (service role)
```sql
-- Bob and Carol join WC Friends
INSERT INTO public.group_members (group_id, user_id)
  VALUES ('<group1-id>', '<bob>'),
         ('<group1-id>', '<carol>');

-- Dave joins WC Friends (now 4 members total)
INSERT INTO public.group_members (group_id, user_id)
  VALUES ('<group1-id>', '<dave>');

-- Check members
SELECT gm.user_id, p.username, gm.joined_at
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = '<group1-id>';
```

**Expected — 4 rows:** alice_wc, bob_wc, carol_wc, dave_wc

### Step 4 — Test limit enforcement (service role)
```sql
-- 3rd group for alice (should work)
INSERT INTO public.groups (name, created_by) VALUES ('Test G3', '<alice>');

-- 4th group — calls RPC to enforce limit
SELECT public.create_group('Test G4');
-- Expected: ERROR: max_groups_reached
```

```sql
-- Invalid invite code
SELECT public.join_group('ZZZZZZ');
-- Expected: ERROR: invalid_invite_code

-- Already a member
SELECT public.join_group('<group1-invite-code>');
-- (run when logged in as alice) Expected: ERROR: already_member
```

### Step 5 — Test RLS (browser test page)

**Test page:** `test/test-groups.html`

Sign in as each user and verify:
- alice sees "WC Friends" and "Office Bets" (her groups)
- bob sees only "WC Friends" (the one he's in)
- eve sees NO groups (not in any group)
- Create group button works; join via invite code works

**Expected results in page:**
- alice: 2 groups listed
- bob: 1 group listed (WC Friends)
- eve: 0 groups, create form works

### Step 6 — Test is_inactive flag (service role)
```sql
-- Alice (captain) flags bob as inactive
UPDATE public.group_members
  SET is_inactive = true
  WHERE group_id = '<group1-id>' AND user_id = '<bob>';

-- Verify flag saved
SELECT user_id, is_inactive
  FROM public.group_members
  WHERE group_id = '<group1-id>';
-- bob: is_inactive = true, others: false
```

### Done when
- [x] invite_code auto-generated (6-char uppercase alphanumeric)
- [x] Captain auto-joined on group creation
- [x] Max 3 groups / max 10 members enforced
- [x] `is_group_member()` helper returns correct boolean
- [x] RLS confirmed: members see their groups only
- [x] Captain can update is_inactive, non-captains cannot
- [x] Captain can rename group (before June 11 only) — non-captain blocked
- [x] DELETE group blocked (no DELETE policy)
- [x] DELETE member blocked (no DELETE policy)
- [x] cannot_delete_in_group confirmed
- [x] account_locked confirmed (date simulation)
- [x] Account deletion with no groups succeeds + auth.users cascade confirmed
- [x] Verified 2026-03-14

---

## Feature 3 — Predictions (Submit, Deadline, Points)

### What it covers
`predictions` table + `fn_calculate_points()` trigger. Users predict scorelines before kickoff. Points awarded when game score is set. Group members' predictions revealed after kickoff.

### Step 1 — Verify DB objects
```sql
-- Triggers on predictions and games
SELECT tgname, tgrelid::regclass AS table_name
  FROM pg_trigger
  WHERE tgrelid IN (
    'public.predictions'::regclass,
    'public.games'::regclass
  )
  ORDER BY table_name, tgname;

-- share_a_group helper
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'share_a_group';

-- RLS policies on predictions (expect 3: select, insert, update)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'predictions';

-- Indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'predictions';
```

**Expected triggers:**
```
predictions | trg_predictions_updated_at
games       | trg_calculate_pick_points
games       | trg_calculate_points
```

**Expected policies:**
```
predictions: select | SELECT
predictions: insert | INSERT
predictions: update | UPDATE
```

### Step 2 — Find test games
```sql
-- Pick 3 games to work with:
-- Game A: a future game (deadline not passed) for prediction testing
-- Game B: a "past" game (we'll manipulate to test points)

SELECT id, team_home, team_away, kick_off_time
  FROM public.games
  WHERE phase = 'group'
  ORDER BY kick_off_time
  LIMIT 5;
```

Note: `<game-A>` = first group game (future), `<game-B>` = second one.

### Step 3 — Seed predictions (service role)
```sql
-- 3 users predict Game A: 2026-06-11 Mexico vs South Africa
INSERT INTO public.predictions (user_id, game_id, pred_home, pred_away) VALUES
  ('<alice>', '<game-A>', 2, 1),   -- home win
  ('<bob>',   '<game-A>', 1, 1),   -- draw
  ('<carol>', '<game-A>', 0, 2);   -- away win
```

```sql
-- Verify inserted
SELECT p.username, pr.pred_home, pr.pred_away, pr.points_earned, pr.is_auto
  FROM public.predictions pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.game_id = '<game-A>'
  ORDER BY p.username;
```

**Expected:**
```
alice_wc | 2 | 1 | 0 | false
bob_wc   | 1 | 1 | 0 | false
carol_wc | 0 | 2 | 0 | false
```

### Step 4 — Test points calculation trigger
```sql
-- Set score: Mexico 2-1 South Africa (alice's exact pick)
UPDATE public.games
  SET score_home = 2, score_away = 1
  WHERE id = '<game-A>';

SELECT p.username, pr.pred_home, pr.pred_away, pr.points_earned
  FROM public.predictions pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.game_id = '<game-A>'
  ORDER BY pr.points_earned DESC;
```

**Expected:**
```
alice_wc | 2 | 1 | 3   ← exact score
bob_wc   | 1 | 1 | 0   ← wrong outcome
carol_wc | 0 | 2 | 0   ← wrong outcome
```

```sql
-- Correct the score (draw 1-1 — bob's exact pick)
UPDATE public.games
  SET score_home = 1, score_away = 1
  WHERE id = '<game-A>';

SELECT p.username, pr.points_earned
  FROM public.predictions pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.game_id = '<game-A>';
```

**Expected (after correction):**
```
alice_wc | 0   ← reset
bob_wc   | 3   ← now exact
carol_wc | 0
```

```sql
-- Reset score for further testing
UPDATE public.games SET score_home = NULL, score_away = NULL WHERE id = '<game-A>';
```

### Step 5 — Test updated_at trigger
```sql
-- Save original updated_at
SELECT updated_at FROM public.predictions
  WHERE user_id = '<alice>' AND game_id = '<game-A>';

-- Wait 1 second, then update
UPDATE public.predictions
  SET pred_home = 3
  WHERE user_id = '<alice>' AND game_id = '<game-A>';

SELECT updated_at FROM public.predictions
  WHERE user_id = '<alice>' AND game_id = '<game-A>';
-- updated_at must be newer than before
```

### Step 6 — Test RLS and deadline (browser test page)

**Test page:** `test/test-predictions.html`

Sign in as alice and verify:
- Can insert a prediction for a future game
- Cannot insert a prediction for a past game (RLS: 42501 error)
- Before kickoff: alice can only see her own prediction for the game
- After kickoff (simulate with a finished game): alice can see all group members' predictions

**Expected results in page:**
- Future game → prediction saved ✓
- Past game → "Predictions are locked" error
- After kickoff → 3 predictions visible (alice, bob, carol)

### Done when
- [ ] Points calculate correctly: exact=3, correct outcome=1, wrong=0
- [ ] Score correction resets and re-calculates (idempotent)
- [ ] `updated_at` updates on every edit
- [ ] RLS blocks insert/update after kickoff
- [ ] Group members see each other's predictions only after kickoff

---

## Feature 4 — Auto-Predict (pg_cron at Kickoff)

### What it covers
At each game's exact `kick_off_time`, a cron job calls `fn_auto_predict_game(game_id)`. Every user without a prediction gets a random 0–5 scoreline. Job self-unschedules after running.

### Step 1 — Verify 104 cron jobs exist
```sql
SELECT COUNT(*) AS total_jobs
  FROM cron.job
  WHERE jobname LIKE 'auto-predict-%';
-- Expected: 104

-- Inspect sample jobs
SELECT jobname, schedule, command
  FROM cron.job
  WHERE jobname LIKE 'auto-predict-%'
  ORDER BY jobname
  LIMIT 5;
```

**Expected sample:**
```
auto-predict-<uuid> | 0 19 11 6 * | SELECT public.fn_auto_predict_game(...)
```

### Step 2 — Find a game with no predictions
```sql
SELECT g.id, g.team_home, g.team_away
  FROM public.games g
  LEFT JOIN public.predictions pr ON pr.game_id = g.id
  GROUP BY g.id
  HAVING COUNT(pr.id) = 0
  LIMIT 1;
```

Note as `<game-empty>`.

### Step 3 — Manual trigger test
```sql
-- How many profiles exist
SELECT COUNT(*) FROM public.profiles; -- e.g. 5

-- Fire auto-predict manually
SELECT public.fn_auto_predict_game('<game-empty>');

-- All 5 profiles now have a prediction
SELECT COUNT(*) FROM public.predictions WHERE game_id = '<game-empty>';
-- Expected: 5

-- All marked is_auto = true
SELECT p.username, pr.pred_home, pr.pred_away, pr.is_auto
  FROM public.predictions pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.game_id = '<game-empty>';
```

**Expected:**
```
alice_wc | 3 | 1 | true
bob_wc   | 0 | 2 | true
carol_wc | 2 | 2 | true
dave_wc  | 4 | 0 | true
eve_wc   | 1 | 3 | true
(random scores, all is_auto = true)
```

### Step 4 — Verify self-unschedule
```sql
SELECT COUNT(*) FROM cron.job
  WHERE jobname = 'auto-predict-<game-empty>';
-- Expected: 0 (job removed itself)

-- Remaining jobs reduced by 1
SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'auto-predict-%';
-- Expected: 103
```

### Step 5 — Verify NOT EXISTS guard (no overwrite)
```sql
-- alice already has a manual prediction for game-A (pred_home=3 from Step 5 above)
SELECT public.fn_auto_predict_game('<game-A>');

-- alice's prediction unchanged, others filled in
SELECT p.username, pr.pred_home, pr.pred_away, pr.is_auto
  FROM public.predictions pr
  JOIN public.profiles p ON p.id = pr.user_id
  WHERE pr.game_id = '<game-A>';
```

**Expected:**
```
alice_wc | 3 | 1 | false   ← her original manual pred, untouched
bob_wc   | 1 | 1 | false   ← also has manual pred, untouched
carol_wc | 0 | 2 | false   ← also has manual pred, untouched
dave_wc  | ? | ? | true    ← auto-filled
eve_wc   | ? | ? | true    ← auto-filled
```

### Done when
- [ ] 104 cron jobs registered
- [ ] Manual trigger fills all profiles without an existing prediction
- [ ] `is_auto = true` on all auto-generated rows
- [ ] Manual predictions NOT overwritten
- [ ] Job self-unschedules after running

---

## Feature 5 — Champion Pick & Top Scorer Pick

### What it covers
`champion_pick` + `top_scorer_pick`. One pick per user, locked at June 11 2026 19:00 UTC. Points (10pt each) awarded by `fn_calculate_pick_points` trigger when the final's `knockout_winner` is set.

### Step 1 — Verify DB objects
```sql
-- Columns
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name IN ('champion_pick', 'top_scorer_pick')
  ORDER BY table_name, ordinal_position;

-- Triggers
SELECT tgname, tgrelid::regclass
  FROM pg_trigger
  WHERE tgrelid IN (
    'public.champion_pick'::regclass,
    'public.top_scorer_pick'::regclass,
    'public.games'::regclass
  );

-- RLS policies (expect 3 each: select, insert, update)
SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE tablename IN ('champion_pick', 'top_scorer_pick')
  ORDER BY tablename, cmd;
```

**Expected triggers:**
```
champion_pick    | trg_champion_pick_updated_at
top_scorer_pick  | trg_top_scorer_pick_updated_at
games            | trg_calculate_pick_points
```

### Step 2 — Seed picks (service role)
```sql
INSERT INTO public.champion_pick (user_id, team) VALUES
  ('<alice>', 'Brazil'),
  ('<bob>',   'France'),
  ('<carol>', 'Brazil'),
  ('<dave>',  'Argentina'),
  ('<eve>',   'Spain');

INSERT INTO public.top_scorer_pick (user_id, player_name, top_scorer_api_id) VALUES
  ('<alice>', 'Kylian Mbappé',  278),
  ('<bob>',   'Erling Haaland', 1100),
  ('<carol>', 'Kylian Mbappé',  278),
  ('<dave>',  'Lionel Messi',   154),
  ('<eve>',   'Vinicius Jr',    2295);
```

```sql
-- Verify
SELECT p.username, cp.team, cp.points_earned
  FROM public.champion_pick cp
  JOIN public.profiles p ON p.id = cp.user_id;

SELECT p.username, ts.player_name, ts.top_scorer_api_id, ts.points_earned
  FROM public.top_scorer_pick ts
  JOIN public.profiles p ON p.id = ts.user_id;
```

**Expected — all points_earned = 0**

### Step 3 — Seed player stats for top scorer calculation
```sql
-- Use game-A (already has score set from Feature 3 testing)
-- First make sure game-A has a score
UPDATE public.games SET score_home = 2, score_away = 1 WHERE id = '<game-A>';

-- Mbappé scores 3 goals across 2 games — becomes top scorer
INSERT INTO public.game_player_stats (game_id, api_player_id, player_name, team, goals, assists, minutes_played)
VALUES
  ('<game-A>', 278,  'Kylian Mbappé',  'France',    3, 1, 90),
  ('<game-A>', 1100, 'Erling Haaland', 'Norway',    1, 0, 90),
  ('<game-A>', 154,  'Lionel Messi',   'Argentina', 1, 1, 90);

-- Verify view picks up the data
SELECT api_player_id, player_name, total_goals, total_assists
  FROM public.player_tournament_stats
  ORDER BY total_goals DESC;
```

**Expected:**
```
278  | Kylian Mbappé  | 3 | 1
1100 | Erling Haaland | 1 | 0
154  | Lionel Messi   | 1 | 1
```

### Step 4 — Trigger fn_calculate_pick_points
```sql
-- Find the final game row
SELECT id FROM public.games WHERE phase = 'final';

-- Set knockout_winner = 'Brazil' (fires trigger)
UPDATE public.games
  SET knockout_winner = 'Brazil'
  WHERE phase = 'final';

-- Check champion pick points
SELECT p.username, cp.team, cp.points_earned
  FROM public.champion_pick cp
  JOIN public.profiles p ON p.id = cp.user_id
  ORDER BY cp.points_earned DESC;
```

**Expected:**
```
alice_wc | Brazil    | 10
carol_wc | Brazil    | 10
bob_wc   | France    | 0
dave_wc  | Argentina | 0
eve_wc   | Spain     | 0
```

```sql
-- Check top scorer pick points
SELECT p.username, ts.player_name, ts.points_earned
  FROM public.top_scorer_pick ts
  JOIN public.profiles p ON p.id = ts.user_id
  ORDER BY ts.points_earned DESC;
```

**Expected:**
```
alice_wc | Kylian Mbappé  | 10
carol_wc | Kylian Mbappé  | 10
bob_wc   | Erling Haaland | 0
dave_wc  | Lionel Messi   | 0
eve_wc   | Vinicius Jr    | 0
```

### Step 5 — Test idempotency (score correction)
```sql
-- Oops, France won — update and re-trigger
UPDATE public.games
  SET knockout_winner = 'France'
  WHERE phase = 'final';

SELECT p.username, cp.team, cp.points_earned
  FROM public.champion_pick cp
  JOIN public.profiles p ON p.id = cp.user_id
  ORDER BY cp.points_earned DESC;
```

**Expected (reset and re-awarded):**
```
bob_wc   | France    | 10   ← now correct
alice_wc | Brazil    | 0    ← reset
carol_wc | Brazil    | 0    ← reset
dave_wc  | Argentina | 0
eve_wc   | Spain     | 0
```

```sql
-- Reset for final testing state: Brazil wins
UPDATE public.games SET knockout_winner = 'Brazil' WHERE phase = 'final';
```

### Step 6 — Test lock date enforcement (browser test page)

**Test page:** `test/test-picks.html`

Sign in as alice. The page shows:
- Champion pick form (dropdown of 48 teams)
- Top scorer pick form (player name + api_player_id)
- Current picks displayed
- Lock status (before/after June 11 2026)

Expected behavior:
- Before June 11 → can save/update picks
- Page shows current picks (own: always visible)
- After June 11 → form is disabled, all picks visible (public)

### Done when
- [ ] Picks saved correctly for all 5 users
- [ ] `fn_calculate_pick_points` awards 10pt to correct pickers
- [ ] Reset and re-award works correctly (idempotency)
- [ ] Top scorer matched by `top_scorer_api_id` (not player name text)
- [ ] `top_scorer_api_id = NULL` picks don't crash the trigger

---

## Feature 6 — Leaderboard

### What it covers
`leaderboard` view + `get_leaderboard()` + `get_group_leaderboard()` RPCs. Ranks users by `total_points DESC → exact_scores DESC → username ASC`. Group leaderboard adds `group_rank` and `global_rank`, gated to members only.

### Step 1 — Verify DB objects
```sql
-- View exists
SELECT viewname FROM pg_views WHERE viewname = 'leaderboard';

-- RPCs exist and are SECURITY DEFINER
SELECT proname, prosecdef
  FROM pg_proc
  WHERE proname IN ('get_leaderboard', 'get_group_leaderboard');
```

### Step 2 — Set up test state
For this test, use the scoring state from Feature 5 (Brazil wins, Mbappé top scorer):
- alice: 20pt (10 champion + 10 top scorer, plus any prediction points)
- carol: 20pt (same)
- bob: 0pt
- dave: 0pt
- eve: 0pt

Also set prediction points from Feature 3 (alice had exact 2-1 = 3pt):
```sql
UPDATE public.games SET score_home = 2, score_away = 1 WHERE id = '<game-A>';
```

Expected state:
- alice: 23pt (10+10+3), 1 exact score
- carol: 20pt (10+10+0), 0 exact scores
- others: 0pt

### Step 3 — Test global leaderboard
```sql
SELECT rank, username, champion_team, total_points, exact_scores
  FROM public.get_leaderboard();
```

**Expected:**
```
rank | username  | champion_team | total_points | exact_scores
1    | alice_wc  | Brazil        | 23           | 1
2    | carol_wc  | Brazil        | 20           | 0
3    | bob_wc    | France        | 0            | 0
3    | dave_wc   | Argentina     | 0            | 0
3    | eve_wc    | Spain         | 0            | 0
(bob/dave/eve tied at rank 3 — RANK() skips to next)
```

### Step 4 — Test tie-breaking
```sql
-- Give carol an exact score too → alice vs carol both 23pt, alice has 1 exact, carol now has 1
-- They're tied → username breaks tie: alice_wc < carol_wc alphabetically
UPDATE public.predictions
  SET pred_home = 2, pred_away = 1
  WHERE user_id = '<carol>' AND game_id = '<game-A>';
-- Points already calculated; manually set to 3 for this test:
UPDATE public.predictions SET points_earned = 3
  WHERE user_id = '<carol>' AND game_id = '<game-A>';

SELECT rank, username, total_points, exact_scores
  FROM public.get_leaderboard()
  WHERE rank <= 2;
```

**Expected:**
```
rank | username | total_points | exact_scores
1    | alice_wc | 23           | 1
2    | carol_wc | 23           | 1
(tied on points AND exact scores → alice ranks above carol alphabetically)
```

### Step 5 — Test group leaderboard
```sql
-- alice, bob, carol, dave are in group1
SELECT group_rank, global_rank, username, total_points, exact_scores
  FROM public.get_group_leaderboard('<group1-id>');
```

**Expected:**
```
group_rank | global_rank | username  | total_points | exact_scores
1          | 1           | alice_wc  | 23           | 1
2          | 2           | carol_wc  | 23           | 1
3          | 3           | bob_wc    | 0            | 0
4          | 3           | dave_wc   | 0            | 0
(eve not in group → not in results)
```

### Step 6 — Test non-member rejection
```sql
-- Simulate as eve (not in group1) — use her JWT or test in browser
-- This must be called from a session where auth.uid() = <eve>
-- In SQL editor: simulate by testing the logic directly
SELECT public.is_group_member('<group1-id>', '<eve>');
-- Expected: false

-- The RPC will raise 'not_a_member' for eve
-- Test in browser test page below
```

### Step 7 — Verify zero-prediction users appear
```sql
-- eve has no predictions and wrong picks, should still appear in global leaderboard
SELECT username, total_points
  FROM public.get_leaderboard()
  WHERE username = 'eve_wc';
-- Expected: 1 row, total_points = 0
```

### Step 8 — Sanity check: manual total = leaderboard total
```sql
SELECT
  p.username,
  COALESCE(SUM(pr.points_earned), 0) +
    COALESCE(cp.points_earned, 0) +
    COALESCE(ts.points_earned, 0) AS manual_total,
  gl.total_points AS leaderboard_total,
  (
    COALESCE(SUM(pr.points_earned), 0) +
      COALESCE(cp.points_earned, 0) +
      COALESCE(ts.points_earned, 0)
  ) = gl.total_points AS match
FROM public.profiles p
LEFT JOIN public.predictions     pr ON pr.user_id = p.id
LEFT JOIN public.champion_pick   cp ON cp.user_id = p.id
LEFT JOIN public.top_scorer_pick ts ON ts.user_id = p.id
JOIN public.get_leaderboard()    gl ON gl.user_id = p.id
GROUP BY p.username, cp.points_earned, ts.points_earned, gl.total_points
ORDER BY gl.total_points DESC;
```

**Expected: `match = true` for every row**

### Step 9 — Test in browser (browser test page)

**Test page:** `test/test-leaderboard.html`

Sign in as each user and verify:
- Global leaderboard visible to all authenticated users
- Group leaderboard visible to members only
- Non-member gets error when requesting group leaderboard
- Current user's row is highlighted

### Done when
- [ ] Ranking order correct: total_points → exact_scores → username
- [ ] Tie-breaking confirmed
- [ ] `get_group_leaderboard` returns group_rank + global_rank
- [ ] Non-member gets `not_a_member` error
- [ ] All 5 users appear (including zero-point users)
- [ ] `manual_total = leaderboard_total` for every user

---

## Feature 7 — Prediction Distribution RPC

### What it covers
`get_game_prediction_distribution(game_id)` — returns W/D/L split, exact count, and top 5 scorelines across ALL users for a game. Used on `game.html` after kickoff.

### Step 1 — Verify RPC
```sql
SELECT proname, prosecdef FROM pg_proc
  WHERE proname = 'get_game_prediction_distribution';
-- Expected: get_game_prediction_distribution | true
```

### Step 2 — Test with seeded data
Using `<game-A>` which has: alice 2-1, bob 1-1, carol 0-2, dave auto, eve auto (from Features 3+4).

```sql
-- Before score is set (exact_count will be 0)
UPDATE public.games SET score_home = NULL, score_away = NULL WHERE id = '<game-A>';

SELECT public.get_game_prediction_distribution('<game-A>');
```

**Expected (approx, auto predictions are random):**
```json
{
  "total": 5,
  "home_win": 2,   ← alice (2-1) + maybe auto
  "draw": 1,       ← bob (1-1)
  "away_win": 2,   ← carol (0-2) + maybe auto
  "exact_count": 0,
  "top_scores": [
    {"score": "2-1", "count": 1},
    {"score": "1-1", "count": 1},
    {"score": "0-2", "count": 1},
    ...
  ]
}
```

```sql
-- After score 2-1 is set (alice's prediction is exact)
UPDATE public.games SET score_home = 2, score_away = 1 WHERE id = '<game-A>';

SELECT public.get_game_prediction_distribution('<game-A>');
-- exact_count should now be >= 1 (alice's 2-1)
```

**Expected:**
```json
{
  "total": 5,
  "exact_count": 1,
  "top_scores": [{"score": "2-1", "count": 1}, ...]
}
```

### Step 3 — Test empty game
```sql
-- Game with no predictions
SELECT id FROM public.games
  WHERE id NOT IN (SELECT DISTINCT game_id FROM public.predictions)
  LIMIT 1;

SELECT public.get_game_prediction_distribution('<game-no-preds>');
```

**Expected:**
```json
{"total": 0, "home_win": 0, "draw": 0, "away_win": 0, "exact_count": 0, "top_scores": null}
```

No error, returns gracefully.

### Done when
- [ ] W/D/L counts match seeded predictions
- [ ] `exact_count` correctly non-zero after score is set
- [ ] Empty game returns `total: 0` without error

---

## Feature 8 — AI Summary Edge Function

### What it covers
TypeScript Edge Function `nightly-summary`. Called by pg_cron ~110 min after last game of each day. Reads `get_group_summary_data()`, builds a Claude prompt, writes a funny banter summary to `ai_summaries`. Only runs for groups with ≥3 members.

### Step 1 — Verify DB readiness
```sql
-- get_group_summary_data returns valid jsonb
SELECT public.get_group_summary_data('<group1-id>', '<game-A kickoff date>'::date);
-- Expected: jsonb with keys: group_id, date, games, members, leaderboard

-- ai_summaries table and RLS
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ai_summaries';
-- Expected: "ai_summaries: members can select" | SELECT

-- fn_schedule_ai_summaries NOT yet called
SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'ai-summary-%';
-- Expected: 0
```

### Step 2 — Seed: ensure group1 has ≥3 members and today has games with scores
```sql
-- group1 should already have alice, bob, carol, dave (4 members) ✓

-- Ensure game-A has a score (already done in Feature 7)
SELECT score_home, score_away FROM public.games WHERE id = '<game-A>';
-- Expected: 2 | 1

-- Verify get_group_summary_data returns non-empty games array
SELECT public.get_group_summary_data('<group1-id>', (
  SELECT kick_off_time::date FROM public.games WHERE id = '<game-A>'
));
```

**Expected shape:**
```json
{
  "group_id": "<group1-id>",
  "date": "2026-06-11",
  "games": [{"team_home": "Mexico", "team_away": "South Africa", "score_home": 2, "score_away": 1, "phase": "group"}],
  "members": [
    {
      "username": "alice_wc",
      "predictions": [{"game_id": "...", "pred_home": 2, "pred_away": 1, "points": 3, "is_auto": false}],
      "total_exact_scores": 1,
      "current_streak": 1
    },
    ...
  ],
  "leaderboard": [{"group_rank": 1, "username": "alice_wc", "total_points": 23, "exact_scores": 1}, ...]
}
```

### Step 3 — Build Edge Function

**File:** `supabase/functions/nightly-summary/index.ts`

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

Deno.serve(async (req) => {
  // 1. Auth check
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { date } = await req.json()
  if (!date) return new Response('Missing date', { status: 400 })

  // 2. Get all groups with >= 3 members
  const { data: groups } = await supabase
    .from('group_members')
    .select('group_id')
    .then(async ({ data }) => {
      const counts: Record<string, number> = {}
      data?.forEach(r => { counts[r.group_id] = (counts[r.group_id] ?? 0) + 1 })
      return {
        data: Object.entries(counts)
          .filter(([, n]) => n >= 3)
          .map(([group_id]) => ({ group_id }))
      }
    })

  let processed = 0, skipped = 0

  for (const { group_id } of groups ?? []) {
    // 3. Fetch group summary data
    const { data: summary } = await supabase
      .rpc('get_group_summary_data', { p_group_id: group_id, p_date: date })

    if (!summary?.games?.length) { skipped++; continue }

    // 4. Build Claude prompt
    const gamesText = summary.games
      .map((g: any) => `${g.team_home} ${g.score_home}-${g.score_away} ${g.team_away}`)
      .join(', ')

    const leaderboardText = summary.leaderboard
      .slice(0, 5)
      .map((r: any) => `${r.group_rank}. ${r.username} (${r.total_points}pt)`)
      .join(', ')

    const membersText = summary.members.map((m: any) => {
      const preds = (m.predictions ?? [])
        .map((p: any) => {
          const game = summary.games.find((g: any) => g.game_id === p.game_id)
          const matchName = game ? `${game.team_home} vs ${game.team_away}` : 'a game'
          const auto = p.is_auto ? ' [AUTO]' : ''
          return `  predicted ${p.pred_home}-${p.pred_away} for ${matchName} → ${p.points}pt${auto}`
        }).join('\n')
      const streak = m.current_streak > 0
        ? `🔥 ${m.current_streak}-game streak`
        : m.current_streak < 0
        ? `❄️ ${Math.abs(m.current_streak)}-game cold streak`
        : 'neutral streak'
      return `${m.username} (${streak}):\n${preds || '  no predictions'}`
    }).join('\n\n')

    const prompt = `You are a funny football pundit writing a WhatsApp banter summary for a friends prediction group.

Date: ${date}
Games today: ${gamesText}
Group leaderboard: ${leaderboardText}

Member predictions today:
${membersText}

Write a short, funny, social summary (max 200 words). Rules:
- Crown whoever climbed the leaderboard today
- Roast whoever scored 0 or dropped
- Call out bold or unlucky predictions
- Mention streaks if interesting
- Be friendly and funny, like a group chat
- English only, no headers, WhatsApp style`

    // 5. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })

    const content = message.content[0].type === 'text' ? message.content[0].text : ''

    // 6. Upsert into ai_summaries
    await supabase.from('ai_summaries').upsert({
      group_id,
      date,
      content,
      games_count: summary.games.length,
      model: 'claude-sonnet-4-6',
      prompt_tokens: message.usage.input_tokens,
      completion_tokens: message.usage.output_tokens
    }, { onConflict: 'group_id,date' })

    processed++
  }

  return new Response(JSON.stringify({ processed, skipped }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

### Step 4 — Deploy and configure secrets
```bash
# Set secrets
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# Deploy function
supabase functions deploy nightly-summary
```

### Step 5 — Test via curl
```bash
curl -X POST https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/nightly-summary \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-06-11"}'
```

**Expected response:**
```json
{"processed": 1, "skipped": 0}
```

```sql
-- Verify summary was written
SELECT group_id, date, content, games_count, model, prompt_tokens, completion_tokens
  FROM public.ai_summaries;
-- 1 row, content is a funny paragraph about the group's predictions
```

**Expected content (example):**
```
Alice absolutely dominated today, calling Mexico's 2-1 win while Bob thought it'd be a bore draw.
Carol went for chaos with South Africa winning — didn't age well. Dave and Eve both got auto-picked,
which honestly still beat Carol's effort. Alice sits top of the group with 23pts.
Leaderboard shakeup: no one is safe from Alice. 🏆
```

### Step 6 — Test edge cases
```bash
# Group with < 3 members should be skipped
# Group with no finished games that day should be skipped
curl -X POST ... -d '{"date": "2030-01-01"}'
# Expected: {"processed": 0, "skipped": N}
```

### Step 7 — Schedule cron jobs
```sql
-- Set app-level settings (run in SQL editor)
ALTER DATABASE postgres
  SET app.edge_function_url = 'https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1';
ALTER DATABASE postgres
  SET app.service_role_key = '<service_role_key>';

-- Schedule all game-day jobs
SELECT public.fn_schedule_ai_summaries();

-- Verify: ~35 jobs (one per distinct UTC game-day)
SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'ai-summary-%';
```

**Expected: 35–40 rows**

### Step 8 — Test member RLS (browser test page)

**Test page:** `test/test-ai-feed.html`

Sign in as alice (group1 member) and dave (also group1 member):
- Both should see the summary

Sign in as eve (not in group1):
- Should see no summaries

### Done when
- [ ] Function deploys without errors
- [ ] Manual curl writes a row to `ai_summaries` with funny content
- [ ] `processed: 1`, `skipped: 0` for a group with games
- [ ] `processed: 0` for date with no finished games
- [ ] Group with < 3 members skipped
- [ ] Member RLS: alice/dave see summary, eve sees nothing
- [ ] `fn_schedule_ai_summaries()` called, ~35 cron jobs registered

---

## Feature 9 — Game Stats Views (Phase 4 Readiness)

### What it covers
`game_team_stats` + `game_player_stats` tables and `team_tournament_stats` + `player_tournament_stats` views. Written by Phase 4 football API sync. This feature verifies schema, views, and RLS are correct before the API integration.

### Step 1 — Verify DB objects
```sql
-- Tables and views
SELECT tablename FROM pg_tables
  WHERE tablename IN ('game_team_stats', 'game_player_stats');
SELECT viewname FROM pg_views
  WHERE viewname IN ('team_tournament_stats', 'player_tournament_stats');

-- RLS: public read on both tables
SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE tablename IN ('game_team_stats', 'game_player_stats');

-- No ORDER BY in player_tournament_stats (Fix 4)
SELECT pg_get_viewdef('public.player_tournament_stats');
-- Must NOT contain 'ORDER BY'

-- Indexes exist
SELECT indexname FROM pg_indexes
  WHERE tablename IN ('game_team_stats', 'game_player_stats');
```

**Expected policies:**
```
game_team_stats   | game_team_stats: public read   | SELECT
game_player_stats | game_player_stats: public read | SELECT
```

### Step 2 — Seed team and player stats
```sql
-- Need at least 2 finished games for meaningful averages
-- Use game-A (already scored 2-1) and seed one more game:

-- Find second finished game or score one manually
SELECT id, team_home, team_away FROM public.games
  WHERE score_home IS NOT NULL
  ORDER BY kick_off_time LIMIT 2;

-- Seed game_team_stats for game-A (Mexico 2-1 South Africa)
INSERT INTO public.game_team_stats
  (game_id, team, possession, shots_total, shots_on_target, corners, fouls, yellow_cards, red_cards, offsides)
VALUES
  ('<game-A>', 'Mexico',       58, 15, 7, 6, 11, 1, 0, 3),
  ('<game-A>', 'South Africa', 42, 8,  3, 3, 14, 2, 1, 1);

-- Seed player stats (already done partially in Feature 5)
-- Top up with more players
INSERT INTO public.game_player_stats
  (game_id, api_player_id, player_name, team, goals, assists, yellow_cards, minutes_played)
VALUES
  ('<game-A>', 501, 'Hirving Lozano', 'Mexico',       1, 1, 0, 90),
  ('<game-A>', 502, 'Raul Jimenez',   'Mexico',       1, 0, 1, 90),
  ('<game-A>', 503, 'Percy Tau',      'South Africa', 0, 0, 1, 90)
ON CONFLICT (game_id, api_player_id) DO NOTHING;
```

### Step 3 — Verify team stats view
```sql
SELECT *
  FROM public.team_tournament_stats
  WHERE team IN ('Mexico', 'South Africa', 'France')
  ORDER BY team;
```

**Expected (Mexico — 1 game played, won 2-1):**
```
team         | games_played | wins | draws | losses | avg_possession | avg_shots_total | avg_goals_scored | avg_goals_conceded
Mexico       | 1            | 1    | 0     | 0      | 58.0           | 15.0            | 2.0              | 1.0
South Africa | 1            | 0    | 0     | 1      | 42.0           | 8.0             | 1.0              | 2.0
France       | 1            | 1    | 0     | 0      | null           | null            | 2.0              | 0.0
(France from Feature 5 player stats — no team stats seeded for France yet)
```

### Step 4 — Verify player stats view
```sql
SELECT api_player_id, player_name, team, total_goals, total_assists, games_played
  FROM public.player_tournament_stats
  ORDER BY total_goals DESC, total_assists DESC
  LIMIT 5;
```

**Expected:**
```
api_player_id | player_name    | team   | total_goals | total_assists | games_played
278           | Kylian Mbappé  | France | 3           | 1             | 1
501           | Hirving Lozano | Mexico | 1           | 1             | 1
154           | Lionel Messi   | Arg    | 1           | 1             | 1
502           | Raul Jimenez   | Mexico | 1           | 0             | 1
1100          | Erling Haaland | Norway | 1           | 0             | 1
```

### Step 5 — Verify public read (no auth required)
```sql
-- Test as anon role (Supabase SQL editor)
SET ROLE anon;
SELECT COUNT(*) FROM public.game_team_stats;   -- should return count, not permission error
SELECT COUNT(*) FROM public.game_player_stats; -- same
RESET ROLE;
```

### Step 6 — Check constraints work (service role)
```sql
-- Test score_home >= 0 constraint on games
UPDATE public.games SET score_home = -1 WHERE id = '<game-A>';
-- Expected: ERROR: violates check constraint "games_scores_non_negative"

-- Test group_name phase constraint
UPDATE public.games SET group_name = 'A' WHERE phase = 'final';
-- Expected: ERROR: violates check constraint "games_group_name_phase"
```

### Done when
- [ ] Both tables accept inserts from service role
- [ ] `team_tournament_stats` shows correct W/D/L and averages
- [ ] `player_tournament_stats` has no ORDER BY in definition
- [ ] Public read confirmed (anon role can SELECT)
- [ ] CHECK constraints reject bad data

---

## Test Pages Index

Each test page in `test/` is standalone HTML — no build step, imports `_supabase` from `../js/supabase.js`.

| Page | Tests |
|---|---|
| `test/test-auth.html` | Sign up, create_profile RPC, sign in, profile list |
| `test/test-groups.html` | Create group, join group, invite code, RLS visibility |
| `test/test-predictions.html` | Submit prediction, deadline enforcement, kickoff reveal |
| `test/test-picks.html` | Champion pick, top scorer pick, lock date, upsert |
| `test/test-leaderboard.html` | Global leaderboard, group leaderboard, non-member block |
| `test/test-ai-feed.html` | AI summaries visibility per group |

---

## Execution Order

| # | Feature | Depends on | Output |
|---|---|---|---|
| 0 | Deploy Migration 9 | — | knockout_winner, create_profile, fn_calculate_pick_points |
| 1 | Profiles | Migration 9 | 5 test users in DB |
| 2 | Groups | Feature 1 | 2 groups, invite codes, members |
| 3 | Predictions + Points | Features 1, 2 | Predictions, trigger verified |
| 4 | Auto-Predict cron | Feature 3 | 104 jobs, manual trigger test |
| 5 | Champion + Top Scorer | Feature 1 | Picks + trigger verified |
| 6 | Leaderboard | Features 3, 5 | Rankings + sanity check |
| 7 | Prediction Distribution | Feature 3 | Distribution RPC verified |
| 8 | AI Summary Edge Function | Features 2, 6 | Function deployed + scheduled |
| 9 | Game Stats Views | Games seeded | Views verified, constraints tested |
