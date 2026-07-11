# AI Summary Evaluator (local, deterministic)

Local, reproducible fact-check of the nightly roast summaries. No cloud agents. Runs on your machine against each summary's own `input_json` ground truth.

## Files
- `fetch.cjs` — pulls `ai_summaries` (+ `input_json`) to `data/summaries.json`, normalized. Needs the **service-role** key (RLS blocks anon).
- `evaluate.cjs` — the deterministic scorer. Reads `data/summaries.json`, writes `data/eval-report.json` + `data/eval-report.md`. **No network, no LLM — same output every run.**
- `data/summaries.json` — the snapshot (a 4-group Jul-5 sample is committed as a fixture/test).

## Run
```bash
# 1. fetch the full range (service-role key, never hardcode it)
SUPABASE_SERVICE_ROLE_KEY=xxxxx node scripts/eval/fetch.cjs 2026-06-11 2026-07-31

# 2. score it (offline, deterministic)
node scripts/eval/evaluate.cjs
```
Output: per-summary score + grade, before/after rollup, and the full error list in `data/eval-report.md`.

## Scoring
`score = max(0, 100 − 25·S3 − 10·S2 − 3·S1)` → **A≥90 B≥75 C≥60 D≥40 F<40**
- **S3** fabricated fact · **S2** number right / meaning flipped · **S1** phrasing slip.

## What is deterministic here — ALL facts (C1–C4), the reproducible core
| Check | Catches |
|---|---|
| **C2 recap** | recap block vs `p4.recap` — wrong game, wrong score (S3), wrong pts (S2), truncation (S1) |
| **C4 champion** | "champion X won/lost/didn't play" bound to a member vs that member's `champion_status`/team — the **staple S3** |
| **C4 scorer** | "top-scorer X didn't play" vs `scorer_line` "did not score" |
| **C3 rank/gap** | "N separate A and B", "A N behind", "A and B tied" vs leaderboard points |
| **C1 %-fabrication** | every `N%` must exist in some `dist_group`/`dist_global` bucket |
| **C1 polarity** | "field floundered / nailed it" vs `dist` majority vs `result` (with 0%/nobody negation guard) |
| **C1 false-uniqueness** | "the only one to miss / everyone was wrong" vs `nailed_by`/`missed_by` lists |

Validated:
- Real Jul-5 fixture → flags the **AviGridish→Brazil champion staple (C4·S3)**, **zero false positives**.
- C1 unit test (`data/_c1_test.json`) → catches "the competition floundered" (field was right), correctly IGNORES "0% got the score right" (negated), catches "only one to miss" when 3 missed.

## What is NOT done here — only the HUMOR judge
All facts are scored by code. The **only** thing left to an LLM judge is the humor score
(funny/roast/natural/coverage/fresh), which must use a **fixed prompt + seed** run locally
against your own model/key. That judge module is not built yet; this script scores facts only.

Known deterministic recall gaps (rare, low severity — a claim may slip through, never a false flag):
- scorer "didn't play" via indirect phrasing ("...and neither did your top-scorer pick X").
- distribution *mislabels* ("33% thought Brazil would win" when that 33% backed Norway) — the % exists so it isn't flagged as fabricated; catching it needs team-vs-bucket parsing (future).

## Honesty note
This replaces the earlier cloud-agent adjudication (which did everything by LLM reasoning — not reproducible). The deterministic layer here is trustworthy and re-runnable; the C1-polarity + humor numbers are only as good as the judge module you plug in next.
