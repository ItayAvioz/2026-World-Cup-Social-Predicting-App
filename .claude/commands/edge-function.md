---
name: edge-function
description: Build and deploy WorldCup 2026 Supabase Edge Functions (TypeScript + Deno). Use when building nightly-summary or football-api-sync Edge Functions.
argument-hint: "[nightly-summary | football-api-sync | sync-odds | deploy-all]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# WorldCup 2026 — Edge Function Builder

**Rule: auto-check state first, ask only what can't be answered automatically, build/deploy/verify/report/update.**

---

## STEP 0 — READ CONTEXT FILES

Read ALL of these before anything else:

**Always:**
- `C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/memory/MEMORY.md`
- `C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/memory/edge-function-phase.md`
- `.claude/skills/db-feature/SKILL.md` — live ERD (table/column source of truth)
- `supabase/CLAUDE.md` — deployed migrations log + test users

**Function-specific:**
- `docs/ERROR_HANDLING.md` — error groups A–D (nightly-summary) + 1–7 (api-sync)
- `docs/DATA_SOURCES.md` — API field mappings
- `docs/PLAN_API_SYNC.md` — architecture + cron lifecycle + post-deploy order
- `docs/TESTING_PLAN_F8.md` — 20 test scenarios (nightly-summary)
- `docs/TESTING_PLAN_API.md` — 19 test scenarios (football-api-sync)

**Existing code (read before modifying):**
- `supabase/functions/football-api-sync/index.ts`
- `supabase/functions/sync-odds/index.ts`
- `supabase/migrations/20260326000027_api_sync_cron_infrastructure.sql`

**Test pages:**
- `test/test-ai-feed.html`, `test/test-api-sync.html`, `test/test-odds-sync.html`, `test/test-failed-summaries.html`

---

## STEP 1 — AUTO-CHECK REAL STATE

Run this SQL block automatically to determine actual current state:

```bash
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SELECT proname FROM pg_proc WHERE proname IN ('"'"'fn_schedule_game_sync'"'"','"'"'fn_schedule_retry_sync'"'"','"'"'fn_unschedule_game_sync'"'"','"'"'fn_schedule_odds_sync'"'"','"'"'fn_schedule_ai_summaries'"'"','"'"'get_group_summary_data'"'"') ORDER BY proname"}'
```

Also check:
```bash
# Check which EF files exist locally
ls supabase/functions/ 2>/dev/null || echo "none"

# Check cron jobs (are EFs already wired?)
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SELECT jobname FROM cron.job WHERE jobname IN ('"'"'sync-odds-daily'"'"') OR jobname LIKE '"'"'verify-game-%'"'"' LIMIT 5"}'

# Check DB config vars
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SELECT current_setting('"'"'app.edge_function_url'"'"', true) AS ef_url, CASE WHEN current_setting('"'"'app.service_role_key'"'"', true) IS NOT NULL THEN '"'"'set'"'"' ELSE '"'"'missing'"'"' END AS srk"}'

# Latest finished game date (auto-answers test date question)
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SELECT MAX(kick_off_time::date) AS latest_finished FROM games WHERE score_home IS NOT NULL"}'
```

From this, derive:
- Migration 27 deployed? → `fn_schedule_game_sync` in pg_proc
- nightly-summary EF exists locally? → `supabase/functions/nightly-summary/` in ls
- Crons wired? → `sync-odds-daily` or `verify-game-*` rows
- DB config set? → `ef_url` not null
- Test date → `latest_finished` from games
- Print a real-state status table before proceeding

---

## STEP 2 — ROUTE TO FUNCTION

**If `$ARGUMENTS` provided** → jump directly to that function's section below.

**If `$ARGUMENTS` is empty** → show:
```
Current state: [print results from Step 1]

Which function?
  nightly-summary   — BUILD (not yet written)
  football-api-sync — DEPLOY + VERIFY (code complete)
  sync-odds         — DEPLOY + VERIFY (code complete)
  deploy-all        — deploy all 3 + full setup

Reply with the function name.
```

Wait for user response before continuing.

---

## CONFIG

```
PAT  = C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt
SRK  = C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_service_role_key.txt
PROJ = ftryuvfdihmhlzvbpfeu
EF   = https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1
```

SQL helper:
```bash
PAT=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_pat.txt")
curl -s -X POST "https://api.supabase.com/v1/projects/ftryuvfdihmhlzvbpfeu/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data-binary '{"query":"SQL_HERE"}'
```

