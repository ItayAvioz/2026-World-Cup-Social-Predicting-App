---
name: verify-feature
description: Runs full automated verification for a WorldCup 2026 feature. SQL checks run automatically. Only browser test is manual. Pass 0–9.
argument-hint: "[0-9]"
allowed-tools: Read, Bash, Grep
---

# WorldCup 2026 — Feature Verifier

**Rule: everything runs automatically. The ONLY manual step is the browser test.**

Flow per feature:
1. Auto-run all SQL checks → grade each ✅/❌
2. If something is missing → show the fix SQL once, say "run this, say done" → wait → re-check automatically
3. Once all SQL checks pass → give browser test instructions → wait for user report
4. Generate feedback report
5. Update memory files

---

## CONFIG

```
PAT  = C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt
API  = https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query
```

Bash query helper (use for every SQL check):
```bash
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SQL_HERE"}'
```

---

## FEATURE CHECKS

### Feature 0 — Pre-Step: Migration 9

Run all checks in one Bash call:
- `games.knockout_winner` column exists
- `top_scorer_pick.top_scorer_api_id` column exists
- `fn_calculate_pick_points` function exists (prosecdef=true)
- `create_profile` function exists (prosecdef=true)
- `trg_calculate_pick_points` trigger on games
- `games_scores_non_negative` constraint on games
- `games_group_name_phase` constraint on games

If any fail → print the full migration SQL from `supabase/migrations/20260314000009_fixes.sql` and say:
> "Paste this in https://supabase.com/dashboard/project/ftryuvfdihmhlzvbpfeu/sql → Run → say **done**"

Wait for "done" then re-run all checks automatically. No browser test for F0.

---

### Feature 1 — User Registration & Profiles

**SQL checks (run automatically):**
1. `profiles` table columns: id (uuid NOT NULL), username (text NOT NULL)
2. RLS policies on profiles: expect 2 — SELECT + INSERT
3. `create_profile` is SECURITY DEFINER
4. `SELECT COUNT(*) FROM public.profiles` — note current count

**Seed check:** If profiles count < 5, check `auth.users`:
- Run `SELECT id, email FROM auth.users ORDER BY created_at LIMIT 10`
- If test users exist (alice/bob/carol/dave/eve @test.com), insert profiles using their real UUIDs
- If test users missing, tell user: "Create in https://supabase.com/dashboard/project/ftryuvfdihmhlzvbpfeu/auth/users — alice@test.com, bob@test.com, carol@test.com, dave@test.com, eve@test.com — password: Test1234! — then say **done**"

**RPC error test (run automatically after seed):**
- `SELECT public.create_profile('ab')` → expect ERROR: invalid_username
- `SELECT public.create_profile('alice_wc')` → expect ERROR: username_taken

**Browser test — `test/test-auth.html`:**
```
Serve: python -m http.server 8080  (run from project root)
Open:  http://localhost:8080/test/test-auth.html

Do:
1. Sign up new user + create_profile → expect "Profile created: [username]"
2. Try duplicate username → expect "username_taken" error
3. Sign in as alice@test.com / Test1234! → profiles list shows all 5 users
4. Try to update a profile → expect blocked (no UPDATE policy)

Report: what worked / what failed / any errors
```

---

### Feature 2 — Friend Groups

**SQL checks:**
1. Tables `groups` + `group_members` exist
2. Triggers on groups: `trg_group_creator_join`, `trg_group_invite_code`
3. RPCs exist: `create_group`, `join_group`, `is_group_member`
4. RLS policies on groups (SELECT, UPDATE) + group_members (SELECT, UPDATE)
5. `SELECT COUNT(*) FROM public.groups` — note count

**Seed check:** If groups count = 0, run seed SQL from `docs/PLAN.md` Feature 2 Step 2 (using real UUIDs from auth.users).

**Logic tests (run automatically):**
- Check invite_code generated (6-char): `SELECT invite_code FROM public.groups LIMIT 2`
- Check alice auto-joined: `SELECT COUNT(*) FROM public.group_members WHERE user_id = '<alice_uuid>'`
- Test limit: `SELECT public.create_group('Test G4')` when alice already has 3 → expect ERROR: max_groups_reached
- Test invalid code: `SELECT public.join_group('ZZZZZZ')` → expect ERROR: invalid_invite_code

