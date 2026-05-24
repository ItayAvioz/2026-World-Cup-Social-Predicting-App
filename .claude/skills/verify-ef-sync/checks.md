# Check catalog — read-only SQL (project `ftryuvfdihmhlzvbpfeu`)

All queries are SELECT-only. Run core DB checks (C1–C6) **3× each** for repeatability.
"Expected for WC" is the green state once the tournament is configured. Real WC = 104 games
(72 group + 16 r32 + 8 r16 + 4 qf + 2 sf + 1 third + 1 final), window 2026-06-11 → 2026-07-19.

---

### C0 — Deployed EF versions (vs docs)
`list_edge_functions` → record `slug` + `version` + `status`. Compare to `supabase/CLAUDE.md`
"Edge Functions" table. Flag any live version ahead of the doc (deployed code may differ from local).

### C1 — Games composition (test-data pollution)
```sql
select phase,
  count(*) as games,
  count(*) filter (where api_fixture_id is not null) as with_api_id,
  count(*) filter (where score_home is not null) as with_score,
  count(*) filter (where team_home='TBD' or team_away='TBD') as tbd,
  count(*) filter (where kick_off_time >= '2026-06-11' and kick_off_time < '2026-07-20') as in_wc_window,
  min(kick_off_time)::date as min_ko, max(kick_off_time)::date as max_ko
from games group by phase order by min(kick_off_time);
```
Expected: total ≈ 104. 🔴 if total ≫ 104 (test rows), or any `kick_off_time` < 2026-06-11 outside
the `friendly` phase, or a pre-2026 date present.

### C2 — Cron inventory by family
```sql
with cat as (
  select case
    when jobname ~ '^ai-summary-push-' then 'ai-summary-push'
    when jobname ~ '^ai-summary-'      then 'ai-summary-pergroup'
    when jobname ~ '^sync-game-'        then 'sync-game'
    when jobname ~ '^verify-game-'      then 'verify-game'
    when jobname ~ '^auto-predict-'     then 'auto-predict'
    when jobname ~ '^ko-notif-'         then 'ko-notif'
    when jobname ~ '^trivia-miss-'      then 'trivia-miss'
    else jobname end as category, active
  from cron.job
)
select category, count(*) total,
  count(*) filter (where active) active,
  count(*) filter (where not active) inactive
from cat group by category order by total desc;
```
Expected singletons present: `af-odds-daily`, `admin-daily-digest`, `auto-assign-picks`,
`trivia-push-daily`, `cleanup-push-subs-daily`.

### C3 — Recently failed cron runs
```sql
select j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r join cron.job j on j.jobid=r.jobid
where r.status <> 'succeeded' and r.start_time > now() - interval '7 days'
order by r.start_time desc limit 50;
```
Expected: empty. 🔴 any `failed`/`couldn't find` rows (silent EF failures — historic ::text/timing bugs).

### C4 — ⭐ WC-window data-sync coverage (the headline gap)
```sql
with wc as (select id from games
  where kick_off_time >= '2026-06-11' and kick_off_time < '2026-07-20')
select count(*) wc_games,
  count(*) filter (where api_fixture_id is not null) have_api_id,
  count(*) filter (where exists(select 1 from cron.job j where j.jobname='sync-game-'||wc.id))   have_sync,
  count(*) filter (where exists(select 1 from cron.job j where j.jobname='verify-game-'||wc.id)) have_verify,
  count(*) filter (where exists(select 1 from cron.job j where j.jobname='auto-predict-'||wc.id)) have_autopred,
  count(*) filter (where exists(select 1 from cron.job j where j.jobname='ko-notif-'||wc.id))     have_konotif,
  count(*) filter (where team_home='TBD' or team_away='TBD') tbd
from (select wc.id, g.api_fixture_id, g.team_home, g.team_away from wc join games g on g.id=wc.id) wc;
```
Expected (post-setup, pre-group-resolution): `have_api_id` = `have_sync` = `have_verify` ≈ 72
(group games mapped; TBD knockouts mapped after group stage). 🔴 if `have_sync ≪ have_api_id`.

### C5 — Live crons pointing at old/test games
```sql
select count(*) autopred_on_old, array_agg(g.team_home||' v '||g.team_away order by g.kick_off_time) examples
from games g
where g.kick_off_time < '2026-06-11'
  and exists(select 1 from cron.job j where j.jobname='auto-predict-'||g.id);
```
Expected: 0. 🟡/🔴 any count > 0 (will fire junk auto-predictions before/around the tournament).