EF call helper:
```bash
SRK=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_service_role_key.txt" 2>/dev/null || echo "MISSING")
[ "$SRK" = "MISSING" ] && echo "⚠️ Paste service_role_key into secrets/supabase_service_role_key.txt then say done" && exit 1
curl -s -X POST "https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/FUNCTION" \
  -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
  -d 'BODY'
```

Test users (password: Test1234!):
- alice / 158800e8-8f89-4fbd-8578-5ae3e600dc9f
- bob / 49887af3-ec41-430c-ab5a-76dad5baee1e
- carol / eb6e768a-e143-4e81-9621-6649db8dab7d
- dave / ac6ed3d0-c98c-44a8-95ff-99bcf5d72763
- eve / 69e80611-7f6d-4f02-9af0-cf9fa7fd1a4f

---

## FUNCTION: nightly-summary

### Pre-Checks (auto — run all in one pass)

```sql
-- Tables
SELECT table_name FROM information_schema.tables WHERE table_schema='public'
  AND table_name IN ('ai_summaries','failed_summaries');
-- RPCs
SELECT proname FROM pg_proc WHERE proname IN ('get_group_summary_data','fn_schedule_ai_summaries');
-- Groups that qualify (≥3 active members)
SELECT g.name, COUNT(gm.user_id) AS active_members FROM groups g
  JOIN group_members gm ON gm.group_id=g.id WHERE gm.is_inactive=false
  GROUP BY g.name HAVING COUNT(gm.user_id)>=3;
-- Finished games count + latest date
SELECT COUNT(*) AS finished, MAX(kick_off_time::date) AS latest_date FROM games WHERE score_home IS NOT NULL;
-- ANTHROPIC_API_KEY set? (Supabase vault)
SELECT COUNT(*) FROM vault.decrypted_secrets WHERE name='ANTHROPIC_API_KEY';
```

Grade ✅/❌. If any DB object missing → print fix SQL from relevant migration file → wait for "done" → re-check.

### Pre-Build Questions (ask only what can't be auto-answered)

**Question 1 — Claude model:**
- `claude-haiku-4-5-20251001` (fast, cheap ~$0.003/group/night at scale)
- `claude-sonnet-4-6` (~10× more, higher quality)
- Suggestion: Haiku first, upgrade if quality complaints. Default: Haiku.

**Question 2 — Nightly scheduling:**
- Option A: **Manual only** — EF stays idle, triggered only by football-api-sync (safest for first deploy)
- Option B: **23:00 UTC fallback cron** — fires every night via `fn_schedule_ai_summaries()` (good safety net)
- Default: Option A (manual). Change to B after verifying EF works.

**Auto-answered (do NOT ask user):**
- Test date → use `latest_date` from Pre-Checks above
- ANTHROPIC_API_KEY → checked in Pre-Checks
- Summary length → default 350 words
- Trigger wiring (football-api-sync TODO line) → skip for now, revisit after EF verified

If user says "skip questions" or "use defaults" → proceed immediately with defaults.

### Build

Write `supabase/functions/nightly-summary/index.ts`:

```typescript
// Imports (Deno ESM — no npm)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk'

// Structure:
// 1. Auth check: req.headers.get('Authorization') === `Bearer ${SERVICE_ROLE_KEY}` → 401
// 2. Parse body: { date?: string } — default today UTC (new Date().toISOString().split('T')[0])
// 3. Check finished games on date → if 0: return { processed:0, skipped:0, reason:'no_games_today' }
// 4. Get qualifying groups (≥3 active members, not inactive)
// 5. Sequential processing — 2s gap (await new Promise(r => setTimeout(r, 2000)))
//    For each group:
//      a. supabase.rpc('get_group_summary_data', { p_group_id, p_date })
//      b. Validate: data.games?.length > 0 && data.members?.length >= 3
//      c. Build prompt (see template below)
//      d. anthropic.messages.create({ model, max_tokens:600, messages:[{role:'user',content}] })
//      e. Validate response: content.length > 50 && members.some(m => content.includes(m.username))
//      f. supabase.from('ai_summaries').upsert({ group_id, date, content, games_count, model, ... })
//         → On conflict (group_id, date): update
//      g. If upsert fails → supabase.from('failed_summaries').insert({ group_id, date, content, error_msg })
// 6. Collect errors[], retry failed groups once after first pass (same logic, no further retry)
// 7. Return { processed, skipped, errors: errors.map(e => ({ group_id: e.id, reason: e.msg })) }
//
// Error handling:
//   - Anthropic 429 → log + push to errors[] + continue (do NOT throw)
//   - Anthropic error → log + write fallback to ai_summaries + continue
//   - DB read fail → log + skip group + push to errors[]
//   - DB write fail → write to failed_summaries + continue
//   - Never let one group failure crash the whole run
//
// Timeouts:
//   - Free Supabase EF = 150s max
//   - Estimate: ~4s per group (Claude ~2s + 2s gap) → max ~37 groups on Free tier
//   - Log start time; if elapsed > 120s → stop processing, return partial result with warning
//
// Deno gotchas:
//   - Use Deno.env.get('SECRET')! — not process.env
//   - No top-level await outside Deno.serve()
//   - Supabase client created inside handler (not module scope — avoids stale connections)
```

