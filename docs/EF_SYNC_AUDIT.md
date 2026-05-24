# EF Sync & Triggers Audit — WorldCup 2026

**Audit date:** 2026-05-23 · **Project:** `ftryuvfdihmhlzvbpfeu` · **Method:** read-only (`/verify-ef-sync`)
**Compared:** deployed EF code vs local `supabase/functions/*` + DB trigger/cron function bodies vs `supabase/CLAUDE.md`.

**Verdict:** Code is in good shape — **deployed == local for all 5 EFs** (only label/version drift), pipeline
mechanically healthy (0 failed cron runs/7d, 0 EF errors/14d). What's *not* ready is **configuration for the
real tournament**: real games aren't mapped to the API, a trigger gap blocks sync-cron creation on `setup`,
and test data + stale crons pollute the live pipeline. All fixable; none are code rewrites.

**Deployed EF versions (live vs docs) — code drift = none:**

| EF | Live | Doc | Code vs local |
|---|---|---|---|
| football-api-sync | v34 | v29 | == local **+ 2 test-only modes** (`probe_date`, `probe_ns`) not in local file |
| sync-odds | v23 | v19 | == local (byte-identical) |
| nightly-summary | v32 | v25 | == local (byte-identical) |
| notify-admin | v12 | v9 | == local (byte-identical) |
| send-push | v8 | v8 | == local |

---

## Part 1 — What we actually have (full process per EF)

### 1. football-api-sync (v34) — game scores, stats, odds
- **Logic:** api-football.com v3, `WC_LEAGUE_ID=1`, `WC_SEASON=2026`, `BET365_ID=8`. Auth `x-apisports-key`.
- **Modes (deployed):** `probe_date`, `probe_ns`, `probe`, `probe_stats`, `snap_stats`, `probe_odds` (all test, no write) · `setup` (map `api_fixture_id` by normalized team + KO ±5min, **via UPDATE**) · `setup_lineups` (fill `top_scorer_candidates.api_player_id`) · `verify` (KO−30m) · `sync` (KO+120m) · `sync_af_odds` (daily) · `sync_stats` (backfill).
- **Score scenarios (`sync`):** group `FT` → 90-min score · knockout `FT/AET/PEN` → 90-min score + `went_to_extra_time`/`et_score`/`went_to_penalties`/`penalty_score` + `knockout_winner` (PEN→pens, AET→ET, else goals) · ET in-progress (`ET/BT`) → write 90-min + flag, retry **+40m** · penalty in-progress (`P`) → write + ET/pen flags, retry **+5m** · score null → retry **+5m** (never writes null) · anything else → retry **+5m**. **`score_home/away` = 90-min only, always.** On finish: 3× DB-update retry → `writeStats` → `fn_unschedule_game_sync`.
- **writeStats:** parallel `/statistics` + `/players` + `/events` → `game_team_stats` (red_cards player-derived, VAR-correct), `game_player_stats`, `game_events` (goals + red cards). **Wrapped in try/catch — logs `ef_errors('stats_write')` but does NOT throw** (score write still succeeds).
- **Failure handling:** 429 → `RATE_LIMIT` → `ef_errors('quota')` + retry **+10m** · 401/403 → `AUTH_FAILED` · top-level → `ef_errors('crash')`.
- **Trigger:** `verify-game-{id}` (KO−30m) + `sync-game-{id}` (KO+120m), created by `fn_schedule_game_sync` **only on INSERT with `api_fixture_id` set**; `af-odds-daily` 07:15 UTC → `sync_af_odds`.

