---
name: Admin email notification system
description: Resend-based email alerts + daily digest for admin itayavioz1@gmail.com — architecture, tables, EFs, cron, and pending items
type: project
originSessionId: a3ba62bf-3275-42cf-9a62-ddeccd3df887
---
## Status
✅ Fully deployed and live-tested (2026-05-03). Two emails verified received.
✅ notify-admin v2 deployed (2026-05-04) — added Judge LLM section to daily digest.
✅ notify-admin v3 deployed (2026-05-04) — added v10-baseline wins row to Judge LLM section in daily digest.

## Architecture
- **Email service:** Resend API (`https://api.resend.com/emails`)
- **From address:** `onboarding@resend.dev` (Resend sandbox — pending custom domain verification)
- **To:** `itayavioz1@gmail.com`
- **RESEND_API_KEY:** stored in Supabase Edge Functions Secrets (dashboard UI, not vault)
- **Gateway EF:** `notify-admin` (v2, verify_jwt=false — called by pg_net with service_role bearer)

## Email Types
| Type | Trigger | Subject |
|---|---|---|
| `new_user` | INSERT on profiles | [WC2026] New user: {username} |
| `feedback` | INSERT on feedback | [WC2026] Feedback [{category}] {priority} |
| `failed_summary` | INSERT on failed_summaries | [WC2026] AI summary failed — {date} |
| `ef_error` | INSERT on ef_errors | [WC2026] EF error — {ef_name} [{error_type}] |
| `daily_digest` | pg_cron 08:00 UTC daily | [WC2026] Daily digest — {date} |

## DB Objects (M61 — 20260504000061_admin_notifications.sql)
- `ef_errors` table: id, ef_name, error_type, error_msg, context jsonb, created_at
- `app_events` table: id, user_id (FK auth.users CASCADE), event_type, page, session_id uuid, created_at; RLS: authenticated insert own
- `fn_notify_admin(p_type, p_data)` — SECURITY DEFINER, reads vault secrets, calls net.http_post
- `trg_notify_new_user` → profiles AFTER INSERT
- `trg_notify_feedback` → feedback AFTER INSERT
- `trg_notify_failed_summary` → failed_summaries AFTER INSERT
- `trg_notify_ef_error` → ef_errors AFTER INSERT
- `fn_daily_admin_digest()` — SECURITY DEFINER, no parameters, always uses yesterday UTC window
- pg_cron job: `admin-daily-digest` at `0 8 * * *`

## EF Error Reporting
- `football-api-sync` v29: reports `quota` (rate limit), `stats_write` (writeStats catch), `crash` (top-level catch)
- `sync-odds` v19: reports `crash` (top-level catch)
- Both use `reportEfError()` helper — inserts to ef_errors → trigger fires → email sent

## App Usage Tracking (app_events)
- `src/lib/analytics.ts`: `logEvent()` (fire-and-forget insert) + `useHeartbeat()` hook
- Session ID: `sessionStorage` key `wc_session_id` — persists per tab, resets on hard refresh
- Heartbeat: every 15s, pauses via `visibilitychange` when tab hidden
- `useHeartbeat` called in `App.jsx` (AppInner component) — runs once for whole session
- Events logged: page_view (all 5 pages), prediction_submit (Game.jsx), pick_submit (Picks.jsx), heartbeat
- Session time = MAX(heartbeat) - MIN(heartbeat); sessions with <2 heartbeats excluded from avg

## Daily Digest Contents
- Per-game stats: total preds, exact %, W/D/L %, auto %
- AI summaries: created count, failed count, tokens in/out
- Users & feedback: new registrations, new feedback submissions
- App usage: active users, avg session time, peak hour, action counts
- Judge LLM: runs yesterday, wins per agent (v11-main / v12-picks / v13-unique) — added v2
- EF errors: last 24h count + list

## Manual Test for Past Date
To trigger digest for a specific past date (one-off, no function change):
Run a DO $$ block with hardcoded v_start/v_end and call fn_notify_admin directly via net.http_post.
Example: v_start = '2026-04-25 00:00:00+00', v_end = '2026-04-26 00:00:00+00'

## Pending
- Verify custom domain in Resend dashboard → update FROM_ADDRESS in notify-admin/index.ts (1 line) + redeploy
- Currently `onboarding@resend.dev` may land in spam