Claude prompt template:
```
System: You are writing a nightly group chat message for "{group_name}", a friend group
playing a World Cup 2026 predictions game. Max 350 words. English only.

User:
TODAY {date}:
{games: "Brazil 2-1 Argentina | 90min only"}
{et/pens if applicable: "→ ET: 3-1 | Winner: Brazil"}

PREDICTIONS & POINTS:
{members: "alice_wc: predicted 2-0 → 1pt today [AUTO]"}

LEADERBOARD (after today):
{rank. username — total_points pt (Δchange)}

CHAMPION PICKS:
{username → team [ELIMINATED] or [still in]}

Rules: Crown the biggest climber. Roast whoever scored 0 (name them).
Highlight the most surprising prediction. Mention auto-predictions if any.
Focus on human drama — NOT a game recap. Funny, social, banter.

Note on member name safety: use member data from DB only — do not fabricate names.
```

After file is written → add row to FILES CREATED section in `memory/edge-function-phase.md`.

### Deploy

Show these commands — user must run, not auto:
```bash
# From project root
supabase functions deploy nightly-summary --project-ref ftryuvfdihmhlzvbpfeu

# Set key only if vault check showed 0 rows
supabase secrets set ANTHROPIC_API_KEY=your_key_here --project-ref ftryuvfdihmhlzvbpfeu

# Confirm deploy
supabase functions list --project-ref ftryuvfdihmhlzvbpfeu
```

If user chose Option B (23:00 UTC cron), also show:
```sql
ALTER DATABASE postgres SET app.edge_function_url = 'https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1';
ALTER DATABASE postgres SET app.service_role_key  = '<from Supabase dashboard Settings→API→Service Role>';
SELECT public.fn_schedule_ai_summaries();
```

Tell user: "Run the commands above and say **deployed**"

### Verify (auto after "deployed")

```bash
# Use test date from Pre-Checks
SRK=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_service_role_key.txt")
curl -s -X POST "https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/nightly-summary" \
  -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
  -d '{"date":"LATEST_FINISHED_DATE"}'
```

**Response validation legend:**
```json
✅ Normal:    { "processed": N, "skipped": M, "errors": [] }
⚠️ Partial:  { "processed": N, "skipped": M, "errors": [{ "group_id": "...", "reason": "..." }] }
              → partial is OK if failed groups have rows in failed_summaries
❌ Blocked:  { "error": "Unauthorized" } → SRK wrong or EF not deployed
❌ Crashed:  { "error": "ANTHROPIC_API_KEY not set" } → secrets not set
❌ No data:  { "processed": 0, "skipped": 0, "reason": "no_games_today" } → test date wrong
```

SQL checks (run automatically after call):
```sql
-- Summaries written
SELECT group_id, date, games_count, model, char_length(content) AS len
FROM ai_summaries ORDER BY generated_at DESC LIMIT 5;

-- Verify <3-member groups were skipped (critical: these should have NO row)
SELECT g.name FROM groups g
WHERE (SELECT COUNT(*) FROM group_members WHERE group_id=g.id AND is_inactive=false) < 3
  AND EXISTS (SELECT 1 FROM ai_summaries WHERE group_id=g.id AND date = current_date);
-- ^ any rows here = BUG: groups below threshold got summaries

-- Unresolved failures + reason
SELECT group_id, error_msg, created_at FROM failed_summaries WHERE resolved=false ORDER BY created_at DESC;

-- Content preview
SELECT LEFT(content, 400) AS preview FROM ai_summaries ORDER BY generated_at DESC LIMIT 1;
```

Content quality check (manual — show result + ask user):
- Print the content preview
- Ask: "Does this sound funny and social, or is it just a game recap? Any issues?"
- If content is bad → diagnose prompt template (may need tuning), not a code bug

Rubric for evaluating content:
- ✅ Mentions at least 2 member usernames
- ✅ Has humor, banter, or roast language (not just score lines)
- ✅ Under 400 words
- ✅ English only
- ❌ Reads like "Brazil beat Argentina 2-1. Alice predicted 2-0." → prompt needs adjustment

