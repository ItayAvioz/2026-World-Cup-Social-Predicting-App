# PROD Verification — focused on DEV ↔ PROD deltas

## Context

DEV (`ftryuvfdihmhlzvbpfeu`, Tokyo) was the source-of-truth for the cutover and remains the chatbot-R&D playground. PROD (`asugxlvgcmkxspzokydk`, Frankfurt) was built from DEV at V13 baseline on **2026-05-30** and went live at pickyguessers.com via gh-pages SW v36. WC2026 kicks off in **11 days** (2026-06-11 19:00 UTC). Between V13 sign-off and today, **PROD has diverged from DEV in five specific ways** (one schema seed, one data backfill, one EF version, two behavioral migrations that landed on both but later than V13). Re-verifying every dev gate would be wasted effort — the cutover already validated parity through V13. What needs **focused verification today** is exactly those five deltas, plus one end-to-end test that exercises every one of them as a real user.

## Exact DEV ↔ PROD deltas since V13 cutover

Verified by `SELECT version FROM supabase_migrations.schema_migrations` on both projects (timestamps shown are when each project recorded the apply, not file numbers):

| # | Delta | Where | Verified via |
|---|---|---|---|
| Δ1 | **M124 — wc2026_official_squad_seed (1051 active top_scorer_candidates + 4 chunked applies)** | **PROD ONLY** | 5 schema_migrations rows on PROD with 2026-05-31 timestamps; nothing equivalent on DEV |
| Δ2 | **Flag-code backfill** (140 NULL → 0 via `UPDATE ... FROM teams`) applied today via `execute_sql` | **PROD ONLY** | `top_scorer_candidates` query: `is_active=true AND flag_code IS NULL` returns 0 |
| Δ3 | **football-api-sync EF v9** (adds 4 modes: `bootstrap_squads`, `bootstrap_wc_players`, `probe_wc_team`, `lookup_players`) | **PROD ONLY** | DEV still at v36 baseline (no v9 modes); see `supabase/CLAUDE.md` EF table |
| Δ4 | **M122 — solo-user picks visible on global leaderboard** (`get_leaderboard` + `get_group_leaderboard` JOIN `=` → `IS NOT DISTINCT FROM`) | **Both** (post-V13) | M122 applied to both 2026-05-31; behavior is a no-op for grouped users, only changes for solo |
| Δ5 | **M123 — `fn_auto_predict_game` adds solo-user loop** | **Both** (post-V13) | M123 applied to both 2026-05-31; behavior only kicks in for ungrouped users with no manual prediction |
| Δ6 | **Frontend deploy: SW v36** (Picks api_player_id key fix + position filter + TEAM_SHORT short-name map + `.pk-group-tab min-width`) | **Single frontend** (only one to ship) | gh-pages commit `ae139d8`; `__APP_VER__ = 36` at pickyguessers.com |
| Δ7 | **Data state difference**: PROD is fresh (2 profiles, 0 groups, 0 predictions, 0 ai_summaries, 72 group games, 0 KO games); DEV has years of test data, 23 users, 186 test games, 706 cron jobs | Inherent | Snapshot run today on both |

Notes:
- M117/M118/M119/M121 landed before V13 sign-off (parity-fix migrations that closed the V13 gap) — already validated by the cutover and not re-checked here.
- M120 (PROD-only prompt_versions seed) was applied at V8/P8 of the cutover — already part of V13 baseline.
- KO games NOT inserted yet (Option C per-round insert per `docs/PLAN_KNOCKOUT_FIXES.md`) — that's a future Phase, not a delta-to-verify.

---

## §1. Δ1 + Δ2 — M124 squad seed + flag backfill (PROD-only)

