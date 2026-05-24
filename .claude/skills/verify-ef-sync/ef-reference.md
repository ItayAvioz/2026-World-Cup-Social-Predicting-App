# EF Reference — intended design (compare live state against this)

Source of truth for *intended* behavior. Live deployed versions drift ahead of `supabase/CLAUDE.md`
— always read live source with `get_edge_function` when a discrepancy matters.

> **Deployed-vs-local (audit 2026-05-23):** all 5 EFs are functionally **== local source**. Only
> football-api-sync v34 carries 2 extra **test-only** modes (`probe_date`, `probe_ns`) not in the local
> file. Version numbers in docs are stale (live v34/v23/v32/v12/v8) but no production code path differs.

---

## 1. football-api-sync  (`supabase/functions/football-api-sync/index.ts`)

**Purpose:** pull scores, team/player stats, events, and API-Football odds from api-football.com (v3).
**Config:** `WC_LEAGUE_ID = 1`, `WC_SEASON = 2026`, base `https://v3.football.api-sports.io`.
**Secret:** `FOOTBALL_API_KEY`.

**Modes:**
| Mode | When | Effect |
|---|---|---|
| `probe` / `probe_stats` / `snap_stats` / `probe_odds` | manual test | no DB write |
| `setup` | one-time, after API publishes 2026 fixtures | maps `api_fixture_id` onto games by `normalizeTeam(home/away)` + kickoff within 5 min |
| `setup_lineups` | one-time | fills `top_scorer_candidates.api_player_id` + adds forwards |
| `verify` | KO−30min cron (`verify-game-{id}`) | re-checks API kickoff vs DB; if >5min drift, updates `kick_off_time` + reschedules sync |
| `sync` | KO+120min cron (`sync-game-{id}`) | writes 90-min score (+ ET/pens/knockout_winner), calls `writeStats`, then `fn_unschedule_game_sync`. Handles ET/PEN in-progress via `fn_schedule_retry_sync`. RATE_LIMIT → retry 10min + `ef_error('quota')` |
| `sync_af_odds` | daily cron `af-odds-daily` (07:15 UTC) | h2h + O/U 2.5 for games KO within 3 days → `game_odds` (Bet365 id 8, fallback first) |
| `sync_stats` | backfill | re-run `writeStats` for finished games |

**Critical dependency chain:** `api_fixture_id` must be set → else `verify`/`sync`/`sync_af_odds` all
no-op (they filter `.not('api_fixture_id','is',null)` or 400). `trg_auto_schedule_game` only creates
the `sync-game`/`verify-game` crons when `api_fixture_id` is present at INSERT; otherwise call
`fn_schedule_game_sync(game_id)` manually after `setup`.

**WC-readiness checks:** does `probe` (league=1 season=2026) return the 104 fixtures yet? After
`setup`, do the real games have `api_fixture_id` + `sync-game`/`verify-game` crons? (checks.md C4)

---

## 2. sync-odds  (`supabase/functions/sync-odds/index.ts`)

**Purpose:** WC2026 champion *outright* winner odds → `champion_odds` (William Hill only).
**Secret:** `theoddsapi`. Sport key `soccer_fifa_world_cup_winner`, markets=outrights.
**Modes:** `probe` (test), `champion` (real). Unknown mode → 400.
**Trigger:** external **cron-job.org** daily 07:00 UTC (the pg_cron `champion-odds-daily` was
unscheduled 2026-04-05). Game 1X2/O-U odds come from football-api-sync `sync_af_odds`, NOT here.
**WC-readiness:** `soccer_fifa_world_cup_winner` returns `ODDS_SPORT_NOT_ACTIVE` until the book opens
the market → EF returns `no_champion_odds` gracefully. Verify the external cron still exists + key valid.

---

## 3. nightly-summary  (`supabase/functions/nightly-summary/index.ts`)

**Purpose:** one funny/social roast per qualifying group per night. 5-agent judge LLM
(main/candidate_2/candidate_3/baseline/candidate_4) on gpt-4o-mini, judge gpt-4o → winner → `ai_summaries`.
**Secret:** `AI_Summary_GPT_Key`. `TIMEOUT_MS=120s`.
**Modes:** body `{date, group_id?}`. `group_id` present = single-group (per-group cron, M73). No
`group_id` = legacy loop (manual/test). `version_id` = prompt test mode (agent 1 only, no judge).
**Qualifying group:** ≥3 active members.
**Crons:** `ai-summary-{date}-{group_id[:8]}` at last_KO+150min (one per qualifying group, M73/M83);
`ai-summary-push-{date}` at last_KO+160min (consolidated 1 push/user, M101). Scheduled by
`fn_schedule_ai_summaries()`.
**WC-readiness:** EF logic is tournament-agnostic (reads DB). Risk is operational: test groups + test
games feed junk summaries; per-group cron count balloons (date × group). Failures saved to
`failed_summaries` + `ef_error`/`failed_summary` admin alert.

---

## 4. notify-admin  (`supabase/functions/notify-admin/index.ts`)