---

## FUNCTION: football-api-sync

Code is complete. Modes: `setup`, `verify`, `sync`. Read the full file before proceeding.

### Pre-Checks (auto)

```sql
-- api_fixture_id column exists
SELECT COUNT(*) FROM information_schema.columns WHERE table_name='games' AND column_name='api_fixture_id';
-- Migration 27 functions
SELECT proname FROM pg_proc WHERE proname IN
  ('fn_schedule_game_sync','fn_schedule_retry_sync','fn_unschedule_game_sync');
-- DB config vars
SELECT current_setting('app.edge_function_url', true) AS ef_url,
       CASE WHEN current_setting('app.service_role_key', true) IS NOT NULL THEN 'set' ELSE 'missing' END AS srk;
-- Existing cron jobs
SELECT COUNT(*) AS game_crons FROM cron.job WHERE jobname LIKE 'verify-game-%' OR jobname LIKE 'sync-game-%';
-- FOOTBALL_API_KEY in vault
SELECT COUNT(*) FROM vault.decrypted_secrets WHERE name='FOOTBALL_API_KEY';
```

If migration 27 functions missing → print full SQL from `supabase/migrations/20260326000027_api_sync_cron_infrastructure.sql` → wait for "done" → re-check.

### Deploy

```bash
supabase functions deploy football-api-sync --project-ref ftryuvfdihmhlzvbpfeu
# Only if FOOTBALL_API_KEY not in vault:
supabase secrets set FOOTBALL_API_KEY=<rapidapi_key> --project-ref ftryuvfdihmhlzvbpfeu
```

Post-deploy setup (only if DB config vars missing from Pre-Checks):
```sql
ALTER DATABASE postgres SET app.edge_function_url = 'https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1';
ALTER DATABASE postgres SET app.service_role_key  = '<from Supabase dashboard>';
```

Tell user: "Run deploy + any needed setup. Say **deployed** when done."

### Verify

```bash
# Setup mode — safe to run (maps fixture IDs, idempotent)
SRK=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_service_role_key.txt")
curl -s -X POST "https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/football-api-sync" \
  -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
  -d '{"mode":"setup"}'
```

**Response legend:**
```json
✅ { "status": "done", "matched": N, "skipped": M, "unmatched": [...] }
   → matched = games that got api_fixture_id written
   → skipped = games that already had correct api_fixture_id
   → unmatched = API fixtures Claude couldn't match to DB — review if non-empty
⚠️ unmatched non-empty → team name mismatch; check normalizeTeam() in EF code
❌ { "error": "Unauthorized" } → SRK wrong
❌ { "error": "AUTH_FAILED: check FOOTBALL_API_KEY secret" } → key not set
```

SQL checks:
```sql
-- Fixture IDs mapped for group stage
SELECT COUNT(*) AS mapped, COUNT(*) FILTER (WHERE api_fixture_id IS NULL) AS missing
FROM games WHERE phase='group';
-- Schedule crons for all upcoming mapped games
SELECT fn_schedule_game_sync(id) FROM games
  WHERE kick_off_time > now() AND api_fixture_id IS NOT NULL;
-- Verify crons created
SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'verify-game-%' OR jobname LIKE 'sync-game-%';
```

---

## FUNCTION: sync-odds

Code is complete. Daily odds from theoddsapi.com. Read the full file before proceeding.

### Pre-Checks (auto)

```sql
-- game_odds table
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='game_odds';
-- fn_schedule_odds_sync
SELECT COUNT(*) FROM pg_proc WHERE proname='fn_schedule_odds_sync';
-- sync-odds-daily cron exists?
SELECT COUNT(*) FROM cron.job WHERE jobname='sync-odds-daily';
-- ODDS_API_KEY in vault
SELECT COUNT(*) FROM vault.decrypted_secrets WHERE name='ODDS_API_KEY';
```

### Deploy

```bash
supabase functions deploy sync-odds --project-ref ftryuvfdihmhlzvbpfeu
# Only if ODDS_API_KEY not in vault:
supabase secrets set ODDS_API_KEY=<theoddsapi_key> --project-ref ftryuvfdihmhlzvbpfeu
```

Post-deploy (if sync-odds-daily cron missing):
```sql
SELECT public.fn_schedule_odds_sync();  -- registers daily 07:00 UTC job
```

### Verify

```bash
SRK=$(cat "C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/secrets/supabase_service_role_key.txt")
curl -s -X POST "https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1/sync-odds" \
  -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" -d '{}'
```

