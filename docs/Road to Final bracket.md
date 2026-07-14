# Plan — Knockout-Stage Team Prediction Game (DEV-only, isolated feature)

## Context
The "Road to Final" bracket (display) is live for all users. We add a **team-prediction game** on top of it: each user predicts **which teams reach the Quarterfinals, Semifinals, Final, and the 3rd/4th match** — **teams only, no scorelines**. Scoring: **2 pts per correct team**, plus an all-correct bonus per round (**QF +12, SF +8, Final +5, 3rd/4th +4**). The user sees their live score inside the bracket modal as rounds resolve, but the points only fold into the **leaderboard on 20 Jul 10:00 IDT**.

**The existing per-game SCORE prediction is unchanged** — it stays where it is (Dashboard / Groups / upcoming / Game page). This new feature is separate and additive.

**This build is DEV-only and local:** new code in an isolated feature folder; DB changes to the **DEV Supabase project only** (`ftryuvfdihmhlzvbpfeu`); tested via local `npm run preview`. **No prod, no gh-pages deploy, no SW bump** until separately approved.

## Locked decisions
- **Teams only**, no scores.
- **Global picks** (one set per user; added to every leaderboard row — like trivia).
- **Predict UI = inside the Road to Final modal** via a Results/Predict toggle (tap-through bracket). Existing score-prediction flow untouched.
- **Lock (entry closes):** `2026-07-04T09:00:00Z` (R32 end + 5h). Hardcoded constant.
- **Leaderboard inclusion gate:** `2026-07-20T07:00:00Z` (10:00 IDT).
- **No auto-assign**; no pick = 0.

## Patterns reused (learned from trivia / champion / top-scorer — to memorise)
- **Trivia security model = the template** (cleanest, lowest risk): `trivia_answers` grants `authenticated` **SELECT only**; **all writes go through a SECURITY DEFINER RPC** (`submit_trivia_answer`) that sets points server-side. There is **no client write path and no client-writable points column** → the M130 exploit class is structurally impossible. We copy this exactly.
- **Trivia leaderboard gating** (`get_leaderboard` + `get_group_leaderboard`): a `CASE WHEN <flag> THEN SUM(...) ELSE 0 END` term added **per user, no group join** (global). We clone it, swapping the `is_over` flag for a **date** gate.
- **Champion/top-scorer**: RLS deadline pattern (`now() < '<ts>'`), `points_earned` is **server-only** (set by trigger; M130 locked the column). We avoid a points column entirely by computing on read.
- **M132**: read-only/data tables have `authenticated` writes revoked; only service_role + SECURITY DEFINER fns write. `knockout_pick` joins this club (RPC-only writes).
- **M135 safeupdate**: any server-side bulk `UPDATE`/`DELETE` must have a `WHERE` (EF `authenticator` runs with safeupdate) — the RPC's row-replace must be `WHERE user_id = v_uid`.

## Backend — DEV project only (`ftryuvfdihmhlzvbpfeu`), via `apply_migration`
**1. Table `knockout_pick`** (global, no points column):
```
id uuid pk default gen_random_uuid(),
user_id uuid not null references profiles(id) on delete cascade,
round text not null check (round in ('qf','sf','final','third')),
team text not null,
created_at timestamptz default now(),
updated_at timestamptz default now(),
unique(user_id, round, team)
```
- **FK target = `profiles(id)` ONLY** (the trivia precedent). Do NOT also add the `auth.users` FK that `champion_pick` accreted. Leaderboard joins on `profiles`.

**2. RLS + grants (trivia model) — AGENT-VERIFIED, the `authenticated` REVOKE is LOAD-BEARING.**
> Agent confirmed via live `pg_default_acl`: a newly-created public table still grants `authenticated = arwdDxtm` (full writes) by default — **M131 only revoked the `anon` defaults, not `authenticated`**. So without the explicit revoke, a logged-in user could `POST`/`DELETE` `knockout_pick` directly via PostgREST, **bypassing the RPC's lock + validation** and inserting all teams in every round to force max points (same class as M130). This REVOKE is what makes the "RPC-only write" model real.