```sql
-- §1.1 schema_migrations carries the 5 chunks
SELECT version FROM supabase_migrations.schema_migrations
WHERE version LIKE '20260531%' ORDER BY version;
-- PASS: 5 rows (the 4 INSERT chunks + 1 deactivate) all from 2026-05-31

-- §1.2 row state matches expected end state
SELECT COUNT(*) FILTER (WHERE is_active)              AS active,
       COUNT(*) FILTER (WHERE NOT is_active)          AS deactivated,
       COUNT(*) FILTER (WHERE is_active AND flag_code IS NULL)     AS null_flag,
       COUNT(*) FILTER (WHERE is_active AND position IS NULL)       AS null_position,
       COUNT(*) FILTER (WHERE is_active AND api_player_id IS NULL)  AS null_api_id,
       COUNT(DISTINCT team_name) FILTER (WHERE is_active)           AS teams_covered
FROM top_scorer_candidates;
-- PASS: 1051 / 472 / 0 / 0 / 0 / 42  (Phase 2 will lift teams_covered → 48)

-- §1.3 every active row's team_name resolves in teams (and inherits its flag)
SELECT COUNT(*) FROM top_scorer_candidates tsc
LEFT JOIN teams t ON t.name = tsc.team_name
WHERE tsc.is_active AND (t.name IS NULL OR tsc.flag_code <> t.flag_code);
-- PASS: 0

-- §1.4 star strikers regression check (the names users will pick most)
SELECT name, team_name, api_player_id, position FROM top_scorer_candidates
WHERE is_active AND name IN ('Harry Kane','Kylian Mbappé','Cristiano Ronaldo','Erling Haaland',
  'Vinicius Junior','Alexander Isak','Lautaro Martinez','Nico Williams','Lionel Messi');
-- PASS: ≥ 8 rows present (Mohamed Salah may be missing — Egypt yet to publish; that's Phase 2)

-- §1.5 M124 source file matches what was applied (today's patch added flag_code backfill before COMMIT)
-- Check: supabase/migrations-prod/20260531000124_wc2026_official_squad_seed.sql ends with
-- "UPDATE public.top_scorer_candidates tsc SET flag_code = t.flag_code FROM public.teams t ..."
-- PASS: grep confirms 1 occurrence
```

**Why this matters**: M124 is the largest single change since V13 — 1051 PROD-only rows. The flag backfill was a same-day fix because the original M124 INSERT didn't carry `flag_code`. Both must read as final state.

---

## §2. Δ3 — football-api-sync EF v9 (PROD-only)

```bash
# §2.1 PROD has v9 source with all 4 new modes
mcp__supabase__get_edge_function(project_id='asugxlvgcmkxspzokydk', slug='football-api-sync')
# PASS: source includes the literals 'bootstrap_squads', 'bootstrap_wc_players',
#       'probe_wc_team', 'lookup_players'

# §2.2 baseline modes still intact (didn't break verify/sync/sync_af_odds/setup/setup_lineups/sync_stats)
# Look for these handler keywords in the same source: 'verify', 'sync_stats', 'sync_af_odds', 'setup', 'setup_lineups'
# PASS: all 5 present

# §2.3 smoke: harmless mode
curl -X POST <prod-fn-url>/football-api-sync \
  -H "Authorization: Bearer <ANON_KEY>" \
  -d '{"mode":"verify"}'
# PASS: 200 + dry verify summary

# §2.4 smoke: a v9-specific mode (read-only)
curl -X POST <prod-fn-url>/football-api-sync -d '{"mode":"probe_wc_team","team_id":768}'
# PASS: 200 + team metadata for Argentina (api_team_id 768 — adjust per data)

# §2.5 dev still on v36-equivalent (does NOT have the new modes — confirms isolation)
mcp__supabase__get_edge_function(project_id='ftryuvfdihmhlzvbpfeu', slug='football-api-sync')
# PASS: source does NOT contain 'bootstrap_squads' / 'bootstrap_wc_players' / 'lookup_players'
```

**Why this matters**: PROD EF source is genuinely different from DEV. Verifying v9 deploys cleanly + baseline modes still work catches any regression introduced when the v6 deploy accidentally broke prod earlier this week (caught + fixed → v7+ restored full handlers).

---

