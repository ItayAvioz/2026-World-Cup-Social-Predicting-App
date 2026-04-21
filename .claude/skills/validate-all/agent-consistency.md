# Agent 5 — Cross-Document Consistency Validator

## Role
Read all project documentation files and find conflicts, contradictions, outdated content,
and field name mismatches between documents. Sources of truth are CLAUDE.md and SKILL.md.
Everything else (docs/*.md, ERD.md) is checked against these.

## STRICT RULE: READ-ONLY, NO DB CALLS
This agent reads files only. No SQL queries, no network calls.

---

## Step 1 — Load ALL Documents

Read ALL of these files:
1. `C:\Users\yonatanam\Desktop\World_Cup_APP\CLAUDE.md` ← SOURCE OF TRUTH
2. `C:\Users\yonatanam\Desktop\World_Cup_APP\.claude\skills\db-feature\SKILL.md` ← SOURCE OF TRUTH
3. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\MEMORY.md` ← SOURCE (project index — read first)
4. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\db-phase.md` ← SOURCE
5. `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\edge-function-phase.md` ← SOURCE
5. `C:\Users\yonatanam\Desktop\World_Cup_APP\docs\ERD.md`
6. `C:\Users\yonatanam\Desktop\World_Cup_APP\docs\DATA_SOURCES.md`
7. `C:\Users\yonatanam\Desktop\World_Cup_APP\docs\ERROR_HANDLING.md`
8. `C:\Users\yonatanam\Desktop\World_Cup_APP\docs\PLAN.md`
9. `C:\Users\yonatanam\Desktop\World_Cup_APP\docs\TESTING_PLAN_API.md`
10. `C:\Users\yonatanam\Desktop\World_Cup_APP\docs\TESTING_PLAN_F8.md`
11. `C:\Users\yonatanam\Desktop\World_Cup_APP\supabase\CLAUDE.md`

Then read ALL migration files:
- `supabase/migrations/20260312000001_groups.sql` through `20260316000021_game_odds.sql`

Also read test pages:
- `test/test-auth.html`, `test/test-groups.html`, `test/test-predictions.html`
- `test/test-picks.html`, `test/test-leaderboard.html`, `test/test-ai-feed.html`
- `test/test-game-stats.html`

---

## Step 2 — Consistency Checks

No SQL needed. All file-based comparisons. Run each check once.

---

### CHECK C-01: docs/ERD.md vs SKILL.md — Table Inventory
Compare every table in `docs/ERD.md` against tables in `SKILL.md`.

**Known divergence (document each):**
- `docs/ERD.md` has `teams` table → NOT in SKILL.md / NOT in DB
- `docs/ERD.md` has `players` table → NOT in SKILL.md / NOT in DB
- `docs/ERD.md` has `standings` table → NOT in SKILL.md / NOT in DB
- `docs/ERD.md` has `leaderboard_snapshots` table → NOT in SKILL.md / NOT in DB
- `docs/ERD.md` has `user_achievements` table → NOT in SKILL.md / NOT in DB
- `docs/ERD.md` has `player_unavailability` table → NOT in SKILL.md / NOT in DB
- `docs/ERD.md` has `odds` table (different schema) → DB has `game_odds` with different columns

**Verdict:** docs/ERD.md is an OUTDATED planning document — not the live schema.
Flag: ❌ Critical — this doc contradicts SKILL.md and could mislead future development.
Recommendation: Archive or delete docs/ERD.md, or add prominent OUTDATED header.

---

### CHECK C-02: docs/ERD.md — Columns that Conflict with Rules
Check for columns in `docs/ERD.md` that directly violate established DB rules:

- `games.status` column — **MUST NOT EXIST** per CLAUDE.md + SKILL.md
  → docs/ERD.md shows a `status` field on games → ❌ Critical conflict with rule
- `group_members.role` (captain/member) — NOT in actual DB (is_inactive flag is used)
  → docs/ERD.md shows role column → ⚠️ Gap
- `predictions.confidence` — NOT in actual DB
  → docs/ERD.md shows confidence field → ⚠️ Gap / outdated feature
- `predictions.last_modified_at` vs DB's `updated_at`
  → docs/ERD.md uses different column name → ⚠️ naming mismatch
- `games.completed_at` — NOT in actual DB
  → docs/ERD.md shows completed_at → ⚠️ outdated
- `games.matchday` — NOT in actual DB → ⚠️ outdated
- `games.venue` — NOT in actual DB → ⚠️ outdated
- `games.api_football_id` — NOT in actual DB (col is `api_fixture_id`, migration 22 pending)
  → docs/ERD.md uses api_football_id → naming mismatch

---

### CHECK C-03: docs/DATA_SOURCES.md — Known Mismatches vs SKILL.md
docs/DATA_SOURCES.md has a section "Column Names — DB is the Determinant" with known mismatches.
Read that section carefully, then cross-check each mismatch against SKILL.md:

| DATA_SOURCES.md Field | SKILL.md Column | Status |
|---|---|---|
| api_football_id | api_fixture_id | ⚠️ Migration 22 pending |
| score_home_et | et_score_home | ⚠️ Name changed |
| score.penalty (bool) | penalty_score_home/away (int) | ⚠️ Type changed |
| game_results table | game_team_stats | ⚠️ Table renamed |
| status column | (does not exist) | ❌ Must not exist |
| player_tournament_stats (table) | player_tournament_stats (VIEW) | ⚠️ Type changed |

For each item, verify whether:
- DATA_SOURCES.md has been updated to reflect the current DB (or still shows the old value)
- Any migration file still uses the old name

---

### CHECK C-04: CLAUDE.md vs SKILL.md — Scoring Rules Consistency
- CLAUDE.md: "exact score = 3pt, correct outcome = 1pt (not additive)"
- SKILL.md Scoring Rules table: same values?
Compare both documents — do they agree exactly?

Also check SKILL.md notes on predictions:
"Points: exact score = 3pt, correct outcome = 1pt (NOT additive)"
→ Should match CLAUDE.md exactly. Any discrepancy → ⚠️ Gap.

---

### CHECK C-05: CLAUDE.md vs SKILL.md — Group Rules Consistency
Cross-check every group rule between the two documents:

| Rule | CLAUDE.md | SKILL.md | Match? |
|---|---|---|---|
| Max groups per creator | 3 | 3 | |
| Max members per group | 10 | 10 | |
| Rename lock date | June 11 19:00 UTC | 2026-06-11T19:00:00Z | |
| Leave group | Never | No DELETE policy | |
| Captain transfer | Never | created_by fixed | |
| Invite code length | 6-char alphanumeric | 6-char alphanumeric | |

---

### CHECK C-06: CLAUDE.md vs SKILL.md — Deadlines Consistency
CLAUDE.md lists:
- "Champion + top scorer picks: lock permanently at June 11 2026 kickoff"
- "All protected pages check for active session on load"

SKILL.md notes RLS lock at `2026-06-11T19:00:00Z`.

Check migration 11 (group_rename_lock) and picks migrations — do they all use the exact
same timestamp `2026-06-11T19:00:00Z`? Any variation (e.g., 2026-06-11 19:00 vs T19:00:00Z)
could cause timezone-related lock inconsistency.

Read migration files and compare timestamp format used in each.

---

### CHECK C-07: ERROR_HANDLING.md vs SKILL.md — Consistency
docs/ERROR_HANDLING.md describes error handling for:
- Pre-game KO verification
- Score polling
- Stats calls
- DB write errors
- Odds
- Nightly summary (F8)

Cross-check each error handler against SKILL.md:
- Does ERROR_HANDLING.md reference `game_team_stats` (correct) or old `game_results`?
- Does it reference `score_home IS NOT NULL` (correct) or `status = FT` (wrong)?
- Does F8 section reference `failed_summaries` table (migration 20)?
- Does it describe the retry pattern that matches the EF design in memory/edge-function-phase.md?

---

### CHECK C-08: docs/PLAN.md Completeness vs Features Built
Read docs/PLAN.md feature list. Cross-check against db-phase.md DB Build Status.
For each feature in PLAN.md:
- Is it marked done?
- Does it match what db-phase.md says is deployed?
- Any feature in PLAN.md that's "done" but doesn't appear in db-phase.md?
- Any feature deployed (in db-phase.md) that's not in PLAN.md?

---

### CHECK C-09: Test Pages vs Feature Spec
For each test page in `test/`, verify it covers the feature it claims to test:
- Does `test/test-auth.html` test F1 (profiles + create_profile)?
- Does `test/test-groups.html` test F2 (create_group, join_group, invite codes, RLS)?
- Does `test/test-predictions.html` test F3 + F7 (predictions + distribution)?
- Does `test/test-picks.html` test F5 (champion + top scorer)?
- Does `test/test-leaderboard.html` test F6 (global + group leaderboard)?
- Does `test/test-ai-feed.html` test F8 (ai_summaries + EF trigger)?
- Does `test/test-game-stats.html` test F9 (game_team_stats + views)?

Gaps: Is there a test page for `game_odds`? For `failed_summaries`? For `delete_account`?

---

### CHECK C-10: CLAUDE.md User Self-Service vs Migration 10
CLAUDE.md defines rules:
| Action | Rule |
|---|---|
| Rename username | Allowed until June 11 19:00 UTC |
| Delete account | Before June 11 AND not in group |
| Rename group | Allowed until June 11 19:00 UTC |
| Leave group | Never |
| Delete group | Never |

Read migration 10 (`user_self_service.sql`) and verify each rule is implemented.
Look for: account_locked error, cannot_delete_in_group error, date check, group membership check.

---

### CHECK C-11: CLAUDE.md App Description vs What's Built
CLAUDE.md lists frontend pages. Cross-check which pages actually exist:
```
Check if these HTML files exist:
- index.html, dashboard.html, game.html, picks.html, groups.html
- ai-feed.html, host.html, team.html, predict.html
```
Report which pages exist and which are missing (predict.html is marked [TBD]).

---

### CHECK C-12: Supabase CLAUDE.md Migration List vs Files
Read `supabase/CLAUDE.md` "Deployed" section — lists migrations 9–21.
Cross-check against actual files in `supabase/migrations/`.
Any migration listed as deployed but file doesn't exist → ❌ Critical.
Any migration file that exists but not listed → ⚠️ Gap.

---

## Step 3 — Report Format

```
CHECK   | C-01
NAME    | docs/ERD.md vs SKILL.md — table inventory
STATUS  | ❌ CRITICAL
FINDING | docs/ERD.md contains 7 tables not in live DB: teams, players, standings,
          leaderboard_snapshots, user_achievements, player_unavailability, odds (wrong schema)
SOURCE  | docs/ERD.md vs SKILL.md
FIX     | Add "⚠️ OUTDATED — superseded by SKILL.md" header to docs/ERD.md, or delete
```

Severity:
- ❌ Critical — document actively contradicts a hard rule (e.g., status column, wrong scoring)
- ⚠️ Gap — document is outdated or describes a feature that was changed
- ℹ️ Missing — no test page for a feature, no doc covering an error case
- 📋 Decision — documented as TBD or pending — needs a decision before next phase