Exact statements (verified against the live `trivia_answers` grants, which are `authenticated = SELECT only`):
```sql
ALTER TABLE public.knockout_pick ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.knockout_pick FROM anon, authenticated;
GRANT SELECT ON public.knockout_pick TO authenticated;
GRANT ALL    ON public.knockout_pick TO service_role;
CREATE POLICY "knockout_pick: select own" ON public.knockout_pick
  FOR SELECT USING (user_id = auth.uid());
-- NO insert/update/delete policy — all writes go through the DEFINER RPC
REVOKE ALL ON FUNCTION public.save_knockout_picks(text[],text[],text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_knockout_picks(text[],text[],text[],text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_knockout_points(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_knockout_points(uuid) TO authenticated;
```
authenticated-only EXECUTE (no anon/PUBLIC) is correct — anon has no `auth.uid()` and the RPC rejects it anyway.
**3. Writer RPC `save_knockout_picks(p_qf text[], p_sf text[], p_final text[], p_third text[]) RETURNS jsonb`** — SECURITY DEFINER, the **only** writer:
- `auth.uid()` not null; else `not_authenticated`.
- `now() < TIMESTAMPTZ '2026-07-04T09:00:00Z'`; else `predictions_locked`.
- Validate sizes (`≤8 / ≤4 / ≤2 / ≤2`) and that every team exists in `teams.name` (and is among the current 16 R16 teams — derive from `games` qf/r16 feed); else `invalid_pick`.
- Replace atomically: `DELETE FROM knockout_pick WHERE user_id = v_uid;` then `INSERT` one row per (round, team). Return the saved sets.
- `GRANT EXECUTE TO authenticated`.
**4. Scoring read fn `fn_knockout_points(p_user uuid) RETURNS int`** — SQL, STABLE, SECURITY DEFINER, tree-free:
- Actual round teams from `games` (qf/sf/final/third `team_home`/`team_away`, exclude `'TBD'`).
- Per round: `hits = |pred ∩ actual|`; `pts += 2*hits`; `if hits = ROUND_SIZE then pts += BONUS` (`qf 8/+12, sf 4/+8, final 2/+5, third 2/+4`).
- No picks → 0. `GRANT EXECUTE TO authenticated` (used by leaderboard; also lets the client cross-check, though the live UI score is computed client-side).
**5. Leaderboard term** — add to `get_leaderboard` (`scores` CTE) and `get_group_leaderboard` (**both** `group_scores` and `all_group_scores`), cloning the trivia CASE:
```sql
+ CASE WHEN now() >= TIMESTAMPTZ '2026-07-20T07:00:00Z'
       THEN COALESCE(public.fn_knockout_points(p.id), 0) ELSE 0 END
```
Edit minimally: dump live body with `pg_get_functiondef` first, add only this term (M129/M135 workflow rule). `get_dashboard_payload` + nightly-summary EF call these RPCs → inherit automatically. **Agent-verified: these are the only two total-points sum-sites** (`get_dashboard_payload`'s own `points_earned` use is per-prediction display, not a total; `get_group_summary_data` excludes trivia/knockout by design and is moot post-reveal).

> ⚠️ **ALIAS TRAP (agent-flagged):** `get_leaderboard.scores` uses alias **`p`**; `get_group_leaderboard` has TWO CTEs — `group_scores` (alias **`p`**) and `all_group_scores` (alias **`p2`**). The knockout term must use `fn_knockout_points(p.id)` in `group_scores` but **`fn_knockout_points(p2.id)`** in `all_group_scores` — blindly copy-pasting `p.id` into both silently breaks the global-rank CTE. The existing trivia term already varies the alias the same way — match it.
> **Gate divergence (intentional):** trivia is gated by `tournament_ended` (final winner set); knockout uses the hardcoded date `2026-07-20T07:00:00Z`. Final is ~Jul 19 so they coincide, but do NOT "align" them by accident. In `get_group_leaderboard` (plpgsql) inline `now() >= TIMESTAMPTZ '...'` or add a `DECLARE` var beside `v_tournament_over`.
> **Hot-path safe:** before the gate, `CASE WHEN false` short-circuits and `fn_knockout_points` is **never evaluated** → zero pre-reveal overhead, byte-identical output (verification C).

## Frontend — new isolated folder `src/features/knockout-prediction/`
- `constants.js` — `KO_PREDICT_LOCK`, `KO_REVEAL`, `ROUND_BONUS`, `ROUND_SIZE`.
- `bracketTree.js` — extract the shared bracket structure currently inline in `Picks.jsx` (`LEFT_COLS`, `RIGHT_COLS`, `BRACKET_CHILDREN`, `NODES_BY_PHASE`, `R32_SLOTS`, `PHASE_LABEL`). `Picks.jsx` imports from here (pure move, no behavior change) so display + prediction share one source.
- `useKnockoutPrediction.js` — hook: `SELECT` own rows from `knockout_pick` (RLS own); hold tap state (predicted winner per node); `setPick(node, team)` with **cascade-clear** of dependent downstream picks; derive the 4 round-arrays; `save()` calls `save_knockout_picks` RPC; `locked = now >= KO_PREDICT_LOCK`.
- `reconstruct.js` — rebuild tap state from saved round-arrays using the actual R16 matchups + tree (resume on reopen).
- `scoring.js` — pure client mirror of `fn_knockout_points` for the live "your score" line (display only).
- `KnockoutPredict.jsx` — the predict-mode panel rendered inside the modal: tappable nodes (your pick highlighted), reuse existing flag rendering, lock/read-only state, live score line, Save button + toast.

**`src/pages/Picks.jsx` changes (minimal):** import bracket consts from `bracketTree.js`; add a **Results / Predict toggle** in the modal header; render `<KnockoutPredict>` in Predict mode. Display path and the entire score-prediction flow are untouched.

## Verification (DEV + local only)
**A. Scoring fn `fn_knockout_points` (DEV `execute_sql`):** seed a throwaway user's `knockout_pick` rows; with manually-seeded qf/sf/final/third `games` rows on DEV assert: each correct team = 2; bonus fires only at full-correct count; partial round = hits only; wrong/absent = 0; no-pick user = 0; max all-correct = 65.
**B. Security / RLS / RPC (DEV adversarial `DO`-block, the M131 pattern):**
- `authenticated` user A: SELECT returns only own rows, never B's.
- **Direct table writes BLOCKED** for `authenticated` (no INSERT/UPDATE/DELETE grant) — `has_table_privilege('authenticated','knockout_pick','INSERT')` = false.
- `save_knockout_picks` as A: succeeds before lock; **`predictions_locked`** when lock simulated in past; rejects oversized arrays / unknown teams (`invalid_pick`); writes only A's rows.
- `anon`: SELECT + execute blocked.
**C. Leaderboard gate (DEV):** run both RPCs with a temporarily-past gate → knockout points appear, math correct on group_rank + global_rank; with the real future gate → output **byte-identical** to pre-migration (md5 the result set). Confirm `get_dashboard_payload` inherits.
**D. Frontend (local `npm run preview` → DEV, Playwright, throwaway login):** open Road to Final → Predict toggle → tap through R16→Final; change an early pick → confirm **cascade-clear**; Save → reload → confirm **resume** restores taps (reconstruct); confirm **read-only after lock** (simulate); seed KO results on DEV → confirm live "your score" matches `fn_knockout_points`; confirm the existing **score-prediction flow still works unchanged**.

## Risks
1. **Hot leaderboard RPCs** (Dashboard/Groups/AI summary/dashboard payload read them) — added term must be additive + date-gated to 0 pre-July-20. Mitigate: clone proven trivia CASE, dump-then-minimal-edit, byte-diff, rollback DO-block. DEV-only here.
2. **Interactive cascade bracket** — cascade-clear + resume-reconstruct are the bug-prone bits; isolated in the feature folder + Playwright-tested.
3. **Short overnight window** (~5h; R16 teams known ~03:30 UTC, lock 09:00 UTC) → low participation. Accepted; flagged.
4. **Global points on every group row** (user in N groups → points on N rows) — intended (as trivia); verify on the global board.
5. **Extracting shared bracket consts** touches `Picks.jsx` — keep a pure move; re-verify the display bracket renders after extraction.
6. **Hardcoded lock constant** could drift if the api reschedules the last R32 game — acceptable for DEV; revisit before any prod promotion.

## Out of scope
- No prod DB changes, no gh-pages deploy, no SW bump. DEV + local only.
- No score predictions in this feature; the existing score-prediction flow is untouched.
- No auto-assign, no champion-winner prediction, no connector-line animations.

## Phasing
- **Phase A — backend on DEV:** table + RLS/grants + `save_knockout_picks` RPC + `fn_knockout_points` + gated leaderboard term; run verification A/B/C in isolation (no UI).
- **Phase B — frontend:** feature folder + `Picks.jsx` toggle; run verification D locally against DEV.

## Memory to write (at execution start)
- New `knockout-prediction-game.md` — feature design, trivia-model security (RPC-only writes, no points column), lock/reveal constants, scoring, DEV-only status; link `[[road-to-final-bracket]]`, `[[predictions-points-earned-exploit]]`, `[[trivia-feature]]`.
- Append to memory the reusable lesson: **"global, server-scored, leaderboard-gated points = clone the trivia pattern (SELECT-only table + SECURITY DEFINER writer RPC + date/flag-gated CASE in the 2 leaderboard RPCs)."**