## §3. Δ4 — M122 solo-user leaderboard fix (both, but only solo path differs)

```sql
-- §3.1 RPC body contains the IS NOT DISTINCT FROM operator (M122)
SELECT pg_get_functiondef('public.get_leaderboard'::regproc) ILIKE '%IS NOT DISTINCT FROM%' AS has_fix;
SELECT pg_get_functiondef('public.get_group_leaderboard'::regproc) ILIKE '%IS NOT DISTINCT FROM%' AS has_fix;
-- PASS: both = true

-- §3.2 behavior test: a solo user with picks shows their picks in the global leaderboard row
-- (verify_C in §6 end-to-end exercises this — read it there for the live test)

-- §3.3 grouped-user no-op check (must still work for grouped users — M122 was supposed to be
-- a no-op for them since NULL group_id only occurs for solo)
SELECT * FROM get_leaderboard() LIMIT 5;
-- PASS: returns rows with no NULL groups (until solo users exist)
```

---

## §4. Δ5 — M123 solo-user auto-predict (both, but only solo path differs)

```sql
-- §4.1 fn body contains the second loop for ungrouped users
SELECT pg_get_functiondef('public.fn_auto_predict_game'::regproc) ILIKE '%NOT IN (SELECT user_id FROM public.group_members%' AS has_solo_loop;
-- PASS: true

-- §4.2 ON CONFLICT clause respects (user_id, game_id, group_id) UNIQUE NULLS NOT DISTINCT (M36)
SELECT pg_get_functiondef('public.fn_auto_predict_game'::regproc) ILIKE '%ON CONFLICT (user_id, game_id, group_id) DO NOTHING%' AS has_conflict;
-- PASS: true

-- §4.3 behavior test: §6 step 17 inserts a fake near-future game + waits for the auto-predict
-- cron to fire — confirms a row is created for a solo user with group_id=NULL, is_auto=true
```

---

## §5. Δ6 — Frontend SW v36 + Picks fixes (single frontend, deployed only to gh-pages)

```bash
# §5.1 app version pinned
curl -s https://pickyguessers.com/app.html | grep -o '__APP_VER__ *= *[0-9]\+'
# PASS: __APP_VER__ = 36

# §5.2 service worker version matches
curl -s https://pickyguessers.com/sw.js | grep -o 'SW_VERSION *= *[0-9]\+'
# PASS: SW_VERSION = 36

# §5.3 latest Picks bundle deployed
curl -s https://pickyguessers.com/app.html | grep -o 'assets/Picks-[A-Za-z0-9]*\.js'
# PASS: Picks-BmsKiOks.js (matches deploy ae139d8)

# §5.4 source code changes shipped (read in repo)
grep -c "TEAM_SHORT" src/pages/Picks.jsx           # PASS: ≥ 2 (declaration + usage)
grep -c "positionFilter" src/pages/Picks.jsx       # PASS: ≥ 2
grep -c "apiId ?? p.name" src/pages/Picks.jsx      # PASS: ≥ 1 (apiId-as-key fix)
grep -c "min-width:5.5rem" css/style.css           # PASS: 1 (on .pk-group-tab)
```

**Why this matters**: Single bundle ships to both envs via hostname routing, but **only PROD users actually use it** — DEV is localhost-only. Visible smoke is on `pickyguessers.com`.

---

## §6. Δ7 — PROD data state is genuinely fresh (no DEV pollution)

