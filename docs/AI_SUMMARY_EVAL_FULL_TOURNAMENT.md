# AI Summary Evaluation — Full Tournament (Jun 11 → Jul 5, 2026)

Machine-graded fact-check of **150 nightly roast summaries** vs `input_json` ground truth, by 6 parallel auditor agents under one rubric. Target: measure the **fact-lock fix** and validate the **evaluation method**.

- **Before-fix** (old system): Jun 11–30, **120 summaries**
- **After-fix** (fact-lock live): Jul 1–5, **30 summaries**
- Cutover: date ≤ 06-30 = before, ≥ 07-01 = after.

## Rubric & scoring
- **C1** crowd polarity/framing · **C2** scoreline/recap · **C3** rank/gap · **C4** champion/scorer
- **S3** major (fabricated fact) · **S2** moderate (number right, meaning flipped) · **S1** minor (no false fact)
- `score = max(0, 100 − 25·S3 − 10·S2 − 3·S1)` → **A≥90 B≥75 C≥60 D≥40 F<40**

---

## 1. Headline — Before vs After

| Metric (per summary) | Before (120) | After (30) | Δ |
|---|---|---|---|
| **Mean score** | **84.9** | **92.2** | **+7.3** |
| Errors / summary | 1.38 | 0.77 | −44% |
| S3 (fabrication) / summary | 0.19 | 0.10 | −47% |
| S2 (meaning-flip) / summary | 0.98 | 0.47 | −52% |
| Clean-summary rate | 16.7% | 37% | ×2.2 |
| A-grade rate | 65% | 83% | +18pt |

### ⚠️ Confound — games per day
Before spans the **group stage (2–4 games/day)**; after is **knockouts (1–2 games/day)**. Recap-misattribution and crowd-surface errors scale with games/day, so part of the gain is fewer games, not the fix. **Cadence-matched estimate** (compare the most similar window):

| Window (≈2 games/day) | Mean score |
|---|---|
| Jun 28–30 (before, late) | 90.2 |
| Jul 1–5 (after) | 92.2 |

→ **Marginal fix effect ≈ +2 pts** once cadence is controlled — plus the structural wins below that are cadence-independent.

## 2. Score trend by segment (shows the confound + the fix)

| Segment | n | Mean score | Errors | S3 | Clean |
|---|---|---|---|---|---|
| Jun 11–16 (before) | 36 | 82.4 | 47 | 16 | 9 |
| Jun 17–22 (before) | 36 | 86.9 | 49 | 3 | 2 |
| Jun 23–27 (before) | 30 | 82.5 | 53 | 2 | 2 |
| Jun 28–30 (before) | 18 | 90.2 | 16 | 2 | 7 |
| **Jul 1–5 (AFTER)** | **30** | **92.2** | **23** | **3** | **11** |

## 3. Error class breakdown — where the fix worked and didn't

| Class | Before /summ | After /summ | Δ | Verdict |
|---|---|---|---|---|
| **C1 crowd** | 0.67 (80: 0/69/11) | 0.33 (10: 1/9/0) | −51% | ✅ halved, but **still #1 residual** |
| **C2 recap/scoreline** | 0.375 (45: **19·S3**/19/7) | 0.20 (6: 0·S3/3/3) | −47% | ✅✅ **recap-S3 catastrophe eliminated** |
| **C3 rank/gap** | 0.29 (35: 0/29/6) | 0.13 (4: 0/1/3) | −55% | ✅✅ **arithmetic ~solved** |
| **C4 champion** | 0.042 (5: **4·S3**/1/0) | 0.10 (3: **2·S3**/1/0) | +138% | ❌ **not solved, intermittent both eras** |

### What the fix provably delivered (cadence-independent — facts now code-built)
- **C2 recap misattribution: 19 S3 → 0.** Before, multi-game days routinely stapled a member's *other-game* pick under the wrong header (worst: Afula_Gang 06-15 scored **0** with 4/6 recap lines wrong; Crows 06-13; Afula_Squad 06-26 phantom exact). Code-built `p4.recap` made this near-impossible.
- **C3 arithmetic: 29 S2 → 1.** "Who's 2nd / N-behind / tied" errors were rampant before; the code `standings` line fixed them.

### What remains
- **C1 crowd = the persistent #1** (before 69 S2, after 9 S2). The `locked` line helps *when copied verbatim* but keeps getting reworded into inversions — worst on **draws**, where the model calls a correctly-backed outcome a "miss" and labels the home-backing % as "% who nailed the draw" (global draw% was often 2–6%).
- **C4 champion-staple** — pre-existing (Jun 15: 3 S3; Jun 25: 1 S3) and **still firing after** (Jul 4 Tuki/France, Jul 5 AviGridish/Brazil). Only occurs when a champion plays that day. The fix's champion-binding helped in the quiet windows but doesn't guard the "Tomorrow's danger" closer.

## 4. The evaluation method itself (second target)
**It works and scales.** 150 summaries fully machine-verifiable in both eras — `input_json` carried all ground truth (`dist_group/global`, leaderboard, picks, per-prediction pts/exact/auto) even pre-fix. The fixed per-summary score gave consistent, comparable grades and **caught what eyeballing missed** (C4 staples, recap misattributions I graded "clean" by eye).
- **Reliable axes:** C1–C4 fact checks (deterministic vs ground truth).
- **Soft axis:** humor (agent-scored 1–5, ±calibration between agents — treat as trend, not precise). Freshness was consistently the weakest humor axis (~2.3–2.8) across the whole tournament — heavy template reuse.
- **Productionize:** run nightly after generation — code for C1–C4 (free, exact), optional LLM judge for humor; store per-summary score; track the trend and alert on any S3.

## 5. Recommendations (ranked)
1. **C4 champion-staple guard (fix first — highest severity, unsolved).** Code post-check: reject/regenerate any "champion X won/lost" clause whose team ≠ that member's `champion_line`. Never assert a champion result unless `champion_status ∈ {win,loss,draw}`.
2. **C1 crowd (largest volume, the true residual).** (a) MOST_RIGHT `locked` → append "…the field mostly got it right too (X%)"; (b) forbid "nobody/everybody/only one nailed it" — separate *exact-hits* (often 0) from *outcome-correct*; (c) special-case **draw games**; (d) hand the model `nailed_by`/`missed_by` and forbid "the only one" unless list length = 1.
3. **Recap integrity.** Enforce recap game == `p4.focus_game` + print all members (kills the last C2 slips).
4. **Try a better model — now strongly justified.** 100% of after-fix residual is *interpretation* failure; code owns the mechanical facts. A/B gpt-5.x as generator only, same fact-lock payload + same rubric, on the same 30. Switch if it clears the S3s and halves C1. Keep fact-lock regardless.
5. **Ship the evaluator** as the nightly QA harness (§4).

## 6. Bottom line
The fact-lock is a **genuine improvement** — full-tournament mean score **84.9 → 92.2**, errors **−44%** — but the headline is inflated by declining games-per-day; the **cadence-matched marginal gain is ~+2 pts**. Its real, durable value is **structural**: it eliminated the two worst before-era failures (recap-misattribution S3s, rank arithmetic) by making those facts correct-by-construction, and halved crowd errors. Two concentrated problems remain — **C1 crowd framing** (persistent #1) and the **C4 champion-staple** (unsolved, both eras) — both addressable via a code guard + targeted prompt patches, and both squarely in the wheelhouse of a stronger generator model.
