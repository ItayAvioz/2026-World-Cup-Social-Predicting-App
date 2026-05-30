-- M116: ai-summary-schedule-daily safety cron (2026-05-30)
--
-- CLOSES GAP: `fn_schedule_ai_summaries` runs ONLY on game INSERT (via
-- trg_auto_schedule_game, M68). Groups + group_members have NO trigger that
-- calls it. Empirically verified on dev 2026-05-30: INSERTing a group + 3
-- members → 0 new per-group ai-summary crons created.
--
-- This is a real-world breakage path for prod:
--   - All 72 WC2026 group games inserted today (May 30)
--   - Users form groups in June (pre-launch)
--   - Group-stage match-days (Jun 11–27) pass → NO AI summaries
--   - First knockout INSERT (~Jun 27) eventually re-fires fn_schedule_ai_summaries
--     but past dates can't backfire → group-stage AI summaries permanently lost
--
-- FIX: daily safety cron at 06:30 UTC (before earliest WC kickoff at 07:30+ UTC).
-- Picks up any new qualifying groups (≥3 active members) and creates their
-- per-group ai-summary crons for that day + all future match-days.
--
-- Idempotent: cron.schedule re-runs replace by jobname; fn_schedule_ai_summaries
-- uses cron.schedule per (date, group) which is also idempotent. Safe to re-apply.

SELECT cron.schedule(
  'ai-summary-schedule-daily',
  '30 6 * * *',
  'SELECT public.fn_schedule_ai_summaries()'
);
