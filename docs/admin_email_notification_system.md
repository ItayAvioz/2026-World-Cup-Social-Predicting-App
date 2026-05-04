# Admin Email Notification System — Implementation Plan

## Context

The app runs silently — EF failures, new users, and feedback arrive with no visibility. This plan adds:
- Immediate admin email alerts (Resend) triggered by DB events
- Daily digest with per-game stats, token usage, and app activity metrics
- App usage tracking (active users, avg session time, peak hour)

**Admin email:** `itayavioz1@gmail.com`
**Email service:** Resend (free tier — 3k/month, API key in Supabase EF env as `RESEND_API_KEY`)

---

## What Already Exists ✅

| Thing | Where | Notes |
|---|---|---|
| `ai_summaries.prompt_tokens` + `.completion_tokens` | M7 + M54 | Already populated by EF — no change needed |
| `failed_summaries` table | M20 | Ready for trigger |
| `feedback` table | M60 | Ready for trigger |
| `pg_net` + `net.http_post()` pattern | M27 | Reused as-is for triggers + digest |
| Vault: `app_edge_function_url`, `app_service_role_key` | Supabase vault | Reused in SQL functions |
| `football-api-sync`, `sync-odds`, `nightly-summary` EFs | Deployed | Modified, not replaced |
| `profiles`, `games`, `predictions`, `group_members` tables | M1–M36 | Queried in digest |

**Verified column names (from M4):**
- `predictions.pred_home` / `pred_away` (not `predicted_home`/`predicted_away`)
- `predictions.submitted_at` (not `created_at`)
- `predictions.is_auto` (boolean)

---

## What Needs to Be Created 🔨

| Deliverable | Type | Complexity |
|---|---|---|
| `notify-admin` EF | New EF | Low |
| `RESEND_API_KEY` vault secret | CLI command | Trivial |
| `ef_errors` table + RLS | M61 | Low |
| `app_events` table + RLS | M61 | Low |
| `fn_notify_admin()` SQL helper | M61 | Low |
| 4 DB triggers (profiles, feedback, failed_summaries, ef_errors) | M61 | Low |
| `fn_daily_admin_digest()` with per-game stats + usage | M61 | Medium |
| Daily digest pg_cron job (08:00 UTC) | M61 | Trivial |
| `reportEfError()` in `football-api-sync` | Modify EF | Low |
| `reportEfError()` in `sync-odds` | Modify EF | Low |
| `logEvent()` utility + heartbeat in React frontend | New file + 5 pages | Medium |

---

## Email Examples

### 1. New User — immediate
**Subject:** `[WC2026] New user: itay123`
```
New registration: itay123
User ID: a1b2c3d4-...
Time: Sun, 04 May 2026 14:32:00 UTC
```

### 2. Feedback — immediate (ALL priorities)
**Subject:** `[WC2026] Feedback [issue] 🔴 high`
```
Category:   issue
Priority:   high
Message:    The leaderboard doesn't update after the game ends.

Screenshot: [View screenshot]
User: a1b2c3d4-... | 2026-05-04T14:33:00Z
```

### 3. AI Summary Failed — immediate
**Subject:** `[WC2026] AI summary failed — 2026-05-03`
```
Group:    f9e8d7c6-...
Date:     2026-05-03
Error:    duplicate key value violates unique constraint
Content was generated (not lost) — 847 chars saved to failed_summaries.
```

### 4. EF Error — immediate
**Subject:** `[WC2026] EF error — football-api-sync [stats_write]`
```
Function:   football-api-sync
Type:       stats_write
Message:    null value in column "goals" violates not-null constraint
Context:    { "game_id": "c3d4e5f6-...", "api_fixture_id": 98234 }
2026-05-04T02:18:44Z
```

