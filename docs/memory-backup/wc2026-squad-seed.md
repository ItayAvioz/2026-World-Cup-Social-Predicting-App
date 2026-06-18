---
name: wc2026-squad-seed
description: WC2026 top-scorer-candidates seed strategy + state. Source of truth = data/wc2026_squads.json. PROD DB = JSON 1:1 after M128 (2026-06-02). 1278 active across 48 teams. 66 placeholder_lineup_pending entries with negative api_player_id resolve via post-game lineup sync per docs/PLAN_LINEUP_VERIFICATION.md.
metadata: 
  node_type: memory
  type: project
  originSessionId: 213a6a40-7934-481f-8922-53d4461a0e0b
---

# WC2026 Top-Scorer-Candidates Seed

## ✅ FINALIZED + FIFA-VERIFIED (2026-06-07)

All 48 teams trimmed/finalized to **exactly 26 active** (1,248 total active) in PROD `top_scorer_candidates`, reconciled to official squads (user-pasted lists + web checks for Sweden & Egypt). Cross-checked against the **official FIFA PDF** (`fdp.fifa.org/assetspublic/ce281/pdf/SquadLists-English.pdf`, Version 1, 6 Jun 2026): after 2 fixes (Bosnia 3rd GK Osman Hadzikić→**Mladen Jurkas**; Czech typo Stanrk→Stanek) **all 48 teams match FIFA 26/26**.
- All 1,248 have correct **full-name positions** (Goalkeeper/Defender/Midfielder/Attacker) — see [[topscorer-position-format]].
- **60 placeholders** remain = negative `api_player_id` (real id not found; name/team/position correct). 8 are forwards (scoring-relevant, e.g. Saudi **Salem Al Dawsari**, Egypt Hamza Abdulkarim, Ghana Brandon Thomas-Asante). Resolve post-game via [[lineup-resolve-runbook]].
- Finalization done via direct `execute_sql` `is_active` toggles/inserts (DML, not migrations).
- **`data/wc2026_squads.json` regenerated from the DB** via new **`scripts/regen-squads-json.cjs`** (anon key, paginates the 1000-row cap, full-name positions). JSON now == DB 1:1; re-run the script after any DB squad change. This closed the staleness + short-code risk noted in [[topscorer-position-format]].

## 🔧 Lineup-resolution pass (2026-06-17) — placeholders 60→48, 27 id fixes

Verified ALL active candidate ids vs real match data (`game_player_stats`, 42 teams played). On the active 26-man squads of played teams (1,092): SAME 994 / COMPLETE 23 / MISMATCH 18 / unconfirmable 57.
- **Applied 27 safe fixes** (12 placeholder completions + 15 mismatch corrections), e.g. Lautaro Martínez 6000→217, Frenkie de Jong 37524→538, Bernardo Silva 119612→636, Almoez Ali 534032→2543, Mikel Merino -73→47311. Verified: SAME 994→**1021**, placeholders (incl. inactive) 74→**62**, active-JSON placeholders **48**, dup_ids 0.
- **⚠️ 14 NOT applied — UNIQUE(api_player_id) collisions = the seed has DUPLICATE entries** (same player, two spellings: "Ehsan Hajsafi"/"E. Hajisafi", "Ahmed Fatouh"/"Ahmed Abou El Fotouh", "Abdallah Nasib"/"Abdallah Naseeb", etc.) AND **tangled ids** ("Eric Garcia" holds Joan García's 182718; "Abdullah Al Salem" holds Salem Al-Dawsari's 44340; "Mohanad Ali" holds Hussein Ali's 145465; Brazil "Danilo Santos" holds Danilo's 618). Need manual dedup/paired-swap — deferred. **NEW: the active 26-man squads contain duplicate-player rows under variant spellings.**
- **57 unconfirmable** = players not in any lineup yet (real ids likely fine: Neymar 276, Darwin Núñez 51617, Ronald Araújo 101814, Gavi 1697) + placeholders whose teams/players haven't appeared. Resolve once they play.
- **Zero scoring impact** — no *picked* player had a bad id (picks store own `top_scorer_api_id`, scored vs `game_player_stats`).
- JSON regenerated (placeholders 60→48). Logged in docs/MANUAL_DATA_CORRECTIONS.md. Method = match by api_player_id first, then full-name accent-stripped; UNIQUE collision guard.

## 🔧 Verification pass #2 (2026-06-18) — end of round 1, all 48 teams played; placeholders 48→33