```sql
SELECT 'profiles' AS k, COUNT(*) AS v FROM profiles
UNION ALL SELECT 'groups',           COUNT(*) FROM groups
UNION ALL SELECT 'group_members',    COUNT(*) FROM group_members
UNION ALL SELECT 'predictions',      COUNT(*) FROM predictions
UNION ALL SELECT 'ai_summaries',     COUNT(*) FROM ai_summaries
UNION ALL SELECT 'champion_picks',   COUNT(*) FROM champion_pick
UNION ALL SELECT 'top_scorer_picks', COUNT(*) FROM top_scorer_pick
UNION ALL SELECT 'feedback',         COUNT(*) FROM feedback
UNION ALL SELECT 'games_friendly_or_scored',
       COUNT(*) FROM games WHERE phase='friendly' OR score_home IS NOT NULL
UNION ALL SELECT 'games_named_test', COUNT(*) FROM games WHERE team_home ILIKE '%test%' OR team_away ILIKE '%test%';
-- PASS: profiles=2 (Itay+1), groups=0, group_members=0, predictions=0, ai_summaries=0,
--       champion_picks=2 (Itay solo test), top_scorer_picks=1 (Itay solo test),
--       feedback=0, games_friendly_or_scored=0, games_named_test=0

-- §6.1 DECISION: my 3 leftover fixtures
-- (a) keep them as dev fixtures (they exercise solo-user paths in production); OR
-- (b) DELETE FROM champion_pick WHERE user_id=<me>; DELETE FROM top_scorer_pick WHERE user_id=<me>;
-- and remove my 3 push subs from push_subscriptions
```

---

## §8. V13 sanity sweep (5-minute existence smoke — catches platform-level rot since V13)

Delta verification (§1-§6) doesn't catch things that V13 validated but can silently regress between then and launch (Supabase platform upgrades, accidental dashboard wipes, expired tokens). These 6 cheap **existence-only** checks fill that gap. Not a full re-validation — just "is the thing still there".

```sql
-- §8.1 security advisors regression check (0 ERROR-level)
-- MCP: mcp__supabase__get_advisors(project_id='asugxlvgcmkxspzokydk', type='security')
-- PASS: 0 entries with level='ERROR' beyond those triaged in docs/SECURITY_ADVISORS_PRE_CUTOVER.md

-- §8.2 5 EFs still ACTIVE with expected sha256 (catches accidental redeploys)
-- MCP: mcp__supabase__list_edge_functions(project_id='asugxlvgcmkxspzokydk')
-- PASS: football-api-sync ezbr_sha256 = 037045b428495d03... (v9 hash captured today)
--       other 4 EFs all status='ACTIVE'

-- §8.3 6 daily safety crons all active
SELECT jobname, active FROM cron.job
WHERE jobname IN ('ai-summary-schedule-daily','trivia-push-daily','admin-daily-digest',
                  'af-odds-daily','cleanup-push-subs-daily','auto-assign-picks')
ORDER BY jobname;
-- PASS: 6 rows, every active=true

-- §8.4 vault secret names present (per cutover B10)
SELECT name FROM vault.secrets ORDER BY name;
-- PASS: includes app_edge_function_url + app_service_role_key (external API keys are EF env vars, not vault)

-- §8.5 feedback storage bucket exists, private (per cutover B12)
SELECT id, public FROM storage.buckets WHERE id IN ('feedback','feedback-screenshots');
-- PASS: ≥ 1 row with public=false

-- §8.6 manifest + icons reachable on gh-pages (PWA + push install path)
-- curl -I https://pickyguessers.com/manifest.json   # PASS: 200
-- curl -I https://pickyguessers.com/icon-180.png    # PASS: 200
-- curl -I https://pickyguessers.com/icon-notif.png  # PASS: 200
```

If any §8 check fails → red flag, investigate before launch. Otherwise V13 baseline holds.

---

## §7. One complete end-to-end test (every delta exercised as a real user)

Sequential script — execute top-to-bottom on a clean profile. Every step has a pass criterion. Steps annotated **[Δn]** exercise the corresponding delta.

### Setup
- Browser A: desktop Chrome incognito → `https://pickyguessers.com`
- Browser B: iOS Safari (real device, for PWA + push)
- Browser C: Android Chrome (real device, for PWA + push)
- Admin tab: Supabase Studio for `asugxlvgcmkxspzokydk`

### Steps