### 5. Daily Digest — 08:00 UTC
**Subject:** `[WC2026] Daily digest — 2026-05-03`
```
WorldCup 2026 — Daily digest (2026-05-03)
──────────────────────────────────────────────────────────
GAMES YESTERDAY
  France 2–1 Brazil       23 preds | Exact: 3 (13%) | W/D/L: 15 (65%) | Auto: 4 (17%)
  Spain 1–1 Germany       18 preds | Exact: 6 (33%) | W/D/L: 9  (50%) | Auto: 2 (11%)
  Portugal 3–0 Morocco    31 preds | Exact: 1 (3%)  | W/D/L: 24 (77%) | Auto: 6 (19%)
──────────────────────────────────────────────────────────
AI SUMMARIES    5 created / 0 failed
TOKENS          4,820 in / 1,240 out
──────────────────────────────────────────────────────────
NEW USERS       2
NEW FEEDBACK    1
EF ERRORS (24h) 0 ✓
──────────────────────────────────────────────────────────
APP USAGE (YESTERDAY)
  Active users:   47
  Avg time/user:  8 min 20 sec
  Peak hour:      20:00–21:00 UTC (34 active)
  Actions:        212  (87 predictions · 14 picks · 111 page views)
──────────────────────────────────────────────────────────
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `supabase/functions/notify-admin/index.ts` | CREATE |
| `supabase/migrations/20260504000061_admin_notifications.sql` | CREATE |
| `supabase/functions/football-api-sync/index.ts` | MODIFY — add `reportEfError()` helper + 3 call sites |
| `supabase/functions/sync-odds/index.ts` | MODIFY — add `reportEfError()` helper + 1 call site |
| `src/lib/analytics.ts` | CREATE — `logEvent()` + heartbeat |
| `src/pages/Dashboard.jsx` | MODIFY — add `logEvent('page_view', 'dashboard')` + heartbeat start |
| `src/pages/Groups.jsx` | MODIFY — page_view |
| `src/pages/Game.jsx` | MODIFY — page_view + prediction_submit |
| `src/pages/Picks.jsx` | MODIFY — page_view + pick_submit |
| `src/pages/AiFeed.jsx` | MODIFY — page_view |

---

## Step 1 — `notify-admin` Edge Function

`supabase/functions/notify-admin/index.ts`

- Accepts `POST { type, data }` — called by pg_net (triggers + digest cron)
- Reads `RESEND_API_KEY` via `Deno.env.get('RESEND_API_KEY')`
- Switch on `type` → build subject + HTML → POST to `https://api.resend.com/emails`
- From: `onboarding@resend.dev` (Resend sandbox — no domain verification needed)
- Returns `{ sent: true }` or `{ error }` with status 500
- Types: `new_user`, `feedback`, `failed_summary`, `ef_error`, `daily_digest`

---

## Step 2 — Migration M61

`supabase/migrations/20260504000061_admin_notifications.sql`

### 2a. `ef_errors` table
```sql
CREATE TABLE public.ef_errors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ef_name     text        NOT NULL,   -- 'football-api-sync' | 'sync-odds'
  error_type  text        NOT NULL,   -- 'crash' | 'quota' | 'stats_write'
  error_msg   text        NOT NULL,
  context     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ef_errors_created_at ON public.ef_errors (created_at DESC);
ALTER TABLE public.ef_errors ENABLE ROW LEVEL SECURITY;
-- No client policies — EFs write via service_role (bypasses RLS)
```

### 2b. `app_events` table
```sql
CREATE TABLE public.app_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,   -- 'page_view' | 'prediction_submit' | 'pick_submit' | 'heartbeat'
  page        text,                   -- 'dashboard' | 'groups' | 'game' | 'picks' | 'ai_feed'
  session_id  uuid        NOT NULL,   -- generated once per tab, stored in sessionStorage
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_events_created_at ON public.app_events (created_at DESC);
CREATE INDEX idx_app_events_user_session ON public.app_events (user_id, session_id, created_at);
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
-- RLS: users insert only their own events
CREATE POLICY "app_events: authenticated insert own"
  ON public.app_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

### 2c. `fn_notify_admin(p_type text, p_data jsonb)` helper
- SECURITY DEFINER, reads vault secrets, calls `net.http_post` to `/notify-admin`
- If vault secrets NULL → RAISE WARNING + return (prevents bootstrap failure during migration)
- Same pg_net pattern as M27/M44/M56

### 2d. Four triggers (AFTER INSERT, FOR EACH ROW)
```
trg_notify_new_user       → profiles         → fn_notify_admin('new_user', ...)
trg_notify_feedback       → feedback         → fn_notify_admin('feedback', ...)
trg_notify_failed_summary → failed_summaries → fn_notify_admin('failed_summary', ...)
trg_notify_ef_error       → ef_errors        → fn_notify_admin('ef_error', ...)
```

### 2e. `fn_daily_admin_digest()`
SECURITY DEFINER — needs `auth.users.created_at` (profiles has no timestamp).

**Per-game stats query (GROUP BY game):**
```sql
SELECT
  g.team_home, g.team_away, g.score_home, g.score_away,
  COUNT(p.id)                                                AS total_preds,
  COUNT(*) FILTER (WHERE p.pred_home = g.score_home
                     AND p.pred_away = g.score_away)         AS exact,
  COUNT(*) FILTER (WHERE
    (p.pred_home > p.pred_away  AND g.score_home > g.score_away) OR
    (p.pred_home = p.pred_away  AND g.score_home = g.score_away) OR
    (p.pred_home < p.pred_away  AND g.score_home < g.score_away)) AS correct_outcome,
  COUNT(*) FILTER (WHERE p.is_auto = true)                   AS auto_preds
