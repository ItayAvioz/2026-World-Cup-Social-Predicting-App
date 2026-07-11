# AI-Summary Evaluation & Self-Correction System

Reference spec for the nightly-summary quality gate. Everything here was built and validated
**locally** this session; the DEV EF deploy is still pending. Base production on this document.

---

## 0. TL;DR pipeline

```
5 agents (gpt-4o-mini) ─▶ judge (gpt-4o) picks winner
      │
      ▼
  DETERMINISTIC GATE  (evaluate.cjs / factgate.ts — no LLM)
      │
      ├─ PASS ────────────────────────────────▶ ship winner (0 model calls)
      │
      └─ FAIL
           │  ATTEMPT 1 — gpt-5-mini FULL REGEN (same prompt + data)
           │        re-gate → PASS? ship
           │
           └─ still FAIL
                   ATTEMPT 2 — SURGICAL single-line fix
                        prose (gap/behind) → gpt-5-mini rewrites ONE line w/ correct number
                        recap (wrong game) → deterministic splice of p4.recap (no model)
                        re-gate → ship best-effort → STOP (no attempt 3)
```

Models: **generation** gpt-4o-mini · **judge** gpt-4o · **escalation** gpt-5-mini (only on FAIL).

---

## 1. Generation (unchanged, pre-existing)

- Trigger: `pg_cron`, per group, +210 min after the day's last kickoff (match-day boundary 07:30 UTC).
- `buildGroupPayload()` + `enrichSummaryPayload()` = **fact-lock**: facts computed in code, model writes only humor.
  Payload carries `standings`, per-game `dist_group/dist_global` + `nailed_by/missed_by` + `crowd_line`,
  per-row gap fields, per-pick `champion/champion_status/champion_line/top_scorer/scorer_line`, and
  `p4{focus_game, angle, locked, recap, members}`.
- 5 agents run in parallel (`callAgent`, gpt-4o-mini, max_tokens 400, top_p 1):

  | idx | version tag | temp | seed |
  |---|---|---|---|
  | 1 | v13-unique-2 | 0.4 | 44 |
  | 2 | v12-picks-2  | 0.5 | 43 |
  | 3 | v11-main-2 (main) | 0.6 | 42 |
  | 4 | v10B         | 0.6 | 42 |
  | 5 | v10 (baseline) | 0.6 | 42 |

- Judge (`callJudge`, gpt-4o) scores accuracy/humor/compliance/structure (0–10) → `winner_agent`.

---

## 2. THE GATE — deterministic evaluator (`evaluate.cjs`)

Runs 8 check functions on the winning content vs its own `input_json`. Every error =
`{ class, sev, kind, claim, truth, tier }`. **Reproducible, no LLM.**

**Score** = `max(0, 100 − 25·S3 − 10·S2 − 3·S1)` · **grade** A≥90 B≥75 C≥60 D≥40 else F.

### Checks by class
- **C2 recap** (`checkRecap`, truth = `p4.recap`): `recap-missing` S2 (presence assertion),
  `wrong-game-recap` S2, `recap-phantom` S2, `recap-score` **S3**, `recap-pts` S2, `recap-truncated` S1.
- **C4 champion** (`checkChampion`, 3 bind forms: possessive / addressee / team-first;
  verb via `outcomeInWindow` = win/loss/draw/not_played): `champion-wrong-team` **S3**,
  `champion-wrong-outcome` S2/S3.
- **C4 scorer** (`checkScorer`): `scorer-play-vs-score` S2 ("didn't play" vs scored-0).
- **C4 champion-alive** (`checkChampionAlive`, NEW, **soft**): `champion-falsely-out` S2 — absence/
  elimination phrasing bound to a member whose `champion_alive === true`. Fires only when the field
  is present (backward-safe). Catches the da_fish "no champion to back you up / France still alive" case.
- **C3 gaps** (`checkGaps`, from `leaderboard.total_pts`): `behind` S2, `ahead` S2, `gap` S2, `tie` S2.
- **C1 crowd** (`checkPercents` + `checkCrowd`): `fabricated-pct` S2 (**hard**),
  `distribution-mislabel` S2 (soft), `polarity-inverted` S2 (soft), `inverse-polarity` S2 (soft),
  `false-uniqueness-miss/all` S2 (soft).
- **Structure** (`checkStructure`): `scaffold-leak` S1, `too-short` S2.

### HARD vs SOFT (this is what gates)
```
HARD_KINDS = { champion-wrong-team, champion-wrong-outcome, scorer-play-vs-score,
               recap-score, recap-pts, recap-missing, wrong-game-recap, recap-phantom,
               gap, behind, ahead, tie, fabricated-pct, scaffold-leak, too-short }
tier   = HARD_KINDS.has(kind) ? 'hard' : 'soft'
gate   = any hard error at sev S2 or S3  →  FAIL   else PASS
```
- **HARD** = precise, verifiable → **gates → escalates**.
- **SOFT** (all crowd polarity/mislabel/uniqueness + `champion-falsely-out`) = advisory. Lowers score,
  **never gates**, never escalates. Deliberate: soft checks can false-positive, so they must not fail the gate.