Re-audited all 1248 active ids vs `game_player_stats` ground truth. **SAME 1162 / COMPLETABLE 18 / MISMATCH 6 / UNCONFIRMABLE 62.** Applied **24 id changes** (incl. the 14 collisions DEFERRED in pass #1 — now resolved). **Key technique: park the colliding duplicate/holder on a fresh negative (−101..−118) — NEVER delete inactive rows (user rule).** 0 dup ids after; 0 pick cascades (no `top_scorer_pick` referenced any affected name → zero scoring impact, as always — picks store own `top_scorer_api_id`, scored vs game_player_stats).
- **17 of 18 completable done** (2 free-id + 11 inactive-twin + 4 tangle incl. Iraq Hussein Ali 145465 / Mohanad Ali→154767, Brazil Danilo→618, Panama Jose Luis→2979, Spain Joan Garcia→182718). Tangle = real id belonged to a DIFFERENT teammate who wrongly held it; displaced twin parked active+pending.
- **Group B applied**: Azizbek Ganiev −60→73520 (match name "Azizjon Ganiev" — treated as seed typo / same player per user OK).
- **6 mismatches corrected**: Cristian Martínez 50911, Farrukh Sayfiev 53830, Alejandro Zendejas 35885 ("Alex Zendejas"), Danley Jean Jacques 338367, Zaid Ismail 626479, El Hadji Malick Diouf 409303.
- **STILL PENDING (3, real id unknown — parked active −112/−113/−114)**: Brazil "Danilo Santos" (MF; 618 was the captain Danilo), Panama "Tomas Rodriguez" (2979 was José Luis), Spain "Eric Garcia" (182718 was GK Joan García). Their own id isn't in match data yet → resolve when they play / via club lookup.
- JSON regenerated via `scripts/regen-squads-json.cjs` → 48 teams / 1248 / **33 placeholders**. Logged in docs/MANUAL_DATA_CORRECTIONS.md (pass #2). Pass #1 (2026-06-17) had deferred these 14 collisions; pass #2 cleared them.

## State (2026-06-02 post-M128) — superseded by the 2026-06-07 finalization above

**JSON state** (`data/wc2026_squads.json`):
- 48 teams populated (37 announced + 11 provisional, 0 pending)
- 1,278 player entries total
- 1,212 with real positive `api_player_id` (94.8%)
- 66 with negative placeholder ids (-19 to -84): 47 originally-null entries + 19 same-team-duplicate-id losers from FW>MF/DF>GK dedup rule
- 0 nulls — EVERY player is now insertable into DB

**PROD DB** (`top_scorer_candidates`, M128 sync at 2026-06-02):
- 1,278 active rows = 1:1 JSON match
- 340 inactive (M124 preliminary cuts + M128 new deactivations)
- 48 teams (0 missing)
- 0 NULL flag_codes

## id_verification breakdown (per `[[lineup-resolve-runbook]]`)

| Status | JSON | DB | Confidence |
|---|---|---|---|
| fully_verified | 1,005 | 1,005 | ★★★★★ |
| squad_missing_name_ok | 111 | 111 | ★★★★ |
| placeholder_lineup_pending | 66 | 66 | ☆☆☆ (resolves post-game) |
| squad_ok_name_suspect | 41 | 41 | ★★★ |
| club_match | 21 | 21 | ★★★★★ |
| squad_missing_name_flagged | 17 | 17 | ★★ |
| squad_ok_name_mismatch | 12 | 12 | ★★★★ |
| lookup_match | 5 | 5 | ★★★ |

## Timeline

1. **M124 seed (2026-05-31)**: 42 teams from JSON → 1,051 active.
2. **Phase 1 (2026-06-01)**: 5 missing teams added (Algeria/Australia/Ecuador/Mexico/Uruguay) → 1,140 entries, 1,051+ active.
3. **Phase 2 (2026-06-01)**: Paraguay added (the 6th missing) → 1,206 active. 1 placeholder (-19 Gamarra).
4. **Phase 3 (2026-06-02 today, M128)**: 
   - FIFA final squads pasted for all 48 teams via 6 batches → 4 teams had real diffs (Canada cut Flores, Czech cut 3 provisional, Ghana swap+renames, Iran 30→26+renames+swap, Iraq 34→26, S.Korea swap, Saudi rename, Scotland swap)
   - `lookup_players` EF → 5 high-confidence positive ids
   - `probe_wc_team` v13 (NEW: accepts past `season` param) → 21 club_match resolves for famous players via club rosters (Brighton 2024 for Pascal Groß, Arsenal for Ødegaard, etc.)
   - Remaining 47 nulls → assigned negative placeholders -20..-65 (Gamarra kept -19)
   - 19 duplicate api_id pairs detected in JSON → loser of FW>MF/DF>GK rule gets fresh placeholder -66..-84
   - M128 applied via temp staging + UPDATE/INSERT/DEACTIVATE/flag-backfill

## ⚠️ position format: JSON = short codes, DB MUST = full names

`data/wc2026_squads.json` stores `position` as FIFA short codes (`GK/DF/MF/FW`). The DB column `top_scorer_candidates.position` MUST hold api-football **full names** (`Goalkeeper/Defender/Midfielder/Attacker`) because `Picks.jsx` filters by exact full-name match. **M128 forgot to normalize on import** → mixed column → Picks position filter broke (fixed PROD 2026-06-07). Any future JSON re-sync MUST run the normalize step last: `MF→Midfielder, DF→Defender, FW→Attacker, GK→Goalkeeper`. Full detail in [[topscorer-position-format]].

## Negative placeholder map (resolve post-game)

See `docs/PLAN_LINEUP_VERIFICATION.md` for the full table. Key examples:
- **-19**: Paraguay Alejandro Gamarra
- **-20..-29**: Bosnia Celik, Canada Alfie Jones, Curaçao Bodack, Egypt 3, Ghana 2, Iran Eiri
- **-30..-39**: Iran Hajsafi/Kanaani, Iraq Younis/Saadoon, Jordan 6
- **-40..-49**: Morocco El Kajoui, Qatar 6, Saudi 2, Scotland Tyler Fletcher
- **-50..-65**: S.Africa, S.Korea 2, Tunisia 3, Türkiye 2, Uzbekistan 8
- **-66..-84**: dedup losers (Brazil Danilo DF, Portugal Ruben Dias, Argentina Lisandro Martinez, Spain Joan Garcia + Marc Pubill + Mikel Merino, etc.)

## Resolution mechanic

`game_player_stats` table (populated by `writeStats()` in `football-api-sync` after every game) has `api_player_id` + `player_name` + `team` for every player who got any minute (starters + subs). After each game:

1. SELECT candidates where `api_player_id < 0` AND `team_name` matches a row in `game_player_stats` AND name token-overlap matches → review.
2. UPDATE candidates to real positive id (set `id_verification='lineup_resolved'`).
3. CASCADE: UPDATE `top_scorer_pick.top_scorer_api_id` for users who picked that candidate.

Backstop: `fn_award_top_scorer_points` runs after final (~2026-07-19); reads `player_tournament_stats` aggregated by real `api_player_id`. So unresolved placeholders only fail if (a) the picked player actually scores AND (b) cascade never ran.

Daily safety query (run during tournament) in `docs/PLAN_LINEUP_VERIFICATION.md`.

## EF probe_wc_team v13 (NEW)

`football-api-sync` v13 (PROD only, deployed 2026-06-02). `probe_wc_team` accepts optional `season` body param (default WC_SEASON=2026). Enables resolving WC2026 players via their CLUB roster in a PAST season — invaluable for famous players who aren't reachable via `/players/profiles?search=` (api index gaps for Ødegaard, Çakır, Groß, Williams, etc.).

Example call:
```
POST /functions/v1/football-api-sync
{"mode": "probe_wc_team", "api_team_id": 51, "season": 2024}
```

Returns all players in Brighton 2024 season — search by surname to find Pascal Groß (18970) or Ferdi Kadıoğlu (1361).

## Backfill safety net during tournament (unchanged from before)

`top_scorer_pick.top_scorer_api_id` may have negative placeholders for picks where users selected players not yet resolved. Daily SQL during tournament:

```sql
UPDATE top_scorer_pick tsp SET top_scorer_api_id = gps.api_player_id
FROM (SELECT DISTINCT api_player_id, player_name FROM game_player_stats WHERE goals > 0) gps
WHERE tsp.top_scorer_api_id < 0 AND lower(tsp.player_name) = lower(gps.player_name);
```

Run before the final.

## Files

- Source of truth: `data/wc2026_squads.json` (1278 rows, 0 nulls)
- Migration: `supabase/migrations-prod/20260602000128_sync_squads_to_json.sql`
- Plan: `docs/PLAN_LINEUP_VERIFICATION.md`
- Runbook: `[[lineup-resolve-runbook]]`
- EF source: `supabase/functions/football-api-sync/index.ts` (PROD v13)
