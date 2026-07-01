# PLAN — AI Summary Fact-Lock (v14: data + prompt only, no injection)

**Status:** validated on DEV replay (30 summaries, Jun 26–30). **Not yet ported to the live EF.**
**Scope:** `nightly-summary` Edge Function only — `buildGroupPayload()` (new fields) + the 5 `prompt_versions` rows. **No migration, no post-processor, no frontend, no judge change.**

## Why
A small model (gpt-4o-mini) cannot reliably *retype* facts (crowd %, scorelines, point gaps, champions) — it inverts polarity and mistypes numbers ~10–20% of the time, and no prompt wording stops it (proven across 8 variants). **Fix: compute every fact in code and hand the model ready-made, correct sentences to copy. The model still writes all the humor.**

## Validated result (DEV replay, vs the summaries that shipped)
| | C1 crowd | C2 scoreline | C3 gap | C4 champ | TOTAL |
|---|---|---|---|---|---|
| prod (live) | 38 | 9 | 22 | 1 | **70** |
| this plan (v14) | 25 | 6 | 14 | 1 | **46** |

**≈34% fewer factual errors**, every class improved, output stays natural (model's own prose — nothing injected).
Error classes: **C1** crowd inversion · **C2** wrong scoreline · **C3** rank/gap arithmetic · **C4** champion/scorer misattribution.

---

## A. DATA — new fields in `buildGroupPayload()` (additive; `input_json` is schemaless)

### Per `games[]`
```
crowd_correct        // field majority == result? (null if the field had no clear majority / split)
favorite_team        // team the field's majority backed (null if split)
result_backed_pct    // % of the field that backed the ACTUAL result
crowd_line_group     // ready sentence, this group's pool (correct polarity, incl. "split" wording)
crowd_line_global    // ready sentence, whole field
missed_by[]          // group members whose predicted OUTCOME != result
nailed_by[]          // group members whose predicted OUTCOME == result
```
Helper logic (all derivable from existing `dist_group`/`dist_global`/`result` + `predictions[]`):
- `backedPct(dist, result)` → `home_pct`/`draw_pct`/`away_pct` matching the result outcome.
- majority = argmax(home/draw/away); **split** = the top pct is tied → then `crowd_correct=null`, `favorite_team=null`.
- `crowd_line_*`:
  - split → `"the group was split (33/33/33 home/draw/away); 33% had France"`
  - majority == result → `"57% of the field backed Canada, who delivered"`
  - majority != result → `"only 26% of the field backed a draw; the field leaned toward Egypt and got it wrong"`
- `missed_by`/`nailed_by`: join `predictions[].preds[]` on `game === games[].match`, compare `pred_result` vs `result`.

### Per `leaderboard[]`
```
pts_behind_leader    // leader.total_pts - row.total_pts
gap_to_above         // points to the member exactly one rank higher (0 for the leader)
is_leader            // group_rank === 1
is_last              // group_rank === max group_rank
```

### Top-level
```
closest_pair { higher, lower, gap }   // smallest gap between consecutive-ranked members
standings                              // "Standings: Charlym 59 pts (leader) · Moran 54 (5 back) · A_I 53 (6 back) · …"
today.global_zero_count                // (today.global_zero || []).length
```

### Per `picks[]`
```
champion_status   // "not_played" | "win" | "draw" | "loss"   (not_played when champion_played_today=false)
champion_line     // "Dana's champion France drew today"  /  "…did not play today"
scorer_line       // "Omri's pick Mbappé scored 2 today"  /  "…did not score today"   (today's goals only)
```

### `p4` object (the focus decision + locked sentences)
```
p4 = {
  focus_game,               // the one game P4 is about
  angle,                    // "EXACT_FLEX" | "MOST_WRONG" | "MOST_RIGHT"
  pct_group, pct_field,     // % backing the actual result, group vs field
  group_exact_n, global_exact_n, exact_score,
  locked,                   // the ONE sanctioned crowd sentence (correct polarity)
  recap,                    // code-built per-member scoreline recap of the focus game
  members: { missed_by, nailed_by, exact_by }
}
```

---

## B. `computeP4(payload)` — deterministic focus logic

Pick **one game per summary**:
1. **EXACT_FLEX** — any game with `group_exact_n >= 3` → that game (highest `group_exact_n` if several).
2. else **most lopsided group game** = max of `max(dist_group.home_pct, draw_pct, away_pct)`.
   - top outcome **== result** → `MOST_RIGHT`
   - top outcome **!= result** → `MOST_WRONG`
   - tie-break: prefer MOST_WRONG, then larger `|pct_group − pct_field|`.

Locked sentence (polarity fixed to the real result):
```
EXACT_FLEX : "{group_exact_n} in the group nailed {exact_score} exactly in {match} — the whole field only managed {global_exact_n}."
MOST_WRONG : field right → "{100-pct_group}% of the group backed the wrong side in {match}; the field wasn't fooled — {pct_field}% had {winnerText}."
             field wrong → "{100-pct_group}% of the group got {match} wrong — but even the field mostly missed it, only {pct_field}% had {winnerText}."
MOST_RIGHT : "{pct_group}% of the group called {winnerText} in {match}, {ahead of|vs} the field's {pct_field}%."
```
`recap` = for the focus game, list every member's pick from `predictions[].preds[]`, sorted by points desc:
```
"{match}: {user} {pred}{ ' auto' if auto} ({pts}pt[s]), …"
```

> Reference implementation lives in `scratchpad/rp_enrich.cjs` (`enrichPayload` + `computeP4`), validated by the replay harness.

---

## C. PROMPT changes (all 5 `prompt_versions` kept — no deletions)

1. **Strip the old crowd machinery** from every prompt:
   - the `group_upset` × `global_upset` decision-logic bullets
   - the "Prefer a game with group_upset…", "Otherwise use the biggest mismatch…"
   - the "P4 must reference a specific number from dist_group/dist_global" mandate + its guards
2. **Replace with one P4 rule:**
   > P4 is locked — build it around `p4.locked`: copy its numbers, teams, scoreline and who-was-right exactly; add only humor around it. Personalize with `p4.members`. Make no other crowd/percentage claim. If `p4` is null, make P4 about a specific member.
3. **Fact sources (copy, never compute):**
   > For any point gap / "behind the leader", use the ready `standings` line (and `pts_behind_leader` / `gap_to_above`). For the scoreline recap of the focus game, copy `p4.recap`. For a champion use `champion_line`; for a top scorer use `scorer_line`.
4. **De-force the champion:** remove "champion MUST appear in P1/P3 — no exceptions" and "start with the champion result" (these caused wrong-member attribution). Champion referenced only via `champion_line`, bound to the correct member; never a result when `champion_status = not_played`.
5. **Bind the top scorer** to `scorer_line` (today's goals only; never a season total or tournament rank — those are null).

> Reference wording lives in `scratchpad/rp_enrich.cjs` (`SOFTEN`, `REPLACE_CROWD`, `P4_LOCK_DIRECTIVE`, `dataBlock`).

---

## D. Rollout (DEV → PROD)
1. Port `computeP4` + the new fields into the deployed DEV `nightly-summary` EF's `buildGroupPayload` (get the live EF body first — repo files are not the source of truth).
2. Apply the C edits to the 5 DEV `prompt_versions` rows.
3. Re-run the replay harness once against **live DEV generation** (not just the offline replay) to confirm ≈46/30.
4. Promote EF + prompt rows to PROD; watch the next nightly run.

## E. Testing
- **Replay harness** (`scratchpad/rp_*.cjs`) = the regression test: enrich stored `input_json` → generate on DEV → audit → compare error counts. Re-runnable on any date range.
- **Unit-test `computeP4`**: correct angle + polarity for known games; `recap` matches the prediction data.
- Optional monitoring: store `p4.angle` in `display_data` to see the focus-game distribution over time.

## F. Deferred (not in this plan)
- **Injection/scrub post-processor** (gets to ~29 errors but reads mechanical — rejected for naturalness).
- **Slot/placeholder generation** (model writes prose with `{{fact}}` tokens code fills) — the path if you later want both maximal correctness *and* natural voice.
- Judge unchanged; residual C2 = scorelines the model drops inside prose jokes; residual C3 = zero-count/"only one" quantifier phrasing.

## Scope / honesty
All experiments ran on **DEV**; **PROD was never written to**. Dev scratch table dropped. Dev replay/audit EFs (`nightly-summary-replay`, `nightly-summary-audit`) are harmless and can be deleted when done.