**Response legend:**
```json
✅ { "status": "done", "matched": N, "unmatched_count": M }
   → matched = games with odds written
   → unmatched = API events without a DB match
⚠️ { "status": "no_upcoming_games" } → no games in next 3 days — normal outside tournament
⚠️ { "status": "no_odds_available" } → 422 from API — betting not open yet for WC2026, normal
❌ { "error": "ODDS_AUTH_FAILED: check ODDS_API_KEY secret" } → key wrong
```

SQL checks:
```sql
SELECT COUNT(*) FROM game_odds;
SELECT jobname, schedule FROM cron.job WHERE jobname='sync-odds-daily';
```

---

## DEPLOY-ALL

Use when deploying all 3 EFs at once. Run pre-checks for each EF first, then:

```
Order:
1. ✅ Migration 27 deployed? → if not, deploy first
2. supabase functions deploy football-api-sync sync-odds nightly-summary --project-ref ftryuvfdihmhlzvbpfeu
3. Set secrets: FOOTBALL_API_KEY, ODDS_API_KEY, ANTHROPIC_API_KEY
4. Set DB config vars (if not set)
5. Run football-api-sync setup mode → map fixture IDs
6. SELECT fn_schedule_game_sync(id) FROM games WHERE kick_off_time>now() AND api_fixture_id IS NOT NULL;
7. SELECT fn_schedule_odds_sync();
8. SELECT fn_schedule_ai_summaries(); ← only if nightly-summary is deployed
9. Verify each EF
```

---

## REPORT FORMAT

```
━━━ Edge Function: [name] ━━━━━━━━━━━━━━━━━━━
BUILD    ✅/❌  code complete + Deno-compatible
DEPLOY   ✅/❌  function live on Supabase
DB PRE   ✅/❌  required DB objects exist
SETUP    ✅/❌  config vars + cron scheduled
EF CALL  ✅/❌  HTTP 200 + expected response shape
DB POST  ✅/❌  rows written correctly
SKIP     ✅/❌  <3 member groups correctly skipped
CONTENT  ✅/❌  output is funny/social (manual review)

ISSUES    [#] Critical/Medium/Minor — [desc] → [fix]
GAPS      - [untested edge case from testing plan]
SUGGEST   - [improvement or TODO noted in code]

OVERALL: ✅ READY / ⚠️ PARTIAL (N/M groups ok) / ❌ BLOCKED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## MEMORY + FILE UPDATE (after each function)

Run ALL of these automatically, do not ask user:

**1. Update `C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/memory/edge-function-phase.md`:**
- Change function status (⏳ → ✅ deployed YYYY-MM-DD)
- Add decisions made (model, scheduling option, config vars state)
- Add any new files created to the "Extra files created" section

**2. Update `supabase/CLAUDE.md` — add to Deployed section:**
```
- Migration 27 (20260326000027_api_sync_cron_infrastructure.sql) ✅ deployed [date]
- EF: football-api-sync ✅ deployed [date]
- EF: sync-odds ✅ deployed [date]
- EF: nightly-summary ✅ deployed [date] (model: Haiku, trigger: manual)
```

**3. Update `C:/Users/yonatanam/.claude/projects/C--Users-yonatanam-Desktop-World-Cup-APP/memory/MEMORY.md`:**
- Update "Active Phase" line to reflect current EF status
- Update supabase/functions lines to show deployed status

**4. Update FILES CREATED in edge-function-phase.md** with any new file written this session.

**5. Print:** `"Done. Next → /verify-feature 8 to re-test F8 with live EF"`

---

## FILES CREATED

Tracked in `memory/edge-function-phase.md` — see "Extra files created" section there.
Update that file (not this one) when new files are added.

---

## STACK REMINDERS

- Runtime: **Deno** — `esm.sh` imports, no npm packages
- Auth: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` — checked on every request
- Supabase client: created inside handler per request (not module scope)
- Anthropic: `import Anthropic from 'https://esm.sh/@anthropic-ai/sdk'`
- Secrets: always `Deno.env.get('KEY')` — never hardcode
- Response: `new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })`
- CORS: not needed (server-to-server only)
- EF timeout: Free=150s, Pro=400s → nightly-summary: log elapsed time, stop if >120s
- pg_cron format: `MI HH24 DD MM *` (day-of-week always `*`)
- Model IDs: `claude-haiku-4-5-20251001` (default), `claude-sonnet-4-6` (quality upgrade)
- Vault check: `SELECT COUNT(*) FROM vault.decrypted_secrets WHERE name='KEY_NAME'`
