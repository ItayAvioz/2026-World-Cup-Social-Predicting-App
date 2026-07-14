# AI Summary Evaluation — Full Review (2026-07-06)

Machine-graded fact-check of **48 summaries** vs their `input_json` ground truth, done by 3 parallel auditor agents under one rubric.
- **Before-fix** (old system): Jun 28–30, 18 summaries
- **After-fix** (fact-lock live): Jul 1–5, 30 summaries

## Rubric
- **C1** crowd polarity/framing · **C2** scoreline/recap · **C3** rank/gap · **C4** champion/scorer
- **S3** major = wrong team/score/outcome/champion stated as fact (fabrication)
- **S2** moderate = number correct, meaning flipped/mislabeled
- **S1** minor = phrasing/logic slip, no false fact

---

## A. BEFORE-FIX — Jun 28–30 (18 summaries)

| # | Group | Date | Errors | Clean |
|---|---|---|---|---|
| 1 | Afula_Gang | 06-28 | C1·S2 "only 17% picked Canada" (group backed it 83%) | ✗ |
| 2 | Afula_Squad | 06-28 | C1·S2 "9% of us right" (majority actually right) | ✗ |
| 3 | Crows_Cartel | 06-28 | — | ✓ |
| 4 | FC_Arkal | 06-28 | — | ✓ |
| 5 | FC_Rakafot | 06-28 | C1·S1 "everyone wrong together" (A_I hit exact) | ✗ |
| 6 | Koren | 06-28 | C1·S2 "group failed to predict Canada" (67% got it) | ✗ |
| 7 | Afula_Gang | 06-29 | — | ✓ |
| 8 | Afula_Squad | 06-29 | **C2·S3** 7 members credited nailing "Germany 1-1" — 6 predicted *Netherlands* 1-1 | ✗ |
| 9 | Crows_Cartel | 06-29 | C1·S2 "18% Paraguay draw" (0%) + C3·S2 wrong tie (Moti vs Itay) + C3·S2 "last" (rank 5) | ✗ |
| 10 | FC_Arkal | 06-29 | — | ✓ |
| 11 | FC_Rakafot | 06-29 | — | ✓ |
| 12 | Koren | 06-29 | — | ✓ |
| 13 | Afula_Gang | 06-30 | C1·S2 "17% Norway / 40% others right" (33% / 45%, wrong team) | ✗ |
| 14 | Afula_Squad | 06-30 | C3·S2 "Nitzo & Itaish 1 apart" (6 apart; tie is Nitzo=Shaig) | ✗ |
| 15 | Crows_Cartel | 06-30 | **C2·S3** "Gilgol 2-0 Mexico matched" (he predicted 1-3) + C1·S2 "27% France draw" (4%) | ✗ |
| 16 | FC_Arkal | 06-30 | C3·S2 "Moran 3 behind" (6) + C1·S2 "75% France" (100%) + C1·S1 false-uniqueness | ✗ |
| 17 | FC_Rakafot | 06-30 | — | ✓ |
| 18 | Koren | 06-30 | C1·S2 "40% Norway" (45%) | ✗ |

**Before rollup:** 16 errors — C1=10 (8·S2, 2·S1), C2=2 (**2·S3**), C3=4 (4·S2), C4=0. **Clean 7/18 (39%).**
Humor: funny 4.0 · roast 4.1 · natural 3.9 · coverage 4.1 · fresh 3.2.

---

## B. AFTER-FIX — Jul 1–3 (18 summaries)

| # | Group | Date | Angle | Errors | Clean |
|---|---|---|---|---|---|
| 1 | Afula_Gang | 07-01 | EXACT_FLEX | C1·S2 "83% nailed 2-0" (outcome% vs 3 exact) + C2·S2 "1-3 loss for England" (was USA-Bosnia) | ✗ |
| 2 | Afula_Squad | 07-01 | EXACT_FLEX | C1·S2 EddieHazan "picked 2-2" self-contradiction + C3·S1 Nitzo "buried" (2nd) | ✗ |
| 3 | Crows_Cartel | 07-01 | MOST_RIGHT | — | ✓ |
| 4 | FC_Arkal | 07-01 | MOST_RIGHT | **C1·S3** Perl "thought Belgium would win… left in the dust" — Perl was the ONLY one who nailed the draw | ✗ |
| 5 | FC_Rakafot | 07-01 | MOST_WRONG | C1·S2 "29% of the field missed it" (29% *had* it) | ✗ |
| 6 | Koren | 07-01 | MOST_WRONG | C2·S1 "3-4 for England over DR Congo" self-contradiction | ✗ |
| 7 | Afula_Gang | 07-02 | MOST_RIGHT | C1·S2 "other groups missed it" (field 64% got it right) | ✗ |
| 8 | Afula_Squad | 07-02 | EXACT_FLEX | — (recap truncated 6/11 members) | ✓ |
| 9 | Crows_Cartel | 07-02 | EXACT_FLEX | — | ✓ |
| 10 | FC_Arkal | 07-02 | MOST_RIGHT | C3·S1 "Perl 2-point gap" (Perl is 13 back; gap is Moran/A_I) | ✗ |
| 11 | FC_Rakafot | 07-02 | MOST_WRONG | — | ✓ |
| 12 | Koren | 07-02 | MOST_WRONG | — | ✓ |
| 13 | Afula_Gang | 07-03 | MOST_WRONG | C3·S1 "2-point gap" izik/dor (actually 3) | ✗ |
| 14 | Afula_Squad | 07-03 | EXACT_FLEX | C3·S2 Itay "only one to come up empty" (3 members scored 0) | ✗ |
| 15 | Crows_Cartel | 07-03 | MOST_WRONG | C2·S2 printed *Colombia 1-0 Ghana* recap under *Argentina 1-1* focus | ✗ |
| 16 | FC_Arkal | 07-03 | MOST_WRONG | — | ✓ |
| 17 | FC_Rakafot | 07-03 | MOST_WRONG | C2·S2 CR7 "Argentina would win 4-1" (recap 1-4 = Argentina losing) | ✗ |
| 18 | Koren | 07-03 | MOST_WRONG | — | ✓ |