**Browser test — `test/test-groups.html`:**
```
Open: http://localhost:8080/test/test-groups.html

Do:
1. Sign in as alice → should see 2 groups (WC Friends + Office Bets)
2. Sign in as bob → should see 1 group (WC Friends only)
3. Sign in as eve → should see 0 groups
4. As eve: create a new group → invite_code generated
5. Join a group using invite code → should work
6. Try joining a group already in → expect "already_member" error

Report: what worked / what failed
```

---

### Feature 3 — Predictions

**SQL checks:**
1. `predictions` table exists with columns: user_id, game_id, pred_home, pred_away, points_earned, is_auto, updated_at
2. Triggers: `trg_calculate_points` on games, `trg_predictions_updated_at` on predictions
3. RLS policies on predictions: SELECT + INSERT + UPDATE (3 policies)
4. `share_a_group` helper function exists
5. `SELECT COUNT(*) FROM public.predictions` — note count

**Seed check:** If predictions count = 0, get game IDs:
- `SELECT id, team_home, team_away FROM public.games ORDER BY kick_off_time LIMIT 3`
- Insert 3 test predictions (alice/bob/carol on game 1) using real UUIDs

**Points trigger test (run automatically):**
- Set score_home=2, score_away=1 on game-A → check alice gets 3pts, others 0
- Correct score to 1-1 → check bob gets 3pts, alice resets to 0
- Reset score to NULL → ready for next test

**updated_at trigger test:**
- Update alice's prediction, confirm updated_at changes

**Browser test — `test/test-predictions.html`:**
```
Open: http://localhost:8080/test/test-predictions.html

Do:
1. Sign in as alice → submit prediction on a future game → should save
2. Try to predict a past game (score already set) → expect 42501 / "Predictions locked"
3. After kickoff (use a game with score set): group members' predictions visible
4. Before kickoff: only your own prediction visible

Report: what worked / what failed
```

---

### Feature 4 — Auto-Predict (pg_cron)

**SQL checks (no browser test):**
1. `SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'auto-predict-%'` → expect 104
2. Sample 3 jobs: `SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'auto-predict-%' LIMIT 3`
3. Manual trigger: pick a game with 0 predictions, call `fn_auto_predict_game('<game_id>')`
4. Verify all profiles got is_auto=true predictions
5. Verify job self-unscheduled: count drops to 103
6. Re-run on game-A (alice has manual pred) → alice's pred unchanged, others filled with is_auto=true

---

### Feature 5 — Champion + Top Scorer Picks

**SQL checks:**
1. Tables `champion_pick` + `top_scorer_pick` exist with correct columns
2. `top_scorer_pick.top_scorer_api_id` column exists (from migration 9)
3. RLS on both tables: INSERT + SELECT + UPDATE per user
4. Lock date enforced: `kick_off_time` for champion = '2026-06-11T19:00:00Z'
5. `SELECT COUNT(*) FROM public.champion_pick` — note count

