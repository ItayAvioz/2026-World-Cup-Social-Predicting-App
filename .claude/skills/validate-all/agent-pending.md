# Agent 6 — Pending Items Tracker

## Role
Scan ALL project files for unresolved items: ⚠️ markers, TODO, TBD, PENDING, "not yet",
"future", "decision pending", and known blockers. Map each item to its phase and
what it blocks. Produce a prioritized table of what must be resolved before the
Edge Function phase can start.

## STRICT RULE: READ-ONLY, NO DB CALLS
File reads only. No SQL, no network calls. No modifications.

---

## Step 1 — Files to Scan

Read ALL of these files and scan for pending markers:

**Sources of truth:**
- `C:\Users\yonatanam\Desktop\World_Cup_APP\CLAUDE.md`
- `C:\Users\yonatanam\Desktop\World_Cup_APP\.claude\skills\db-feature\SKILL.md`
- `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\MEMORY.md` ← read first (project index)
- `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\db-phase.md`
- `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\memory\edge-function-phase.md`
- `C:\Users\yonatanam\Desktop\World_Cup_APP\supabase\CLAUDE.md`

**Documentation:**
- `docs/DATA_SOURCES.md`
- `docs/ERROR_HANDLING.md`
- `docs/PLAN.md`
- `docs/TESTING_PLAN_API.md`
- `docs/TESTING_PLAN_F8.md`

**All migration SQL files** (scan comments for ⚠️ and TODO):
- All files in `supabase/migrations/`

---

## Step 2 — Known Items to Verify

These are items already identified. Confirm each one still applies and add any new ones found.

---

### KNOWN ITEM P-01: Migration 22 — api_fixture_id column on games
**Source:** docs/DATA_SOURCES.md (⚠️ section at top)
**Details:** `api_fixture_id` column does not exist on `games` table yet.
Needed for all football API sync calls — every API call uses `{api_fixture_id}`.
**Blocks:** football-api-sync Edge Function (Phase 4)
**Phase:** DB — must add before building EF
**Priority:** HIGH (blocks entire API sync)
**Decision needed?** No — decision is made. Just needs migration.

---

### KNOWN ITEM P-02: fn_schedule_ai_summaries() not called
**Source:** memory/db-phase.md + memory/edge-function-phase.md
**Details:** Function exists but has never been called. Requires EF URL + service_role_key.
**Blocks:** Nightly summary Edge Function scheduling
**Phase:** EF — call after nightly-summary EF is deployed and verified
**Priority:** HIGH (critical path for EF phase)
**Decision needed?** No — timing is clear.

---

### KNOWN ITEM P-03: API source not chosen
**Source:** docs/DATA_SOURCES.md "⚠️ Source Selection — PENDING"
**Options:** A: api-football.com vs B: football-data.org
**Blocks:** football-api-sync Edge Function entirely
**Phase:** Must decide before building football-api-sync
**Priority:** HIGH (blocks Phase 4)
**Decision needed?** YES — api-football.com vs football-data.org

---

### KNOWN ITEM P-04: Claude model for nightly-summary not decided
**Source:** memory/edge-function-phase.md "Model: TBD (Haiku vs Sonnet — decide before build)"
  Also docs/ERROR_HANDLING.md F8 Rate Limit Notes
**Blocks:** nightly-summary Edge Function build
**Phase:** EF — decide before writing the function
**Priority:** MEDIUM (need to decide at build time, not before)
**Decision needed?** YES — Haiku (faster/cheaper) vs Sonnet (better quality)

---

### KNOWN ITEM P-05: First-game stats display — Option A/B/C decision
**Source:** SKILL.md game_odds section (last few lines)
**Options:**
- A: Empty state — "First tournament game — no stats available yet"
- B: Pre-tournament form from API (extra table needed)
- C: Odds only — hide stats panel entirely for game 1 (leaning this)
**Blocks:** game.html frontend (game stats display)
**Phase:** Frontend
**Priority:** LOW (can decide at frontend build time)
**Decision needed?** YES — affects frontend implementation of game.html

---

### KNOWN ITEM P-06: champion_pick.team CHECK constraint — placeholder team names
**Source:** memory/db-phase.md "Pending Schema" section
**Details:** The CHECK constraint includes placeholder team names (UEFA PO-A/B/C/D, IC PO-1/2)
for teams whose playoff spots aren't resolved yet. Must update to real team names once resolved.
**Blocks:** Data integrity (wrong team could be picked)
**Phase:** DB — update before tournament starts (before June 11)
**Priority:** MEDIUM (can wait until playoff results)
**Decision needed?** No — just wait for playoff results, then update migration.