| # | Step | Δ | Pass criterion |
|---|---|---|---|
| 1 | Hostname routing | — | Chrome devtools Network: all `/rest/v1`, `/auth/v1`, `/functions/v1` calls go to `asugxlvgcmkxspzokydk.supabase.co` (NOT dev) |
| 2 | Register fresh "verify_A" on Browser A | — | Row in `profiles`, redirect to `#/dashboard`, welcome toast |
| 3 | Admin email fires on register | — | `notify-admin event=new_user` arrives at itayavioz1@gmail.com within 10s |
| 4 | Create group "Verify-Smoke" | — | Rows in `groups` + `group_members`; invite code visible |
| 5 | Copy invite (desktop) | — | Clipboard contains `https://pickyguessers.com/?invite=<code>` |
| 6 | Open invite as "verify_B" (Browser B) | — | Auto-register → auto-join Verify-Smoke; "joined group" toast |
| 7 | Submit prediction on a group-stage game in Browser A | — | Row in `predictions`, `is_auto=false`; locks after KO |
| 8 | Champion pick — all 48 teams visible | — | `champion_pick` row; flag shown on save |
| 9 | **Top scorer pick** | **Δ1+Δ2+Δ6** | a) position filter pills work (All/Attacker/Mid/Def/GK); b) **every player has a flag** (Δ2); c) team pills uniform width with short names (Bosnia/USA/Czechia/Saudi/S. Africa/Ivory C./N. Zealand) (Δ6); d) clicking flag OR player name selects (Δ6 apiId key); e) `top_scorer_pick` row saved |
| 10 | **Register solo "verify_C"** in 2nd Chrome incognito → make champion + top scorer picks WITHOUT joining any group → return to Dashboard | **Δ4** | verify_C row appears on **global leaderboard** with **champion + top scorer columns populated** (not NULL). Before M122 these were NULL for solo users. |
| 11 | Trivia (Test Mode toggle in profile sheet — admin-only) | — | Question modal accepts answer, shows result + explanation; row in `trivia_answers` |
| 12 | iOS PWA install on Browser B + accept notif prompt at 10s | — | Row in `push_subscriptions` with iOS endpoint |
| 13 | Android PWA install on Browser C + accept notif prompt | — | Row in `push_subscriptions` with Android endpoint |
| 14 | Force trivia push (admin SQL `SELECT fn_notify_trivia();`) | — | Both Browser B + C receive notification |
| 15 | Force AI-summary push: seed `ai_summaries` row for Verify-Smoke (today, dummy text) → admin SQL `SELECT fn_notify_ai_summary_daily(current_date);` → DELETE the seeded row | — | Both devices receive 1 push (not 2 per group post-M101); url opens to `/ai-feed` |
| 16 | Forced `nightly-summary` dry-run | — | curl `-d '{"group_id":"<Verify-Smoke id>","date":"2026-05-30","dryRun":true}'` returns 200, `games_not_finished`, no DB writes |
| 17 | **Solo-user auto-predict** | **Δ5** | Admin SQL: INSERT a fake game 1 min in the future (`api_fixture_id=NULL`, `phase='friendly'`); wait 2 min for `auto-predict-{id}` cron; check `predictions` table — verify_C must have a row with `is_auto=true, group_id=NULL`. Before M123 this row would not have existed. Cleanup: DELETE the fake game + `cron.unschedule('auto-predict-{id}')` + the 2 other game crons |
| 18 | **v9 EF smoke: bootstrap mode** | **Δ3** | Admin: invoke `football-api-sync` with `{"mode":"lookup_players","items":[{"name":"Harry Kane","nationality":"England"}]}` → returns 1+ candidate(s) |
| 19 | Force admin daily digest | — | `notify-admin event=daily_digest_force` → email with all sections populated |
| 20 | SW refresh toast | **Δ6** | Bump SW_VERSION via `npm run deploy` → reload Browser A → "Refresh to latest version" toast |
| 21 | Cleanup | — | SQL: DELETE FROM auth.users WHERE email IN ('verify_a@…','verify_b@…','verify_c@…'); cascades; verify counts return to baseline (profiles=2 if you kept Itay+1) |

