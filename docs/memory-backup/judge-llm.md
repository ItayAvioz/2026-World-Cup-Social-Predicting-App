---
name: Judge LLM system
description: 5-agent parallel AI summary generation with gpt-4o judge — architecture, DB schema, EF v23, test script, comparison runs, PR merged
type: project
originSessionId: 40f78edd-e27c-4064-bae5-576e45150fdb
---
## Status
✅ Fully built, tested, patched, and merged (2026-05-05). M62+M63+M64+M65+M69+M70 applied, EF v23 (Supabase v27) live, notify-admin v3 live. PR #1 merged to main (merge commit ebdaa11).

## Architecture
- **5 agents** run in parallel (gpt-4o-mini) — each receives the same v17 payload
- **gpt-4o judge** scores all 5 candidates and picks the winner
- Winner upserted to `ai_summaries`; full run saved to `ai_judge_runs`

## Agent Parameters
| Agent | Slot | Prompt version | Temperature | Seed | Focus |
|---|---|---|---|---|---|
| Agent 1 | `main` | v11-main-2 | 0.6 | 42 | All v10 bugs fixed, balanced |
| Agent 2 | `candidate_2` | v12-picks-2 | 0.5 | 43 | Picks as primary rivalry fuel |
| Agent 3 | `candidate_3` | v13-unique-2 | 0.4 | 44 | Uniqueness, no P4 templates |
| Agent 4 | `baseline` | v10 (baseline) | 0.6 | 42 | Original production prompt — benchmark |
| Agent 5 | `candidate_4` | v10B | 0.6 | 42 | v10 with "bad guessers" banned + direction fix |

## Prompt versions active in DB
- `v11-main-2` (main) — v2 of main: direction rule, P5 scoreline note, GOOD EXAMPLE, champion guard
- `v12-picks-2` (candidate_2) — v2: picks-first, direction synonym fix, champion guard
- `v13-unique-2` (candidate_3) — v2: data-anchor openers, P4 ban list, P6 template ban, champion guard
- `v10B` (candidate_4) — new in M64: v10 with "bad guessers" banned, direction rule, champion guard
- `v10` (baseline) — original production prompt, reference only

## Prompt patch history (M65 — prompt_v3)
Champion confusion guard added to all 4 non-baseline prompts:
- `picks[].champion is the member's tournament winner pick — never use it as a team name in games[]. Teams playing today are only in games[].home_team and games[].away_team`

v12-picks-2 direction synonym fix:
- Quality check now covers: "got it right", "had a field day", "saw it coming", "were correct", "got it", "called it" — not just literal phrase

## Judge Scoring Weights (EF v22)
- Accuracy: 45% — with per-phrase deduction list including synonym phrases for direction errors
- Humor: 30%
- Compliance: 15% — includes champion-as-team deduction (−2)
- Structure: 10%
- Hard floor: accuracy ≤ 3 → disqualified
- Reasoning: must name ONE specific differentiator (not generic "most accurate and humorous")

## Test Comparison Results (2026-05-04)
**New v2 prompts run (16-25-10 CSV) — 20 matchups:**
| Agent | Wins | Avg WTotal |
|---|---|---|
| v13-unique-2 | 8 | ~7.9 |
| v11-main-2 | 7 | ~8.1 |
| v12-picks-2 | 3 | ~8.0 |
| v10B | 2 | ~7.7 |
| v10 | 1 | 9.2 |
Overall winner avg: **8.04**. Structure avg: 9.10. Humor avg: 7.30 (low — no picks set in test data).

**vs old v1 prompts (13-48-21 CSV):**
- v13-unique surged 2→8 wins (data-anchor + P4 ban working)
- v12-picks dropped 7→3 (picks-first framing less effective with null picks in test data — expected to recover on real WC data)
- v11-main 10→7 (v13 stealing wins)

## DB Objects
**M62** — ai_judge_runs table, agent_slot on prompt_versions, ai_summaries judge columns, fn_daily_admin_digest
**M63** — baseline slot, winner_agent 1-4
**M64** — candidate_4 slot, winner_agent 1-5, v10B/v11-main-2/v12-picks-2/v13-unique-2 prompt rows
**M65** — champion guard + v12 direction synonym patches (UPDATE only, no schema change)

## EF nightly-summary v23 (Supabase v27, ACTIVE — 2026-05-04)
- Loads 5 prompts by `agent_slot` — `['main','candidate_2','candidate_3','baseline','candidate_4']`
- `Promise.all()` runs all 5 in parallel; judge activates when `candidates.length >= 3`
- **v23 new**: each candidate in `ai_judge_runs.candidates` JSONB now includes `version_tag` (from prompt_versions)
- **v23 new**: `ai_summaries` upsert now includes `winner_score` — the judge's total score for the winning agent
- `callJudge()` type: `Array<{ agent: number; slot: string; content: string }>` (slot was missing in v21, fixed in v22)
- `winnerAgent` type: `1|2|3|4|5`

## Test Script
- `test/judge_compare.cjs` — CommonJS (run with Node.js directly; .js version fails due to `"type":"module"` in package.json)
- `test/judge_compare.js` — same content, ES module context (use .cjs instead)
- Run: `$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; $env:OPENAI_API_KEY="sk-..."; node test/judge_compare.cjs`
- 5 agents × 4 dates × 5 groups = 20 judge decisions per run
- CSVs saved in `test/` — 4 runs archived (09:34, 10:48, 13:22, 16:25)

## Git / PR
- ✅ **PR #1 merged and closed** (2026-05-05) — feature/judge-llm merged into main via local merge (-Xours). Main's v23 EF kept on conflict. Merge commit: ebdaa11.
- Supabase deployments were live before merge and remain active.

## Migration Alignment
Local supabase/migrations/ fully aligned — 72 local files, 6 stub files (comment-only, no SQL):
- `20260422172100_fn_schedule_auto_predict_all_games.sql` — M58 all-games auto-predict (reverted by M59)
- `20260503082239_feedback_bucket_public.sql` — feedback storage bucket made public
- `20260503083901_feedback_view.sql` — admin feedback view
- `20260504132006_judge_test_anon_access.sql` — anon read on prompt_versions
- `20260504134747_prompt_fixes_v2.sql` — intermediate patch (reverted)
- `20260504144115_revert_prompt_fixes_v2.sql` — revert of above
supabase/CLAUDE.md is the canonical migration log (all 72 entries).

## Pending
- Clean up test data (The Legends group + fake scores) before real WC games seeded
- Run fn_schedule_auto_predictions + fn_schedule_ai_summaries after real WC games seeded
- Humor scoring (avg 7.30) expected to improve on real WC data with picks set — re-evaluate judge tuning after first real run