**Jul 1–3 rollup:** 13 errors — C1=5 (1·S3, 4·S2), C2=4 (3·S2, 1·S1), C3=4 (1·S2, 3·S1), **C4=0**. **Clean 7/18.**

---

## C. AFTER-FIX — Jul 4–5 (12 summaries)

| # | Group | Date | Angle | Errors | Clean |
|---|---|---|---|---|---|
| 1 | Afula_Gang | 07-04 | MOST_RIGHT | **C4·S3** Tuki "champion France won" (his champion is Spain, didn't play) + C1·S2 "rest floundered" | ✗ |
| 2 | Afula_Squad | 07-04 | MOST_RIGHT | — | ✓ |
| 3 | Crows_Cartel | 07-04 | MOST_RIGHT | C2·S1 Gilgol "0-3 on your prediction" muddled | ✗ |
| 4 | FC_Arkal | 07-04 | MOST_RIGHT | C1·S2 Perl "the only one to miss Canada-Morocco" (3 of 4 missed) | ✗ |
| 5 | FC_Rakafot | 07-04 | MOST_RIGHT | — | ✓ |
| 6 | Koren | 07-04 | MOST_WRONG | — | ✓ |
| 7 | Afula_Gang | 07-05 | MOST_WRONG | C2·S1 "picked 2-1 Mexico, lost 3-2" (digit reversal) | ✗ |
| 8 | Afula_Squad | 07-05 | MOST_WRONG | **C4·S3** AviGridish "champion Brazil just lost" (his champion is Argentina, didn't play) + C4·S2 Kane "didn't play" (didn't score) | ✗ |
| 9 | Crows_Cartel | 07-05 | MOST_WRONG | — | ✓ |
| 10 | FC_Arkal | 07-05 | MOST_WRONG | C1·S2 Perl "only one to miss all" (3 members scored 0) | ✗ |
| 11 | FC_Rakafot | 07-05 | MOST_WRONG | C1·S2 "33% thought Brazil would win" (0% did; those 33% backed Norway) | ✗ |
| 12 | Koren | 07-05 | MOST_WRONG | C1·S2 "picked 0-1 Brazil and got it wrong" (0-1 was correct — his only point) | ✗ |

**Jul 4–5 rollup:** 10 errors — C1=5 (5·S2), C2=2 (2·S1), C3=0, **C4=3 (2·S3, 1·S2)**. **Clean 4/12.**

---

## D. AFTER combined (30) & Before/After comparison

**After totals:** 23 errors — C1=10, C2=6, C3=4, C4=3 · S3=3, S2=14, S1=6 · **Clean 11/30 (37%).**

| Metric (per summary) | Before | After | Δ |
|---|---|---|---|
| Total errors | 0.89 | 0.77 | −13% |
| S2 (meaning-flip) | 0.67 | 0.47 | −30% |
| S3 (fabrication) | 0.11 | 0.10 | flat |
| Clean rate | 39% | 37% | flat |
| **C1 crowd** | 0.56 | 0.33 | **−41%** ✅ |
| **C3 rank/gap** | 0.22 (S2) | 0.13 (mostly S1) | **↓ & softened** ✅ |
| **C2 recap** | 0.11 (2×S3) | 0.20 (0×S3) | catastrophes gone, residual softer ✅ |
| **C4 champion** | 0.00 | 0.10 (2×S3) | **NEW REGRESSION** ❌ |

## E. Verdict
The fact-lock is a **real but modest** net win (−13% errors, −30% on meaning-flips). Its true value is qualitative:
- ✅ **Solved rank/gap arithmetic** (before: 4×S2 wrong "who's-behind/tied/last").
- ✅ **Killed the cross-game recap catastrophe** (before: 2×S3 mass mis-attribution on duplicate scorelines).
- ✅ **Cut crowd errors ~41%.**
- ❌ **Opened a new C4 champion-staple hole** (2×S3) — the closer grabs the day's played-champion result and staples it to the wrong member.
- ⚠️ **C1 crowd still #1 class** — the locked line works when copied verbatim but gets reworded into inversions/false-uniqueness, worst on **draw games**.

## F. Recommendations (ranked)
1. **C4 champion-staple (fix first, 2×S3).** Code guard: reject/regenerate any "champion X won/lost" clause whose team ≠ that member's `champion_line`. Never assert a champion result unless `champion_status ∈ {win,loss,draw}`.
2. **C1 crowd (largest volume).** (a) MOST_RIGHT locked → append "the field mostly got it right too (X%)". (b) Supply `nailed_by`/`missed_by`, forbid "the only one" unless list length = 1. (c) Special-case draw games (source of nearly all polarity/direction slips).
3. **Recap integrity.** Enforce recap game == `p4.focus_game` (Crows 07-03) + print all members (Afula_Squad 07-02). Cheap code guard.
4. Soft C3/C2 (S1) — "tomorrow's danger" mislabels, winner-first scoreline — low priority.

## G. Better model?
**Yes — now well-justified.** 100% of the after-fix residual is *interpretation* failure (reword the locked line, don't staple the wrong champion, don't invert a draw) — the code already nailed everything mechanical. A/B a frontier model (gpt-5.x) as generator only, same fact-lock payload + same rubric, on the same 30. Switch if it clears the 3 S3s and halves C1. Keep fact-lock regardless.
