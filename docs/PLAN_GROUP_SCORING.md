# PLAN — Per-Group Captain Scoring (DEV ONLY)

**Status: ✅ IMPLEMENTED + VERIFIED on DEV 2026-07-19 (branch `feature/group-scoring`, M141–M146). PROD untouched. Feature inert until a captain locks a config.**

## Concept

Each private group is its own competition. The captain configures how points are calculated inside that group; the Global Leaderboard always uses canonical System rules. Prediction result and scoring value are separate concepts: correctness is determined once, then each leaderboard context applies its own rules.

| Component | Options |
|---|---|
| Group-stage matches | System (1/3) · Odds · Custom (X/Y) |
| Knockout matches | System · Odds · Custom — configured separately + result basis 90min (default) / include-ET |
| Champion | System (10) · Odds · Custom |
| Top scorer | System (10) · Custom (no odds source exists) |
| Trivia | Include yes/no + immediate / tournament-finish |
| Road to Final | Include yes/no + immediate / tournament-finish |

Rules: one match mode controls both W/D/L and Exact (no mixing). Exact is **non-additive** in every mode. Odds mode: correct W/D/L = snapshot odds of the predicted outcome; exact = those odds × captain multiplier. Penalties never affect match scoring. Locked odds snapshots (per prediction / champion pick) make later market moves irrelevant.

## Key decisions (locked during planning)

1. **Lock-on-confirm** (not "tournament start" — moot for 2026): captain edits freely, Step-5 Confirm sets `locked_at`; config only affects the leaderboard once LOCKED. Server-enforced (`config_locked`).
2. **Odds-unavailable → System fallback per pick** (`odds_source='unavailable'` or NULL snapshot → 3/1 for that pick). Explicit, never silent miscalculation.
3. **`phase IN ('group','friendly')` = group-stage bucket** — friendlies are deliberate DEV test data driving the leaderboard (dev-data-scope-decision).
4. **Existing groups / no config / unlocked config / all-System config → previous SQL verbatim** (fast path). Regression-gated byte-identical.
5. **Engine branch lives INSIDE `get_group_leaderboard`** — Groups.jsx, `get_dashboard_payload`'s LATERAL, and the ask EF (6 call sites) all get it for free. `get_leaderboard` (global) untouched — zero `src/` callers, 3 global-scope backend consumers.
6. **DEV stays externally silent**: odds kick gated by `app_flags.odds_kick_enabled=false`; recurring odds crons NOT registered (function edits only — reviving `af-odds-daily` is a PROD-scoped decision, see disable_noisy_dev_crons + dev-env-silenced-during-prod).
7. **v1 scope cuts (documented divergence)**: `get_group_summary_data` (AI summaries), Game.jsx pointsLabel/memberBadge ('3 pts'/'1 pt' hardcoded), AiFeed day standings stay System-labeled for custom groups. HowToPlay got a captain-may-customize caveat.

## What was built

**DB (M141–M146, all via apply_migration, local files in supabase/migrations/):**
- `group_scoring_config` + `app_flags` tables (M141) — members-SELECT RLS, zero client writes
- Odds snapshot columns on predictions/champion_pick (M142) — nullable, no write grants
- Guarded stamp triggers (M143) — INSERT stamps; UPDATE re-stamps only on genuine pick change (anti odds-chasing + immune to bulk points UPDATEs); exception-safe
- Odds pipeline plumbing (M144) — debounced flag-gated kick fn, INSERT-trigger wiring, api_fixture_id backfill/correction trigger, 4h cadence edit (dormant), top-up fn
- `save_group_scoring_config` RPC (M145) — captain-only, full §18 validation, lock-on-confirm
- `fn_group_custom_scores` engine + `get_group_leaderboard` DROP+CREATE with numeric totals + fast/custom branch (M146)

**Frontend (`src/features/group-scoring/`):**
- `constants.js` — `GROUP_SCORING_DEV` kill-switch (KO_PREDICT_DEV pattern) + `isTestMode()` gate (wc2026_test_mode, admin)
- `format.js` — `fmtPts` (integers clean, decimals 2dp)
- `ScoringRulesModal.jsx` — 5-step captain wizard (Group Stage → Knockout → Picks → Extras → Confirm&Lock) with soft warnings (exact<W/D/L, multiplier>10); read-only Rules view for members/locked
- Groups.jsx: `⚙️ Scoring`/`📊 Rules` button in grp-card-actions (gated GROUP_SCORING_DEV && isTestMode()), fmtPts at Pts cell + share string, modal mount with cache.invalidate()
- HowToPlay caveat line; `gs-*` CSS block in css/style.css

## Verification (all on DEV, 2026-07-19)

**19/19 green.** Regression gate: `get_group_leaderboard` for all 15 groups (41 rows) + `get_leaderboard` (45 rows) snapshot-compared pre/post M146 — **0 diffs**. T2 stamp semantics (insert/no-op/change/bulk-points/no-odds/champion via service-role — champion write path is RLS-closed this cycle, service-role test was the only way). T3 RPC guards (not_captain/invalid_mode/invalid_custom_points/config_locked) + unlocked→fast-path + Custom oracle. T4 Odds oracle over 282 synthetically-backfilled snapshots (friendly+group games with real game_odds). T5 ET-basis + immediate trivia/bracket oracle. T6 kick flag-gate/debounce/backfill-trigger. T7 full cleanup + restore — final state: 0 configs, 0 odds cron jobs, flag off, snapshots cleared, synthetic games+crons removed, totals match baseline.

Note: test oracles are computed at runtime from the DB (dirty-DEV rule — never hardcode real-WC expectations; gates flip Jul 20/21 so stored baselines drift).

## Still open / next steps

- **UI e2e on gh-pages** (localhost has no auth): enable wc2026_test_mode as admin, run the wizard end-to-end, verify decimals render.
- **PROD promotion (future tournament)**: run the odds/cron census on PROD first (never checked); apply M141–M146; decide `af-odds-daily` revival (4h) + `champion-odds-daily` (external hook expired 2026-06-11); flip `odds_kick_enabled`; widen UI gate beyond testMode.
- **Odds-mode data reality**: DEV has odds for 12/13 friendlies + 53/136 group games, 0 knockout; snapshots exist only for predictions made after M143. Historical picks scored under Odds fall back to System.
- Scope-cut follow-ups if wanted: per-group point labels on Game.jsx/AiFeed, custom scoring in AI summaries (`get_group_summary_data` — note its rank has a username tiebreaker, deliberate divergence).
- Optional cleanup: DROP dead `fn_schedule_odds_sync()` (stale 400-ing contract, name collision hazard).