**Seed + test (run automatically):**
- Insert champion pick for alice: Brazil
- Insert top scorer pick for alice with top_scorer_api_id = 12345
- Verify upsert works (update alice's pick → only 1 row)
- Test lock: try INSERT with submitted_at after 2026-06-11 → expect RLS block

**Browser test — `test/test-picks.html`:**
```
Open: http://localhost:8080/test/test-picks.html

Do:
1. Sign in as bob → pick a champion from dropdown → should save
2. Pick a top scorer (with api player id) → should save
3. Update pick → should upsert (not duplicate)
4. View all picks (post-June-11 simulation if possible)

Report: what worked / what failed
```

---

### Feature 6 — Leaderboard

**SQL checks:**
1. `get_leaderboard()` RPC exists + returns rows with: username, total_points, rank
2. `get_group_leaderboard(p_group_id)` RPC exists + returns: username, total_points, group_rank, global_rank
3. Non-member call → expect ERROR: not_a_member
4. Run `SELECT * FROM get_leaderboard() LIMIT 5` — verify ranking makes sense given current points

**Browser test — `test/test-leaderboard.html`:**
```
Open: http://localhost:8080/test/test-leaderboard.html

Do:
1. Sign in as alice → global leaderboard loads with all users ranked
2. Enter group_id → group leaderboard shows only group members
3. Sign in as eve (not in any group) → group leaderboard with WC Friends group_id → expect error
4. Verify current user row is highlighted

Report: what worked / what failed
```

---

### Feature 7 — Prediction Stats at Kickoff

**SQL checks:**
1. `get_game_prediction_distribution(game_id)` RPC exists
2. Call it on a game with predictions → returns home_win%, draw%, away_win%, avg_goals, most_popular_score
3. Call on game with no predictions → returns zeros/nulls (not an error)

**Browser test — `test/test-predictions.html` (distribution section):**
```
Open: http://localhost:8080/test/test-predictions.html

Do:
1. Load distribution for a game with 3+ predictions
2. Verify: outcome split shown (home/draw/away counts + %)
3. Verify: average goals shown
4. Verify: most popular scoreline shown

Report: what worked / what failed
```

---

### Feature 8 — AI Feed / nightly-summary Edge Function

**SQL checks:**
1. `ai_summaries` table exists: group_id, date, summary, created_at
2. RLS: members can SELECT their group's summaries, non-members blocked
3. `get_group_summary_data(group_id, date)` RPC exists and returns valid JSON

**Edge Function test (via browser — `test/test-ai-feed.html`):**
```
Open: http://localhost:8080/test/test-ai-feed.html

Do:
1. Get group_summary_data for WC Friends + today → shows game data + member predictions
2. Manually POST to Edge Function (button in test page):
   URL: https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/nightly-summary
   Body: {"date": "2026-06-11"}
   Header: service_role_key
   → expect {"processed": N, "skipped": M}
3. Check ai_summaries table populated
4. Sign in as non-member → try to read WC Friends summary → expect blocked

Note: Edge Function must be deployed first. If not deployed, skip step 2 and note as PENDING.

Report: what worked / what failed / Edge Function deployed? yes/no
```

---

### Feature 9 — Game Stats Views

**SQL checks:**
1. `team_tournament_stats` VIEW exists → `SELECT * FROM team_tournament_stats LIMIT 3`
2. `player_tournament_stats` VIEW exists → `SELECT * FROM player_tournament_stats LIMIT 3`
3. `game_team_stats` table exists with correct columns
4. `game_player_stats` table exists with correct columns
5. Insert a test stat row into game_team_stats for a finished game → verify it appears in team_tournament_stats

**Browser test — `test/test-game-stats.html`:**
```
Open: http://localhost:8080/test/test-game-stats.html

Do:
1. Enter service_role key in Section 0 → Save Key
2. Review test games in Section 1 (3 group-stage games)
3. Click "Seed All Test Data" → all 3 scores + team/player stats inserted
4. Click "Run All Checks" → all expected vs actual should be ✅
   Verify: W/D/L counts, avg possession, avg shots, avg goals scored/conceded
   Verify: player goals, assists, games_played aggregated correctly
5. Click "Clean Up Test Data" → scores reset, stats deleted, views empty

Report: what worked / what failed / any ❌ checks
```

---

## FEEDBACK REPORT (after each feature)

```
━━━ Feature N — [Name] ━━━━━━━━━━━━━━━━━━━━━
SQL     ✅/❌  [check]  [note]
BROWSER ✅/❌  [test]   [note]

ISSUES    [#] Critical/Medium/Minor — [desc] → [fix]
GAPS      - [untested edge case]
SUGGEST   - [brief improvement]

OVERALL: ✅ READY / ⚠️ NEEDS FIXES / ❌ BLOCKED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## MEMORY UPDATE (after each feature)

1. Update `memory/db-phase.md` — add verified date + status to DB Build Status table
2. Update `docs/PLAN.md` — check off "Done when" boxes that passed
3. Print: **"Done. Next → `/verify-feature N+1`"**