FROM public.games g
LEFT JOIN public.predictions p ON p.game_id = g.id
WHERE g.kick_off_time >= v_window_start
  AND g.kick_off_time <  v_window_end
  AND g.score_home IS NOT NULL
GROUP BY g.id, g.team_home, g.team_away, g.score_home, g.score_away
ORDER BY g.kick_off_time
```

**Usage stats query:**
```sql
-- Active users + avg session time (heartbeats define session bounds)
SELECT
  COUNT(DISTINCT user_id)           AS active_users,
  AVG(
    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))
  )                                 AS avg_session_seconds,
  COUNT(*) FILTER (WHERE event_type = 'prediction_submit') AS prediction_actions,
  COUNT(*) FILTER (WHERE event_type = 'pick_submit')       AS pick_actions,
  COUNT(*) FILTER (WHERE event_type = 'page_view')         AS page_views
FROM public.app_events
WHERE created_at >= v_window_start AND created_at < v_window_end
-- for avg session: GROUP BY user_id, session_id first, then AVG
```

**Peak hour query:**
```sql
SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') AS hour,
       COUNT(DISTINCT user_id) AS active_users
FROM public.app_events
WHERE created_at >= v_window_start AND created_at < v_window_end
GROUP BY 1 ORDER BY 2 DESC LIMIT 1
```

Builds full jsonb digest → `net.http_post` to `/notify-admin`

### 2f. pg_cron job
```sql
SELECT cron.schedule('admin-daily-digest', '0 8 * * *',
  'SELECT public.fn_daily_admin_digest()');
```

---

## Step 3 — `football-api-sync` changes

Add `reportEfError(supabase, errorType, errorMsg, context?)` helper — inserts to `ef_errors`, swallows own errors (best-effort only).

| Location | Type | Action |
|---|---|---|
| `writeStats()` catch (lines 800-802) | `'stats_write'` | Create fresh client, call `reportEfError` |
| RATE_LIMIT catch in `handleSync` (~line 585) | `'quota'` | Call `reportEfError(supabase, ...)` before retry |
| Top-level catch (lines 841-845) | `'crash'` | Create fresh client, call `reportEfError` |

---

## Step 4 — `sync-odds` changes

Add same `reportEfError()` (creates its own client — `supabase` not in outer scope).

| Location | Type | Action |
|---|---|---|
| Top-level catch (lines 226-230) | `'crash'` | Call `reportEfError('crash', msg, { mode })` |

---

## Step 5 — Frontend: `src/lib/analytics.ts`

```typescript
// Session ID persists for the browser tab lifetime
function getSessionId(): string {
  let id = sessionStorage.getItem('wc_session_id')
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('wc_session_id', id) }
  return id
}

export async function logEvent(
  supabase: SupabaseClient,
  userId: string,
  eventType: 'page_view' | 'prediction_submit' | 'pick_submit' | 'heartbeat',
  page?: string
): Promise<void> {
  // Fire and forget — never await in UI code
  supabase.from('app_events').insert({
    user_id: userId, event_type: eventType,
    page: page ?? null, session_id: getSessionId()
  }).then() // suppress unhandled promise
}