**End-to-end PASS** if all 21 green and step 9 specifically shows flags + uniform pills + clickable-anywhere (the visible payoff of today's PROD work).

---

## Gap actions (post-verification, NOT blockers for this plan)

| # | Gap | Owner | When |
|---|---|---|---|
| 1 | 0 KO games inserted | Itay + agent | Per Option C as matchups resolve (R32 after 2026-06-27 evening) |
| 2 | 70 unmatched + 6 pending + 11 provisional top-scorer teams | Itay (FIFA paste) + agent (api enrichment) | Phase 2 Jun 4-6 + Phase 3 Jun 7-10 per `docs/PLAN_WC2026_SQUAD_SEED.md` |
| 3 | 2 leftover champion picks + 1 top_scorer pick + 3 push subs (mine) | Itay decision | Pre-launch: keep or wipe |
| 4 | `[TEST]` trivia rows | agent | Delete on launch day morning |
| 5 | Guard `fn_notify_trivia` against empty-day pushes | agent | Apply before 2026-07-20 |
| 6 | Resend custom domain (still `onboarding@resend.dev` sandbox) | Itay | Verify domain + update `FROM_ADDRESS` in `notify-admin` EF |

---

## Go / No-Go checklist

- [ ] **§1** — Δ1+Δ2: 1051 active / 0 null flag / 0 null position / 42 teams; star strikers all present
- [ ] **§2** — Δ3: EF v9 source has 4 new modes; baseline modes intact; smoke 200 OK
- [ ] **§3** — Δ4: `get_leaderboard` + `get_group_leaderboard` contain `IS NOT DISTINCT FROM`
- [ ] **§4** — Δ5: `fn_auto_predict_game` contains solo loop + correct ON CONFLICT
- [ ] **§5** — Δ6: `__APP_VER__=36`, `SW_VERSION=36`, `Picks-BmsKiOks.js`, source has TEAM_SHORT + positionFilter + apiId key + min-width
- [ ] **§6** — Δ7: PROD data state matches "fresh" expectation; no leftover dev pollution
- [ ] **§7** — All 21 end-to-end steps green; cleanup leaves DB at baseline

---

## What we explicitly are NOT re-checking (already validated at V13)

- M1-M119 schema parity (cutover B5+V3 used pg_dump as ground truth)
- M120 prompt_versions seed (V8/P8 of cutover)
- M97/M117/M118 SECURITY DEFINER → security_invoker (already validated)
- M121 fn_notify_* use vault URL (already validated)
- 5 EFs ACTIVE inventory (already validated at V5/P5)
- 5 daily/global cron jobs presence (already validated at V6b)
- Auth dashboard settings (already validated at V6)
- Storage `feedback` bucket (already validated at V8)
- Vault secrets present (already validated at V5)
- 0 ERROR-level security advisors (validated at V13)
- All pre-V13 RLS policies (validated at V13)

If any of these regress unexpectedly, the end-to-end test (§7) will trip — that's the safety net for the "validated at V13" bucket.

---

## Files referenced (no edits — read-only)

| File | Purpose |
|---|---|
| `docs/PLAN_PROD_CUTOVER.md` | Source of the V0→V19 gates this plan deliberately does NOT re-run (only deltas) |
| `supabase/CLAUDE.md` | Migration log — confirm latest=124 + EF v9 |
| `supabase/migrations-prod/20260531000124_wc2026_official_squad_seed.sql` | Verify the flag backfill UPDATE was added before COMMIT |
| `docs/PLAN_WC2026_SQUAD_SEED.md` | Phase 2/3 sequencing for the gap actions |
| `docs/PLAN_KNOCKOUT_FIXES.md` | Option C KO insertion playbook |
| `src/pages/Picks.jsx`, `css/style.css` | §5 source-code checks |
| `supabase/functions/football-api-sync/index.ts` | §2 EF v9 source reference |
| `memory/wc2026-squad-seed.md`, `memory/dev-prod-parity-audit-2026-05-30.md` | Behavior + parity references |