**Purpose:** admin email via Resend. Types: `new_user`, `feedback`, `failed_summary`, `ef_error`,
`daily_digest`. Secret: `RESEND_API_KEY`. `ADMIN_EMAIL='itayavioz1@gmail.com'`.
**Trigger:** `fn_notify_admin(type,data)` (DB) for immediate alerts; `admin-daily-digest` cron 08:00 UTC
calls `fn_daily_admin_digest`.
**WC-readiness:** ⚠️ `FROM_ADDRESS='onboarding@resend.dev'` (Resend **sandbox** — mail may land in spam
or be rate-limited). Verify a real domain before go-live. Digest reads `prediction_edit_log` /
`pick_edit_log` (M105/M106).

---

## 5. send-push  (`supabase/functions/send-push/index.ts`)

**Purpose:** Web Push to `push_subscriptions`. `npm:web-push`, VAPID public hardcoded, private from
vault `Notification_Key`. `{TTL:60, urgency:'high'}`; `Promise.allSettled`; 410/404 → delete stale sub.
**Triggers (DB cron):** `fn_notify_ko` (`ko-notif-{id}` at KO−15min), `fn_notify_trivia`
(`trivia-push-daily` 19:00 UTC), `fn_notify_ai_summary_daily` (`ai-summary-push-{date}`).
`fn_cleanup_push_subscriptions` (`cleanup-push-subs-daily` 03:00 UTC) keeps latest 2 subs/user.
**WC-readiness:** iOS push needs standalone PWA + iOS 16.4+. Verify VAPID key + at least one live sub.

---

## 6. Crons + triggers — scheduling layer

**AFTER-INSERT trigger:** `trg_auto_schedule_game` → `fn_auto_schedule_game()` fires `AFTER INSERT` **only**
on `games`, each call wrapped in EXCEPTION→WARNING so a cron error never aborts the INSERT:
1. `fn_schedule_auto_predictions()` — **unconditional, ALL games** (no date/fixture filter).
2. `fn_schedule_ai_summaries()` — **unconditional, ALL dates × qualifying groups**.
3. `fn_schedule_game_sync(NEW.id)` — **only if** KO future AND `api_fixture_id IS NOT NULL`.
4. `fn_schedule_ko_notification(...)` — only if KO future.
`trg_schedule_trivia_miss` similarly schedules `trivia-miss` for new trivia questions.

⚠️ **INSERT-only gap:** `setup` mode fills `api_fixture_id` via **UPDATE**, which does NOT re-fire this
trigger → no `sync-game`/`verify-game` cron is created. Must backfill `fn_schedule_game_sync` per game
(M71 pattern) after `setup`, or add an `AFTER UPDATE OF api_fixture_id` trigger. (See check C11.)

**pg_cron → EF auth:** vault `app_edge_function_url` + `app_service_role_key`. `fn_schedule_game_sync` reads
the key **inline at fire time** (safe); `fn_schedule_ai_summaries` + `af-odds-daily` **bake the JWT into the
cron command string** (plaintext in `cron.job.command` — see check C14). Push fns (`fn_notify_ko`,
`fn_notify_ai_summary_daily`) post to `send-push` with **no auth header**.

**Idempotency / pruning:** `fn_schedule_game_sync`/`_af_odds_sync` unschedule-then-schedule (clean re-run).
`fn_schedule_auto_predictions`/`_ai_summaries` upsert by jobname (no double-fire) but **never prune obsolete
job names** → orphan/stale crons accumulate when games/dates are deleted (checks C12/C13). Timing: sync
KO+120m, AI summary last_KO+150m (30-min gap so scores land first — correct per M83); no `::text` body bug.

**Scheduling fns:** `fn_schedule_game_sync` / `fn_schedule_retry_sync` / `fn_unschedule_game_sync`
(per-game sync), `fn_schedule_auto_predictions` (auto-predict-{id} at KO), `fn_schedule_ai_summaries`
(per-group + push), `fn_schedule_ko_notification`, `fn_schedule_af_odds_sync`,
`fn_schedule_champion_odds_sync` / `fn_schedule_odds_sync`, `fn_auto_assign_picks`
(`auto-assign-picks` 19:00 Jun 11 2026), `fn_auto_miss_trivia` / `fn_schedule_trivia_miss`.

**Cron families (expected for WC):** `sync-game-{id}` + `verify-game-{id}` (one per real game with
`api_fixture_id`), `auto-predict-{id}` (one per real game), `ko-notif-{id}` (one per real game),
`ai-summary-{date}-{grp}` + `ai-summary-push-{date}` (per tournament night), `trivia-miss-{id}`
(per question), plus singletons `af-odds-daily`, `admin-daily-digest`, `auto-assign-picks`,
`trivia-push-daily`, `cleanup-push-subs-daily`.

**WC-readiness:** every real WC game needs auto-predict + ko-notif (have) AND sync+verify (the gap).
Test/old games must NOT carry live crons (they fire junk auto-predicts + summaries).