// Call in App.jsx or a top-level component
export function useHeartbeat(supabase, userId) {
  useEffect(() => {
    if (!userId) return
    const tick = () => logEvent(supabase, userId, 'heartbeat')
    tick() // immediate on mount
    const interval = setInterval(tick, 15_000)
    // Pause when tab hidden (avoids inflating time on iOS Safari)
    const onVisibility = () =>
      document.visibilityState === 'hidden'
        ? clearInterval(interval)
        : setInterval(tick, 15_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId])
}
```

**Where to add in each page:** `logEvent(supabase, user.id, 'page_view', 'dashboard')` in `useEffect([], [])`. In `Game.jsx`: also call `logEvent(..., 'prediction_submit', 'game')` after a successful prediction upsert.

`useHeartbeat` goes in `App.jsx` so it runs once for the whole session, not per page.

---

## Deploy Order

1. `supabase functions deploy notify-admin`
2. `supabase secrets set RESEND_API_KEY=re_xxxxxxxx`
3. `supabase db push` (M61 — tables, triggers, cron)
4. `supabase functions deploy football-api-sync sync-odds`
5. `npm run build` + deploy frontend (gh-pages)

---

## Complexity & Risks

### Complexity by area

| Area | Complexity | Why |
|---|---|---|
| `notify-admin` EF | Low | Standard fetch to Resend API, switch on type |
| M61 migration | Medium | Many objects in one file — careful ordering required |
| EF error writes | Low | 3–4 lines per catch block |
| `fn_daily_admin_digest` SQL | Medium | Per-game GROUP BY + session-time subquery + peak-hour subquery |
| `app_events` table + RLS | Low | Simple insert-only table |
| Frontend `logEvent()` | Low | Fire-and-forget insert, no state |
| `useHeartbeat` hook | Medium | visibilitychange + interval cleanup required; easy to get subtly wrong |
| Avg session time SQL | Medium | Requires two-level aggregation (session → user → AVG) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Email lost if `notify-admin` EF is down when trigger fires | Low | Low (admin tool only, not user-facing) | Check `net._http_response` table periodically |
| Trigger fires before EF is deployed (wrong deploy order) | Medium | Low (404, silent) | Always deploy EF first, then run migration |
| `visibilitychange` not handling all cases (iOS tab switch, PWA) | Medium | Low (inflated avg time by ~10–20%) | Acceptable for v1 — refine if numbers look wrong |
| `app_events` table grows large if users leave tab open | Low | Low (15s × 50 users × 4hrs = 48k rows/day — fine) | Add cleanup cron after tournament if needed |
| `profiles` has no `created_at` → new user count relies on `auth.users` | — | None | Already handled: SECURITY DEFINER on digest function |
| Resend sandbox from-address (`onboarding@resend.dev`) may go to spam | Medium | Medium | Verify custom domain in Resend dashboard if needed |
| `session_id` lost on hard refresh → new session ID, breaks session continuity | Low | Low (slight undercount of session time, not wrong) | Acceptable; HashRouter navigations don't reload |
| M61 migration ordering — `net.http_post` requires pg_net to be enabled | — | None | pg_net already active (M27) |

### What's NOT included (out of scope)
- Slack / WhatsApp notifications (email only)
- Notification for pg_cron itself stopping (requires heartbeat EF — complex, deferred)
- Per-user analytics dashboard in the app UI (admin email only)
- Resend webhook for bounce/delivery tracking

---

## Verification

```sql
-- 1. Smoke test EF (from Supabase dashboard or curl)
-- POST { "type": "ef_error", "data": { "ef_name": "test", "error_type": "crash",
--   "error_msg": "smoke test", "created_at": "2026-05-04T10:00:00Z" } }

-- 2. Test new_user trigger
INSERT INTO public.profiles (id, username)
VALUES ('00000000-0000-0000-0000-000000000099', 'notify_test');
-- email should arrive within ~5s

-- 3. Test feedback trigger
INSERT INTO public.feedback (user_id, category, priority, message)
VALUES ('00000000-0000-0000-0000-000000000099', 'idea', 'low', 'Test notification');

-- 4. Test ef_error trigger
INSERT INTO public.ef_errors (ef_name, error_type, error_msg)
VALUES ('football-api-sync', 'crash', 'test crash');

-- 5. Trigger daily digest immediately (don't wait for 08:00)
SELECT public.fn_daily_admin_digest();

-- 6. Verify pg_net delivered (~5s after any trigger)
SELECT status_code, content, created FROM net._http_response ORDER BY created DESC LIMIT 5;

-- 7. Verify cron scheduled
SELECT jobname, schedule FROM cron.job WHERE jobname = 'admin-daily-digest';

-- 8. Verify heartbeat logging (after frontend deploy, open app for 1min)
SELECT COUNT(*), MIN(created_at), MAX(created_at)
FROM public.app_events WHERE event_type = 'heartbeat' AND created_at > now() - interval '5 minutes';

-- Cleanup test rows
DELETE FROM public.profiles  WHERE id = '00000000-0000-0000-0000-000000000099';
DELETE FROM public.ef_errors WHERE error_msg = 'test crash';
```