---

### KNOWN ITEM P-07: F9 (Game Stats) verification pending
**Source:** memory/MEMORY.md + memory/db-phase.md
**Details:** F9 is the last unverified feature. db-phase.md shows all other features verified.
game_team_stats + game_player_stats + views exist but F9 browser/SQL test not yet done.
**Blocks:** Full DB phase sign-off
**Phase:** DB — last step before EF phase
**Priority:** HIGH (gate to next phase)
**Decision needed?** No — just run `/verify-feature 9`

---

### KNOWN ITEM P-08: Data field mapping verification required before EF build
**Source:** docs/DATA_SOURCES.md "⚠️ FIRST GAME STAT NOTE" + field mapping table
**Details:** Many fields marked "✅ verify API field name/path" — actual API response format
must be confirmed against real api-football.com response before EF is coded.
**Blocks:** football-api-sync Edge Function (incorrect field names = silent data loss)
**Phase:** Pre-EF research task
**Priority:** HIGH
**Decision needed?** No — verification task, not a design decision.

---

### KNOWN ITEM P-09: Edge Function URL needed for fn_schedule_ai_summaries
**Source:** memory/edge-function-phase.md Schedule Setup section
Requires: `app.edge_function_url` and `app.service_role_key` database params set,
then `SELECT public.fn_schedule_ai_summaries()` called.
**Blocks:** AI summary scheduling
**Phase:** EF — after nightly-summary deployed + tested
**Priority:** HIGH (part of EF activation)
**Decision needed?** No — procedural step.

---

### KNOWN ITEM P-10: over_2_5 / under_2_5 odds — future feature
**Source:** SKILL.md game_odds table notes
**Details:** game_odds table has home_win, draw, away_win only.
over_2_5 and under_2_5 markets noted as future additions.
**Blocks:** Nothing currently
**Phase:** Future (not in current scope)
**Priority:** LOW
**Decision needed?** No — deferred explicitly.

---

## Step 3 — Scan for Additional Items

After verifying the known items above, scan all files for these patterns:
- `⚠️`
- `TODO`
- `TBD`
- `PENDING`
- `pending`
- `not yet`
- `future`
- `[OPTIONAL]`
- `decision pending`
- `verify API`
- `Migration 22`
- `FUTURE`

For each new item found: extract it, identify source file + line, categorize, add to report.

---

## Step 4 — Blocker Analysis

After collecting all items, group them by what they block:

**Blocks EF Phase (nightly-summary):**
- List items

**Blocks EF Phase (football-api-sync / Phase 4):**
- List items

**Blocks Frontend Phase:**
- List items

**Blocks Launch (before June 11):**
- List items

**No immediate blocker (future/deferred):**
- List items

---

## Step 5 — Report Format

### Priority Table

```
# Pending Items — Priority Table

| ID   | Item                              | Blocks          | Priority | Decision? | Phase |
|------|-----------------------------------|-----------------|----------|-----------|-------|
| P-01 | Migration 22 (api_fixture_id)     | football-api-sync | HIGH   | No        | DB    |
| P-02 | fn_schedule_ai_summaries not called | AI summaries  | HIGH   | No        | EF    |
| P-03 | API source not chosen             | All API sync    | HIGH     | YES ←     | Pre-EF|
| P-04 | Claude model for EF               | nightly-summary | MEDIUM   | YES ←     | EF    |
| P-05 | First-game stats display          | game.html       | LOW      | YES ←     | FE    |
| P-06 | Placeholder team names in CHECK   | Data integrity  | MEDIUM   | No        | DB    |
| P-07 | F9 not verified                   | DB phase close  | HIGH     | No        | DB    |
| P-08 | API field mapping verification    | EF correctness  | HIGH     | No        | Pre-EF|
| P-09 | EF URL for schedule               | AI scheduling   | HIGH     | No        | EF    |
| P-10 | over/under odds                   | Nothing yet     | LOW      | No        | Future|
| ...  | [new items found in scan]         |                 |          |           |       |
```

### Items Requiring a Decision (marked YES above)
List these prominently — they can't be resolved by building, only by deciding.

### Recommended Order to Resolve Before EF Phase
1. ...
2. ...
3. ...