### C6 — EF error log (recent)
```sql
select ef_name, error_type, count(*), max(created_at) last_seen
from ef_errors where created_at > now() - interval '14 days'
group by ef_name, error_type order by last_seen desc;
```
Expected: empty/benign. Investigate `quota` (rate limit), `crash`, `stats_write`.

### C7 — Vault secrets present (names only)
```sql
select name from vault.secrets order by name;
```
Expected to include: `app_edge_function_url`, `app_service_role_key`. (EF runtime secrets —
`FOOTBALL_API_KEY`, `AI_Summary_GPT_Key`, `theoddsapi`, `RESEND_API_KEY`, `Notification_Key` — live
in EF env, not vault; can't be read, confirm via EF behavior/logs.)

### C8 — Push subscriptions sanity
```sql
select count(*) subs, count(distinct user_id) users, max(created_at) newest from push_subscriptions;
```
Expected: ≥1 sub if push has been tested; ≤2 per user (cleanup cron).

### C9 — Advisors
`get_advisors(type='security')` and `get_advisors(type='performance')` — record any new notices.

### C10 — Source vs deployed drift (spot check)
For any EF where C0 shows version drift, `get_edge_function(slug)` and diff against
`supabase/functions/<slug>/index.ts`. Note functional differences (not just version banner).
**Last audit (2026-05-23):** all 5 EFs == local; football-api-sync v34 deployed adds 2 test-only modes
(`probe_date`, `probe_ns`) absent from the local file. Drift is label-only — no production code drift.

### C11 — ⭐ api_fixture_id set but no sync cron (INSERT-only trigger gap)
```sql
select count(*) total_games,
  count(*) filter (where api_fixture_id is null) api_id_null,
  count(*) filter (where api_fixture_id is not null
    and kick_off_time > now()
    and not exists(select 1 from cron.job j where j.jobname='sync-game-'||games.id)) mapped_but_no_sync
from games;
```
🔴 `mapped_but_no_sync > 0` ⇒ `setup` UPDATEd `api_fixture_id` but `trg_auto_schedule_game` (AFTER INSERT
only) never created the cron. Fix = M71-style `fn_schedule_game_sync` backfill, or an AFTER UPDATE trigger.

### C12 — Orphan auto-predict crons (game no longer exists)
```sql
select count(*) orphan_autopred
from cron.job j
where j.jobname ~ '^auto-predict-'
  and not exists (select 1 from games g where 'auto-predict-'||g.id = j.jobname);
```
🟡 > 0 ⇒ schedulers only add, never prune; crons reference deleted/test games. Clean before go-live.

### C13 — Stale ai-summary crons for past dates
```sql
select count(*) past_ai_summary
from cron.job
where jobname ~ '^ai-summary-[0-9]{4}-[0-9]{2}-[0-9]{2}'
  and substring(jobname from 'ai-summary-(\d{4}-\d{2}-\d{2})')::date < current_date;
```
🟡 > 0 ⇒ leftover per-group jobs (incl. any 2022 test-game date). `fn_schedule_ai_summaries` skips *firing*
past dates but never unschedules old job rows.

### C14 — Service-role key baked into cron command (security)
```sql
select count(*) jobs_with_inline_jwt
from cron.job
where command ~* 'Bearer eyJ';   -- a literal JWT in the command string
```
🟡 > 0 ⇒ plaintext service-role JWT readable by anyone with SELECT on `cron.job`. Prefer the inline
`(SELECT decrypted_secret FROM vault.decrypted_secrets …)` pattern used by `fn_schedule_game_sync`.

### C15 — Qualifying groups feeding nightly AI (test vs real)
```sql
select g.name, count(*) filter (where not gm.is_inactive) active_members
from groups g join group_members gm on gm.group_id=g.id
group by g.id, g.name having count(*) filter (where not gm.is_inactive) >= 3
order by active_members desc;
```
🔴 if test groups (Demo/Test*/The Legends/cheaters) appear — each qualifying group = a nightly cron +
OpenAI spend (5×gpt-4o-mini + gpt-4o judge) for the whole tournament. Drop test groups below 3 active.