### Format-robustness (learned the hard way)
Name-binding is **line-based** (works for single- and double-newline output); possessive
`X's champion Y` parsed correctly; headerless recaps still detected; presence assertions on
missing recap. Locked by `test.cjs` (6 cases, both formats). Without this the gate was gameable by reformatting.

---

## 3. ESCALATION — `runFactGate()` in `factgate.ts`

`factgate.ts` = the evaluator **sliced verbatim from `evaluate.cjs`** (parity 150/150) + the two escalation
attempts. Regenerate via the marker slice (`const norm =` … just before `function main()`) + append
`_factgate_escalation.ts`; never hand-edit the evaluator half.

### 3a. ATTEMPT 1 — gpt-5-mini FULL regen  (`gpt5Call`, 2000 tok)
```js
system  = winnerPromptRow.system_prompt
userMsg = winnerPromptRow.user_prompt_template.replace('{{group_json}}', JSON.stringify(payload))
regen   = gpt-5-mini(system, userMsg, { max_completion_tokens: 2000, reasoning_effort: 'minimal',
                                        top_p: 1, seed: winner.seed })
guard: regen must be ≥120 non-space chars
re-evaluate regen:
   PASS → ship
   else → keep regen as the base for surgical (content = regen), continue
```
Same winning prompt + same payload — **only the model changes**. gpt-5-mini is a reasoning model and
**ignores the seed**, so regen output varies run-to-run (that's fine — attempt 2 absorbs it).

### 3b. ATTEMPT 2 — SURGICAL single-line fix  (`surgicalFix` + `planPatch`)
For each remaining **hard** error, fix ONLY the offending line, freeze the rest:

| hard kind | mode | how the correct value is obtained |
|---|---|---|
| `wrong-game-recap` | **deterministic** | replace the recap line (≥2 `name D-D (Npts)` entries) with `p4.recap` verbatim — no model |
| `gap` | **gpt-5-mini line rewrite** (400 tok) | find `"N points separate A and B"`, compute true gap `|pts[A]−pts[B]|` from leaderboard, tell the model to rewrite that ONE line stating the correct number, keep tone |
| `behind` | **gpt-5-mini line rewrite** | find `"N points behind ref"`, compute true gap, same one-line rewrite |
| *(others: ahead/tie/champion*/fabricated-pct/recap-score…)* | **no surgical handler yet** → relies on attempt-1 regen only |

Then re-evaluate → ship best-effort → **STOP** (no attempt 3). `meta` logged:
`{ gate0, escalated, surgical, final_gate, hard[] }`.

### Why surgical beats another full regen
Full regen plays **whack-a-mole** — in ~2 of 4 unresolved cases it fixed one error and *introduced a
different one*. A single-line edit **structurally can't** do that: the already-correct ~95% of the
summary is frozen. Prose facts → tiny gpt-5-mini rewrite (~30 tok vs 2000, ~60× cheaper); structured
recap → deterministic splice.

---

## 4. VALIDATED RESULTS (local, real PROD data)

| Run | Outcome |
|---|---|
| 150 tournament summaries | gate 132 PASS / 18 FAIL. 90 clean · 42 pass-with-soft · 18 hard. |
| Fact-lock before/after | clean 57% → 73%; S2 55 → 8. |
| Full loop (`runFactGate`) on the 18 fails | **18/18 PASS** — 13 by regen, 5 by surgical (split varies; loop still lands 18/18). |
| 07-07 review + full loop | 6/6 PASS, gpt-5-mini invoked 0×, 0 changed. |
| 07-07 with `champion_alive` | da_fish `champion-falsely-out` now flagged (soft, still PASS). |

### Per-prompt test results (verified 2026-07-08, re-run from `evaluate.cjs` over the 150)
Conditional on winning (judge picks the winner, so n is uneven). Prompt attributed via
PROD `ai_summaries.winner_agent` → index→version map (`winner_agents.json`).

| version | n (won) | pass | **fail% (major)** | clean% | soft-pass% | **hard/major errs** | soft errs |
|---|---|---|---|---|---|---|---|
| v11-main-2 (main) | 37 | 31 | **16%** | 59% | 24% | 6 | 11 |
| v10B | 67 | 60 | 10% | 66% | 24% | 7 | 18 |
| v10 (baseline) | 35 | 33 | 6% | 46% | 49% | 2 | 19 |
| v12-picks-2 | 6 | 3 | **50%** | 50% | 0% | 3 | 1 |
| v13-unique-2 | 5 | 5 | 0% | 100% | 0% | 0 | 0 |
| **TOTAL** | **150** | **132** | **12%** | **60%** | **28%** | **18** | **49** |

**Hard (major) errors by prompt:**
- v11-main-2 → `behind`×4, `champion-wrong-team`×2
- v10B → `gap`×4, `behind`×1, `fabricated-pct`×1, `tie`×1
- v10 → `behind`×1, `gap`×1
- v12-picks-2 → `behind`×1, `wrong-game-recap`×1, `champion-wrong-team`×1
- v13-unique-2 → none

**Soft errors by prompt:**
- v11-main-2 → `inverse-polarity`×5, `distribution-mislabel`×4, `polarity-inverted`×2
- v10B → `polarity-inverted`×9, `inverse-polarity`×7, `distribution-mislabel`×1, `false-uniqueness-miss`×1
- v10 → `polarity-inverted`×11, `inverse-polarity`×6, `recap-truncated`×1, `distribution-mislabel`×1
- v12-picks-2 → `inverse-polarity`×1
- v13-unique-2 → none

**Read:** worst = **v12-picks-2** (50% fail, low volume → retire/fix) and **v11-main-2** (16%, highest
impact by volume). **v10** is factually safest (2 hard) but tonally loosest (19 soft, heavy `polarity`).
All soft errors are the **draw-framing** family (`polarity`/`inverse-polarity`/`mislabel`).

### Verification (all re-run 2026-07-08 from code + local files)
- `test.cjs` regression: **6/6 pass**
- gate over 150: **132 pass / 18 fail** (BEFORE n=120 mean 95.2 S2=55 clean 68; AFTER n=30 mean 95.6 S2=8 clean 22)
- `_factgate.ts` (EF port) vs `evaluate.cjs`: **parity 150/150**
- `runFactGate` full loop over the 18 fails: **18/18 PASS** (13 regen + 5 surgical — split varies run-to-run)

---

## 5. RECOMMENDED FINE-TUNING (priority order)

1. **Champion-still-alive (the da_fish class).** Check added (**soft**, `champion-falsely-out`, parity-safe).
   **Keep it soft** — hard-gating would false-fire across the **group stage** (all champions alive there,
   so normal "no champion today" lines would false-escalate). Real fix = **prompt rule**:
   *"A champion still in the tournament is never 'gone/out/no backup'; if their team simply didn't play
   today, say that."* Needs EF to add `champion_alive` to each pick
   (`champion && !eliminatedSet.has(champion)`, eliminated = lost a KO game ≤ date). If ever promoted to
   hard, **phase-gate to knockouts only**.

2. **Soft-error prompt tuning (draws).** Dominant soft cause across all prompts = draw-game framing.
   Add one shared rule to v10/v10B/v11: *"crowd is 'right' only if its majority backed the actual result;
   a draw beats a backed team = crowd was wrong; cite only the winning bucket's %."* A/B in DEV
   (same model+data), keep if soft drops without raising hard.

3. **Fix or retire weak prompts.** v12-picks-2 (50% fail) + v11-main-2's `behind`/`champion` weakness =
   most hard errors. Cheaper to fix the prompt than to escalate every time.

4. **Add surgical handlers** for `champion-*`, `tie`, `ahead`, `recap-score`, `fabricated-pct` so
   attempt-2 covers them too (today only gap/behind/wrong-game-recap have surgical fixes; the rest rely
   on regen).

5. **Deploy to DEV EF.** `factgate.ts` + 2 edits to `index.ts` (import + gate call before the upsert)
   are ready, parity-verified. Pending transport decision (MCP inline + re-fetch/diff verify, or a
   Supabase access token for CLI).

---

## 6. KNOWN LIMITATIONS (carry into production)

- **Surgical is partial** — only gap/behind/wrong-game-recap; other hard kinds depend on regen succeeding.
- **gpt-5-mini ignores seed** → regen non-deterministic; rely on the two-stage loop, not reproducibility.
- **Soft checks can false-positive** (crowd polarity, `champion-falsely-out`) → advisory only, by design.
- **`champion_alive` not yet in the live payload** → check #1 is inert until the EF enrichment ships.
- **Per-prompt stats are conditional-on-winning**, not raw per-prompt quality (non-winning drafts aren't stored).
- **Nothing is deployed** — all results above are local; the EF still runs the un-gated v36.

---

## 7. Files

| File | Role |
|---|---|
| `scripts/eval/evaluate.cjs` | the deterministic evaluator (source of truth) |
| `scripts/eval/test.cjs` | 6-case regression suite (guards format-robustness) |
| `scripts/eval/run.cjs` | local full-regen driver (attempt 1 over the 18) |
| `scripts/eval/surgical.cjs` | local surgical driver (attempt 2) |
| `scripts/eval/run-factgate.cjs` | runs the EF's `runFactGate` end-to-end locally |
| `scripts/eval/_factgate.ts` | EF port: evaluator slice + escalation (`runFactGate`) |
| `scripts/eval/_factgate_escalation.ts` | escalation source appended during regeneration |
| `scripts/eval/_ef_nightly_v36.ts` | working copy of index.ts with the 2 gate edits |
| `scripts/eval/data/*` | snapshots, payloads, prompts, reports (gitignored) |