> 📌 **Review notes — to update (football-api-sync):**
> - **KO time change >5min only reschedules sync/verify, not the rest.** `verify` updates `kick_off_time` + re-runs `fn_schedule_game_sync` (verify + sync crons), but `auto-predict-{id}` and `ko-notif-{id}` stay on the OLD time → auto-predict and the KO push fire at the wrong moment. TODO: when KO moves >5min, also reschedule `auto-predict-{id}` (`fn_schedule_auto_predictions` / per-game) and `ko-notif-{id}` (`fn_schedule_ko_notification`).
> - **Unfinished-game retry has no cap** — retries every +5min indefinitely (ET +40m, pens +5m, rate-limit +10m); only stops when the game reaches a finished status (FT/AET/PEN). Safe for normal games.
> - **🟡 Abandoned/postponed games loop forever.** Statuses that never reach FT — `PST` (postponed), `SUSP`, `ABD` (abandoned), `CANC`, `AWD`, `WO`, `INT` — aren't recognized as endpoints, so the +5min retry repeats endlessly (~288 wasted API calls/day per stuck game), no score ever lands, alarm never self-cancels, nobody is alerted. Very low likelihood at the WC. **Fix:** in `sync`, detect these terminal statuses → `fn_unschedule_game_sync` + log `ef_errors` (admin handles that game manually). **Improvement (safety net):** hard stop if still unfinished by KO+6h, regardless of status, so no unknown status can loop forever.
> - **🟡 Stats can silently go missing.** On a finished game the order is: save score (3× retry, throws on fail) → `writeStats` → unschedule. `writeStats` is wrapped so a failure (API hiccup/timeout) only logs `ef_errors('stats_write')` and does NOT stop the flow → game is marked **done with score but no stats**, alarm cancelled, **no auto-retry**. Recovery today = manual `sync_stats`. **Fix (proposed):** make `writeStats` report success/fail; on fail, **don't unschedule — reschedule a +5min retry** (reuse `fn_schedule_retry_sync`) that re-attempts stats (score re-write is idempotent). **Cap it** at N attempts (≈3–5) or KO+3h → then unschedule + `ef_errors` alert (`sync_stats` backfills). Score is never blocked — it's saved on the first pass; only the stats panel fills in minutes later.
> - **🟡 Local source behind deployed v34.** Deployed has 2 test-only modes (`probe_date`, `probe_ns`) NOT in `supabase/functions/football-api-sync/index.ts`. Harmless now (read-only test helpers), but a redeploy from the file would silently drop them, and file ≠ live confuses tracking. **Fix (code change, later):** copy the 2 handlers + switch cases into the local source so file == live.
> - **🟢 Improvements:** (a) **stats-missing visibility** — add a `stats_warning` to the sync response so a failed stats pull shows immediately, not just in the next-day digest (largely covered by the #5 retry fix); (b) ~~partial ET score sooner~~ — **NOT NEEDED**, points are scored on the 90-min result only, ET/pens are display-only; (c) `setup_lineups` surname-match risk — **RESOLVED by production approach**: pull ALL players fresh from team lineups (each with its real `api_player_id`), no linking to pre-seeded names → no surname matching, top-scorer scoring matches reliably by `api_player_id`.
>
> **✅ EF 1 fully reviewed** — blocker (insert-complete + `sync_fixtures` + daily knockout pull) + 5 should-fix (time-change reschedule, abandoned-status stop, stats retry+cap, local-source sync) + improvements (a keep, b drop, c resolved).
> - **Odds window = 72h (3 days)** — confirmed correct, no change.
> - **ET/penalty retry ladder — confirmed correct.** First sync KO+120 → generic **+5min** loop (keeps `stage=initial`) until status shows `ET` → one **+40min** wait (`stage=et_followup`) → if still ET, **+5min** until `AET`/`PEN` settles → write ET/pen scores + `knockout_winner`. Penalty-in-progress (`P`) uses +5min. The +40min branch only arms while `stage=initial`, and the +5min generic retry preserves that — so ET is always caught.
>
> **🔴 Blocker #1 — chosen resolution (production):** Don't fix via backfill/update-trigger. Instead make every
> game enter the table as a **complete INSERT** (real teams + KO time + `api_fixture_id`), for group AND each
> knockout round — then `trg_auto_schedule_game` (AFTER INSERT) auto-creates sync/verify/auto-predict/ko-notif.
> **Golden rule: always INSERT a complete game; never UPDATE a placeholder** (UPDATE doesn't fire the trigger).
> Two required changes to enable this:
> 1. **Add an INSERT mode to football-api-sync** (e.g. `sync_fixtures`) — current `setup` only matches+UPDATEs
>    existing rows; it can't create games. New mode inserts missing fixtures, skipping any `api_fixture_id`
>    already present (idempotent, no double-insert).
> 2. **Drop TBD knockout placeholders from the design** — don't pre-seed them. A **daily `sync_fixtures` cron**
>    auto-inserts each knockout game once its matchup resolves (real teams present in the API). If placeholders
>    must exist, the new mode deletes-then-inserts (safe pre-predictions).
> **Production flow:** pre-tournament insert all group games complete; during tournament a daily cron auto-pulls
> + inserts knockouts. Fully automatic, no backfill. (Test note: the 6 friendlies worked precisely because they
> were inserted complete; the 104 seeded games didn't because they were seeded empty then `setup`-UPDATEd.)

### 2. sync-odds (v23) — champion outright odds
- **Logic:** TheOddsAPI `soccer_fifa_world_cup_winner`, markets=outrights, **William Hill only** → `champion_odds` (onConflict `team_name,bookmaker`). Name-maps USA/Bosnia; skips non-WC teams.
- **Modes:** `probe` (test), `champion` (real). Unknown → 400.
- **Failure handling:** 401→`ODDS_AUTH_FAILED` · 422→`ODDS_SPORT_NOT_ACTIVE` returns `no_champion_odds` gracefully (market not open yet) · per-team errors collected · top-level → `ef_errors('crash')`.
- **Trigger:** **external cron-job.org** daily 07:00 UTC (not in `cron.job`; pg_cron `champion-odds-daily` unscheduled 2026-04-05).

> 📌 **Review notes (sync-odds) — EF 2 reviewed, working:**
> - **Live + fresh (DB-confirmed):** `champion_odds` = 48 teams (all WC), William Hill, last updated 2026-05-23 07:00 UTC. The external cron is running on schedule.
> - **Expiry confirmed correct:** cron-job.org set to expire **11 Jun 2026 13:00** — last refresh is the morning of Jun 11, picks lock 19:00 UTC. Aligned.
> - **Failure-alert blind spot CLOSED:** cron-job.org "notify when execution fails" toggle now **ON** (after 1 failure). If it fails/auto-disables, admin is emailed. (Was the main concern.)
> - **🟢 Optional (not required):** move the trigger into Supabase **pg_cron** (daily 07:00 UTC until Jun 11, same `net.http_post`+service-role pattern as `af-odds-daily`) for in-house visibility/consistency. No longer needed for safety now that failure alerts are on.
> - **Verify (one-time):** `teams` table uses `Bosnia-Herzegovina` spelling — EF already maps `Bosnia & Herzegovina`→`Bosnia-Herzegovina` and `USA`→`United States`; add to the map if a new odds-API spelling appears.
> - **Note:** champion odds are only relevant pre-Jun-11 (pick lock). Game 1X2/O-U odds come from `football-api-sync sync_af_odds` (`af-odds-daily`), not here.

### 3. nightly-summary (v32) — per-group AI roast
- **Logic:** 5 agents (gpt-4o-mini, temps 0.6/0.5/0.4/0.6/0.6) → gpt-4o judge (accuracy-first, weights 45/30/15/10, accuracy ≤3 = DQ) → winner → `ai_summaries` (+ `winner_score`, `version_tag`, `input_json`, `display_data.global_ranks`). `ai_judge_runs` logs all candidates.
- **Modes:** single-group (`group_id` in body — what per-group crons use) · legacy loop (no `group_id`, manual/test) · prompt test (`version_id`, agent 1 only, no judge).
- **Qualifying:** ≥3 active members. Single-group mode trusts the cron (doesn't re-check).
- **Failure handling:** agent 2× retry (5s) → fallback msg · judge 2× retry (3s) → defaults winner=agent 1, scores 0 · save retry once → `failed_summaries` · timeout 120s (unreachable in single-group).
- **Trigger:** `ai-summary-{date}-{group[:8]}` last_KO+150m (body `{date, group_id}`) + `ai-summary-push-{date}` last_KO+160m, via `fn_schedule_ai_summaries`.

> 📌 **Review notes (nightly-summary) — EF 3 fully reviewed:**
> - **Mandatory inputs = finished game scores + users' points.** No finished games → `no_games_today` (skip); not all finished → `games_not_finished` (wait). Player **stats are OPTIONAL** (`statsReady` flag just adds/omits goal-scorer detail; summary still runs without them). → **EF 3 depends on EF 1** delivering scores at KO+120; that's why it fires at last_KO+150.
> - **Qualifying = ≥3 active members** (`is_inactive=false`), confirmed in code.
> - **Writer (agent) failure — graceful.** Each of the 5 agents retries once (2 attempts, 5s gap). Weak/empty output (<50 chars) → submits the **"analyst sick" fallback** as its candidate (still judged, ranks last). If **all** fall back → users see the "analyst sick" message. A **hard API exception on both tries** can skip that group for the night (logged as error) — rare.
> - **Judge failure — graceful but silent.** Judge retries (2 attempts); if it still fails → **defaults winner to agent #1 (`main`)** with **all-zero scores** (`winner_score=0`), summary still ships. **No admin alert.** Only trace: `winner_score=0` + `judge_reasoning` says "Judge failed" → a 0 score is the de-facto failure signal, but it's inferred, not flagged.
> - **Save failure** → content preserved in `failed_summaries` (group_id, date, content, error_msg), group skipped, retry/backfill later. Nothing lost.
> - **Issue 1 (test groups get nightly AI + cost) — RESOLVED by fresh production** (copy logic, no data → only real groups qualify; same approach as WC games/lineups).
> - **Issue 2 (cost) — accepted, no action.** Each qualifying group = 6 LLM calls/night (5 gpt-4o-mini + 1 gpt-4o judge) for ~5 weeks. Budget item, not a bug.
> - **Issue 3 (judge-fail is silent) — KEEP AS-IS for now (graceful degradation is fine).** 🟢 **Optional future improvement: add a `judge_failed` boolean column only — NO admin message.** Just a passive marker so judge failures are explicit instead of inferred from `winner_score=0`; reviewed later for judge/prompt quality, not alerted in real time (low severity — summary still ships via agent #1).
> - **Issue 4 (schedulers never prune old crons) — RESOLVED by fresh production** (starts clean; no stale/2022 ai-summary crons carried over).

### 4. notify-admin (v12) — admin email
- **Logic:** Resend → `itayavioz1@gmail.com`. Types: `new_user`, `feedback`, `failed_summary`, `ef_error`, `daily_digest`. **`FROM_ADDRESS='onboarding@resend.dev'` (Resend sandbox, line 4).** Digest reads games, AI tokens, users/feedback, predictions/picks from `prediction_edit_log`/`pick_edit_log`, judge wins, EF errors.
- **Failure handling:** missing key → 500 · Resend non-OK → 500 + detail (no retry).
- **Trigger:** `admin-daily-digest` 08:00 UTC → `fn_daily_admin_digest`; ad-hoc via `fn_notify_admin`.

> 📌 **Review notes (notify-admin) — EF 4 reviewed. Admin-only EF: if it lagged, the tournament still runs fine for users. All underlying data (users, feedback, errors) is always stored in the DB — emails are just notifications, nothing is ever lost.** Current state: all mails arrive correctly.
> - **Issue 1 — 🟡 Sandbox sender (`onboarding@resend.dev`).** It's Resend's shared test address → risk of (a) landing in **spam**, (b) hitting the **free-tier daily cap** on a burst (mass registrations / error cascade = 1 email each; over the cap → 429, and with no retry that alert is dropped). **A custom domain is NOT required** — it works today sending to the owner's own Gmail. **Domain verify = OPTIONAL reliability upgrade** (own a domain → add Resend DNS records → set `FROM_ADDRESS=you@yourdomain` → inbox + send-to-anyone — **deliverability ONLY**). **Important: a domain does NOT raise the volume cap** — that cap is the Resend PLAN tier (a verified domain on free still caps ~100/day; raise the cap = upgrade plan, separate from the domain). App is on a github.io subdomain (not email-verifiable), so this would mean buying a domain. **Decision: leave on sandbox; only buy+verify a domain if emails actually start going to spam / getting cut off during the WC.** Feedback fallback: digest shows the **count** of new feedback; full content always readable in the `feedback` table.
> - **Issue 2 — 🟢 No HTML escaping** on user text (feedback message, username). Only the admin receives these emails → worst case is a slightly broken layout in your own inbox. **Accepted as-is** (cosmetic, no user/security impact).
> - **Issue 3 — 🟢 No retry on Resend 429/5xx.** A transient Resend error drops that one alert. Daily digest recovers next day; data is in the DB regardless. **Low priority** — optional single retry, not needed for go-live.

### 5. send-push (v8) — Web Push
- **Logic:** `npm:web-push`, `{TTL:60, urgency:'high'}`, `Promise.allSettled` parallel, 410/404 → bulk-delete stale subs. VAPID private from vault `Notification_Key`.
- **Failure handling:** non-410/404 → `failed++` + console only (**no `ef_errors`** — systemic outage invisible).
- **Trigger:** `ko-notif-{id}` (KO−15m, `fn_notify_ko`, broadcast all subs, **no auth header**) · `trivia-push-daily` 19:00 UTC · `ai-summary-push-{date}` (`fn_notify_ai_summary_daily`, dedup per user) · `cleanup-push-subs-daily` 03:00 UTC.

> 📌 **Review notes (send-push) — EF 5 reviewed. Push is engagement, not core scoring — the tournament runs fine without it. Engine is solid (already iOS-hardened: urgency:high, TTL:60, parallel sends, stale-token pruning). Current: 5 subs / 3 users.**
> - **Issue 1 — 🟡 System-wide push failure is silent.** Dead subscriptions (410/404) are handled (auto-deleted). But other failures — bad VAPID key, web-push throwing for the whole batch — only `console.error` + `failed++`, **no `ef_errors`** → no admin alert; push could stop for everyone unnoticed. **Mitigation: the admin is also a push user**, so a total outage = you stop getting your own pings — but that's a **weak self-check** (a missing notification is easy to overlook, and a partial failure wouldn't reach you). **Decision: optional/low-priority** — add `ef_errors` logging on batch failure if you want a real alert; acceptable to rely on self-check given push is non-core.
> - **Issue 2 — 🟢 iOS push requires standalone PWA + iOS 16.4+.** Platform rule, already built around. Awareness only.
> - **Issue 3 — 🟢 Icon `?v=3` cache-bust — NON-ISSUE.** Only matters if the notification icon is ever changed (then bump `?v=`). No icon change planned → dropped.
> - **Push volume per user (confirmed):** ~**104** kickoff reminders (1/game, broadcast to ALL) + ~**40** trivia (1/day) + ~**40** AI-summary (1/night if in a group) ≈ **~184 pushes over ~6 weeks** (4–5/day at busy group-stage days). **Notification-fatigue risk** — some users may mute. 🟢 **Optional design idea:** limit KO reminders to games a user actually cares about (e.g. their group) to cut volume; product decision, not a bug.

### 6. Trigger/cron layer (the actual scheduling logic)
- **`trg_auto_schedule_game`** — `AFTER INSERT` (only) on `games` → `fn_auto_schedule_game()`, each call in its own EXCEPTION→WARNING block (cron error never aborts INSERT):
  1. `fn_schedule_auto_predictions()` — **unconditional, ALL games** (no date/fixture filter).
  2. `fn_schedule_ai_summaries()` — **unconditional, ALL dates × qualifying groups**.
  3. `fn_schedule_game_sync(NEW.id)` — **only if `kick_off_time > now()` AND `api_fixture_id IS NOT NULL`**.
  4. `fn_schedule_ko_notification(...)` — only if `kick_off_time > now()`.
- **Auth from pg_cron:** vault `app_edge_function_url` + `app_service_role_key`. `fn_schedule_game_sync` reads the key **inline at fire time** (safe); `fn_schedule_ai_summaries` + `af-odds-daily` **bake the JWT into the cron command string** (visible in `cron.job.command`).
- **Idempotency:** `fn_schedule_game_sync`/`_af_odds_sync` unschedule-then-schedule (clean). `fn_schedule_auto_predictions`/`_ai_summaries` upsert by jobname (no double-fire) but **never prune obsolete names** → stale accumulation.
- **Timing:** sync KO+120m, AI summary last_KO+150m (30-min gap so scores land first — correct per M83). No `::text` body bug remains.

> 📌 **Review notes (crons/triggers) — EF 6 reviewed. The DB scheduling backbone. Trigger fan-out + timing confirmed correct; the old `::text` silent-failure bug is gone.**
> - **Issue 1 — INSERT-only trigger gap — SOLVED via EF 1** (insert games complete with `api_fixture_id` → trigger fires → all crons auto-create; never UPDATE placeholders). Same root item, not separate.
> - **Issue 2 — 🟡 Schedulers add-only, never prune — NON-ISSUE in fresh production, kept as a recommendation.** Most alarms self-delete when they fire (auto-predict, sync/verify, trivia-miss); only past-date ai-summary jobs linger (bounded ~40 dates × groups, never fire → harmless). True orphans only occur if you DELETE a game that still has pending alarms — which won't happen under the insert-complete / no-TBD-placeholder plan (no deletes). **Recommendation (optional, low priority):** a periodic prune of `auto-predict-%` not in `games` + past-date `ai-summary-%`. Not needed for a one-time 6-week tournament.
> - **Issue 3 — 🟡 Service-role JWT stored plaintext in `cron.job.command` (ai-summary + af-odds schedulers) — OK to fix.** NOTE: this is the **service-role key pg_cron uses to call the EFs**, NOT the API keys (OpenAI/Football/Resend/push live in EF secrets/vault — those are fine). Master copy is in the vault correctly; the problem is a **plaintext copy pasted into the cron command** at schedule time. **Exposure is admin-only** — only DB roles with access to `cron.job` (postgres/service_role) can read it; app users (anon/authenticated) cannot. **Fix:** switch `fn_schedule_ai_summaries` + `fn_schedule_af_odds_sync` to the **inline vault lookup** pattern `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_service_role_key')` — exactly what `fn_schedule_game_sync` already does → no plaintext copy anywhere.

---

## Part 2 — Verification results

| # | Check | Result (2026-05-23) | Flag |
|---|---|---|---|
| C0 | EF code vs local | all 5 == local; football-api-sync +2 test modes; versions stale in docs | 🟡 |
| C1 | Games composition | **178** (group 135, friendly 6, qf 6 incl. 2022-12-09, r32 18, r16 8, sf 2, third 1, final 2) | 🔴 |
| C2 | Cron families | ai-summary 368 · auto-predict 184 · ko-notif 104 · trivia-miss 45 · ai-summary-push 37 · sync-game 4 · verify-game 4 · singletons OK | 🟡 |
| C3 | Failed cron runs (7d) | **0** | 🟢 |
| C4 | WC-window sync coverage | wc=102, api_id=**2**, sync=**2**, verify=**2**, autopred=102, konotif=102, tbd=32 | 🔴 |
| C5 | Auto-predict crons on old games | **75** | 🔴 |
| C6 | EF errors (14d) | **0** | 🟢 |
| C7 | Vault secrets | `app_edge_function_url`, `app_service_role_key` present | 🟢 |
| C8 | Push subs | 5 subs / 3 users (cleanup pruning) | 🟢 |
| C11 | Games `api_fixture_id` NULL | **105 / 178** | 🔴 |
| C12 | Orphan auto-predict crons | 184 jobs > 178 games → orphans for deleted/test games | 🟡 |
| C13 | Stale ai-summary crons (past dates) | incl. bogus `ai-summary-2022-12-09` | 🟡 |
| C14 | Service-role key in `cron.command` | present in ai-summary + af-odds jobs (plaintext JWT) | 🟡 |
| C15 | Qualifying groups | 8 qualify; **7 are test** (Demo/Test/Test2-4/The Legends/cheaters), 1 real (Kanta Bayam) | 🔴 |

Core checks re-run and stable vs 2026-05-22.

---

## Part 3 — Gaps, fixes & improvements (by need + impact)

### 🔴 Blockers — break the tournament
1. **No score/stats sync for real games** — the INSERT-only trigger gap. *(C4 2/102, C11 105/178)*
   `trg_auto_schedule_game` is `AFTER INSERT`; `setup` fills `api_fixture_id` via **UPDATE**, which never
   creates the `sync-game`/`verify-game` crons. Knock-on: no scores → no `knockout_winner` → champion/
   top-scorer points never award → AI summaries roast nothing → no live AF odds.
   **Fix:** after `setup`, run the M71-style backfill (`fn_schedule_game_sync` for every future game with
   `api_fixture_id`), **and/or** add an `AFTER UPDATE OF api_fixture_id` trigger that schedules when it goes
   NULL→set and KO is future. Re-run C4 until `api_id = sync = verify`.
2. **Test-data pollution feeds the live pipeline.** *(C1 178; C5 75; C12; C13; C15 7/8)*
   65 pre-Jun-11 test group games + a 2022 `qf` game; 7 of 8 qualifying groups are test groups (each =
   nightly OpenAI spend: 5×gpt-4o-mini + gpt-4o judge, all tournament); 75 auto-predict crons on old games
   + orphan crons for deleted games; 368 ai-summary crons incl. a 2022 date.
   **Fix:** delete non-WC games (decide on the 6 `friendly`); drop test groups below 3 active members; then
   re-run `fn_schedule_auto_predictions()` + `fn_schedule_ai_summaries()` and prune stale `auto-predict-%`/
   `ai-summary-%` jobs whose game/date no longer exists.

### 🟡 Should-fix — degrade or risk, don't break gameplay
3. **notify-admin sandbox sender** — `FROM_ADDRESS=onboarding@resend.dev` (Resend sandbox) → digests/alerts
   likely spam-filtered or undelivered, so failures during the WC go unseen. **Fix:** verify a Resend domain,
   set `FROM_ADDRESS`, redeploy. *(Agent flagged this 🔴 for admin observability.)*
4. **Service-role JWT in `cron.command` plaintext** *(C14)* — anyone with `SELECT` on `cron.job` sees a god
   key. **Fix:** use the inline `(SELECT decrypted_secret FROM vault.decrypted_secrets …)` pattern (as
   `fn_schedule_game_sync` does) in `fn_schedule_ai_summaries` + `af-odds-daily` instead of baking the key in.
5. **Stale/orphan cron accumulation** *(C12/C13)* — schedulers only add. **Fix:** prune `auto-predict-%` not in
   `games` and `ai-summary-%` for past dates at the top of each scheduler; delete the 2022 test game.
6. **football-api-sync: no terminal-status handler** — abandoned/postponed (`PST/SUSP/ABD/CANC/AWD/WO`) retry
   `+5m` forever, never unschedule. **Fix:** treat terminal non-FT statuses as done-or-alert + unschedule.
7. **writeStats swallows errors** — a game can finish with score but no stats; only signal is `ef_errors('stats_write')`.
   **Fix:** watch the digest for `stats_write`; optionally surface a `stats_warning` in the `done` response (`sync_stats` backfills).
8. **sync-odds external trigger is a SPOF & unverifiable** — runs on cron-job.org, invisible in Supabase.
   **Fix:** confirm the job is live + key valid, or move it to pg_cron for auditability.
9. **send-push outages invisible** — non-410/404 failures only `console.error`. **Fix:** insert `ef_errors` when a batch fails.
10. **Doc/version drift** — `supabase/CLAUDE.md` lags (v34/v23/v32/v12). **Fix:** update the EF table; add `probe_date`/`probe_ns` to the local football-api-sync source so a CLI redeploy doesn't drop them.

### 🟢 Improvements — optional
11. notify-admin: HTML-escape user-supplied feedback/username; single retry on Resend 429/5xx.
12. nightly-summary: flag judge-failed rows (winner defaulted to agent 1, scores 0) for analytics.
13. football-api-sync: write partial ET/penalty scores during `et_followup` stage (faster live UI).
14. `setup_lineups` last-name match can mis-assign `api_player_id` for common surnames — review output during setup.
15. Confirm `fn_notify_ko` broadcasting KO alerts to ALL subscribers (not group-filtered) is desired at WC volume.

### Go-live checklist (ordered)
1. **Clean test data** — delete 65 test group games + 2022 `qf` game (decide on `friendly`); drop test groups below 3 active; prune their crons (C5/C12/C13 → 0).
2. **Confirm fixtures** — `probe` league=1/season=2026 returns 104.
3. **Map** — `setup`; resolve `unmatched`.
4. **Backfill sync crons** — `fn_schedule_game_sync` per mapped game (or add UPDATE trigger); re-run C4 until `api_id = sync = verify`.
5. **Reschedule derived crons** — `fn_schedule_auto_predictions()` + `fn_schedule_ai_summaries()`.
6. **notify-admin domain** — verify Resend, set `FROM_ADDRESS`, redeploy.
7. **Security** — move cron JWT to inline vault lookup (gap #4).
8. **Docs** — reconcile EF versions + add the 2 test modes to local source.
9. **Post-group-stage** — re-run `setup` for resolved knockouts, then `setup_lineups`.

> Re-run anytime with `/verify-ef-sync` (read-only).

---

## Decision Sheet — Issue Table (curated 2026-05-23)

Reflects the per-EF review decisions (the 📌 notes above). **Supersedes the Part 3 draft recommendations + go-live checklist** where they differ (Part 3 predates this EF-by-EF review). Removed as resolved/accepted/dropped/non-issue: original #7, #10, #12–#17, #20–#23, #26, #27.
**Risk** = chance implementing it destabilizes the currently-working system · **Cx** = implementation effort (low/med/high).

| # | EF | Issue | Sev | Risk | Cx | Status | What needs to be done |
|---|---|---|---|---|---|---|---|
| 1 | football-api-sync | Real games not connected (INSERT-only gap) → no score/stats sync | 🔴 | Med | Low* | Solved by design | **Manually pull + INSERT each group game and each knockout round as a complete row** (teams + KO + `api_fixture_id`); never UPDATE placeholders → trigger auto-creates all crons. *Recommendation only (not a must):* a daily `sync_fixtures` auto-pull for knockouts (*=Med Cx if built). |
| 2 | football-api-sync | KO change >5min reschedules only sync/verify | 🟡 | Med | Med | Open | In `verify`, on >5min change also reschedule `auto-predict-{id}` + `ko-notif-{id}` (ideally one `fn_reschedule_game(id)` helper). |
| 3 | football-api-sync | Abandoned/postponed games retry +5min forever | 🟡 | Low | Low | Open | Detect terminal statuses (PST/SUSP/ABD/CANC/AWD/WO/INT) → unschedule + `ef_errors`. Optional KO+6h hard stop. |
| 4 | football-api-sync | Stats can silently go missing | 🟡 | Med | Med | Open | `writeStats` reports fail → reschedule +5min retry, capped (≈3–5 / KO+3h) → then unschedule + `ef_errors`. |
| 5 | football-api-sync | Local source behind deployed v34 (`probe_date`/`probe_ns`) | 🟡 | Low | Low | Open | Copy the 2 test modes into local source so file == live. |
| 6 | football-api-sync | Improvement: stats-missing visibility | 🟢 | Low | Low | Optional | Add `stats_warning` to the `sync` response (overlaps #4). |
| 8 | football-api-sync | Top-scorer candidates need real player IDs (avoid surname mis-match) | ℹ️ | Low | Low | Open (1-time setup) | **Pull all players once manually** from team lineups (`setup_lineups`) at production setup — each with real `api_player_id`, no name-linking → top-scorer scoring matches reliably. |
| 9 | sync-odds | External trigger (cron-job.org) invisible / SPOF | 🟡 | Low | Low | Mitigated | Failure-notify ON (done). Optional: move to Supabase pg_cron (daily 07:00 until Jun 11). |
| 11 | sync-odds | Bosnia/USA name mapping | ℹ️ | Low | Low | Verify | One-time: confirm `teams` table uses `Bosnia-Herzegovina`. |
| 18 | notify-admin | No retry on Resend 429/5xx | 🟢 | Low | Low | Optional | Add a single re-send on failure. |
| 19 | send-push | Failures invisible — not in `ef_errors`, so not in the digest | 🟡 | Low | Low | Open | Insert `ef_errors` on batch/whole-send failure → push outages then show in the summary mail (+ optional instant alert). |
| 24 | crons/triggers | Schedulers never prune (orphans/stale) | 🟡 | Med | Med | Non-issue (fresh prod) | Optional periodic prune of `auto-predict-%` not in `games` + past-date `ai-summary-%` (careful WHERE — deletes jobs). |
| 25 | crons/triggers | Service-role JWT plaintext in `cron.job.command` (ai-summary + af-odds) | 🟡 | Med | Med | Open | Switch `fn_schedule_ai_summaries` + `fn_schedule_af_odds_sync` to inline vault lookup (as `fn_schedule_game_sync` does). Touches functions with bug history (M56/M74) → test carefully. |

**Production one-time manual setup:** #1 (pull + insert all games) · #8 (pull all players).
**Open code fixes to decide:** #2, #3, #4, #5, #19, #25. **Optional:** #6, #9, #18, #24. **Verify:** #11.
