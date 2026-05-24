# Diff agents — deployed-vs-local comparison (dispatch in parallel)

The deep part of this audit compares **deployed EF code** (via `get_edge_function`) against **local source**
(`supabase/functions/*`) and reads the **DB trigger/cron function bodies**. The deployed code is large, so
dispatch these as parallel subagents (Agent tool, `subagent_type: general-purpose`) — each returns only a
structured report, keeping the big code out of the main thread.

**Rules for every agent:** read-only (no file/DB/EF writes); project_id `ftryuvfdihmhlzvbpfeu`; report ONLY
functional differences (ignore whitespace/comments); flag findings 🔴/🟡/🟢 by real WC impact (the app works
in testing — signal over noise).

Run all 4 in one batch.

---

## Agent 1 — football-api-sync (big EF)
**Scope:** deployed `football-api-sync` vs `supabase/functions/football-api-sync/index.ts`.
**Return:** (A) functional diff or "== local"; (B) full process — modes, score scenarios (group FT,
knockout FT/AET/PEN, ET/penalty in-progress, score-null, retry delays), writeStats, sync_af_odds, failure
handling (429/quota, ef_errors types, unschedule); (C) gaps/fixes. Specifically check: terminal statuses
(PST/SUSP/ABD) retrying forever, writeStats swallowing errors, the INSERT-only/`api_fixture_id` cron gap.
**Last result (2026-05-23):** == local **+ 2 test modes** `probe_date`/`probe_ns` (deployed only). No prod drift.

## Agent 2 — nightly-summary (big EF)
**Scope:** deployed `nightly-summary` vs local. **Return:** (A) diff/==; (B) full process — single-group vs
loop vs prompt-test modes, 5-agent + judge, qualifying-group rule, ai_summaries/failed_summaries writes,
retries, fallback, timeout; (C) gaps. Check: test groups feeding summaries, cron count, timeout vs #groups.
**Last result:** byte-identical to local; version label only. 🔴 7/8 qualifying groups are test groups.

## Agent 3 — small EFs (sync-odds + notify-admin + send-push)
**Scope:** deployed vs local for all three. **Return per EF:** (A) diff/==; (B) process — modes/types,
scenarios, secrets, trigger (cron name+schedule / external cron-job.org / DB fn); (C) gaps. Check:
notify-admin `FROM_ADDRESS` sandbox sender, sync-odds external cron-job.org trigger, send-push failure
alerting + 410/404 pruning.
**Last result:** all three == local (labels stale). 🔴 notify-admin FROM_ADDRESS=onboarding@resend.dev.

## Agent 4 — DB trigger/cron layer
**Scope:** SELECT-only. `pg_get_functiondef` for `fn_auto_schedule_game`, `fn_schedule_game_sync`,
`fn_schedule_retry_sync`, `fn_unschedule_game_sync`, `fn_schedule_auto_predictions`, `fn_auto_predict_game`,
`fn_schedule_ai_summaries`, `fn_schedule_ko_notification`, `fn_notify_ko`, `fn_auto_assign_picks`,
`fn_schedule_af_odds_sync`, `fn_notify_ai_summary_daily` (split into 2 batches if large). Plus
`pg_get_triggerdef` for triggers on `games`/`ai_summaries`/`trivia_questions`, and sample `cron.job.command`
bodies. **Return:** (A) `trg_auto_schedule_game` exact fan-out + guards + INSERT-only confirmation; (B) each
scheduling fn — cron name/schedule/body/delay/filter; (C) cron→EF auth pattern + `::text`/timing; (D) gaps.
Specifically: INSERT-only vs setup's UPDATE, schedulers covering test/old games (no filter), JWT in
`cron.command`, idempotency/pruning.
**Last result:** confirmed INSERT-only gap (105/178 NULL); orphan/stale crons (add-only); JWT plaintext in
ai-summary+af-odds commands; no `::text` bug; timing correct (M83).

---

After the agents return, fold their findings into Part 1 (process) + Part 3 (gaps) of the report, and run
the DB checks (C0–C15) for the live numbers.
