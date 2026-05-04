# Judge LLM — Full Design Plan

## Core Goal
Every decision in this plan serves one purpose:
**A nightly summary that is true to the data, funny, and increases competition between friends.**

---

## Agent Parameters Summary

| Agent | Version | Slot | Model | Temperature | Max tokens | Seed | Focus |
|---|---|---|---|---|---|---|---|
| Agent 1 | v11 | `main` | gpt-4o-mini | 0.6 | 400 | 42 | All bugs fixed, balanced |
| Agent 2 | v12 | `candidate_2` | gpt-4o-mini | 0.5 | 400 | 43 | Picks as primary rivalry fuel |
| Agent 3 | v13 | `candidate_3` | gpt-4o-mini | 0.4 | 400 | 44 | Uniqueness, no P4 templates |
| Judge | — | — | gpt-4o | 0.1 | 200 | 1 | 45% accuracy / 30% humor / 15% compliance / 10% structure |

## v10 Parameters (production values — baseline reference)

| Parameter | Value |
|---|---|
| Model | `gpt-4o-mini` |
| Temperature | `0.6` |
| Top P | `1` |
| Max tokens | `400` |
| Seed | `42` |
| Avg prompt tokens | ~4,842 |
| Avg completion tokens | ~196 |

---

## Part 1: Input Data — Fields, Real Examples, Recommendation

Using real data from **The Legends, 2026-06-15** (best available example: picks set, WC games, score variation).

---

### leaderboard[]

**What it is:** Group standings for this specific group.

**Real example (current):**
```json
[
  { "rank": 1, "user": "bob_wc",   "total_pts": 4, "exact": 1, "today_pts": 4, "streak": 2  },
  { "rank": 2, "user": "alice_wc", "total_pts": 3, "exact": 1, "today_pts": 3, "streak": -1 },
  { "rank": 3, "user": "carol_wc", "total_pts": 0, "exact": 0, "today_pts": 0, "streak": -2 }
]
```

**Real example (v11 — after changes):**
```json
[
  { "user": "bob_wc",   "global_rank": 1, "group_rank": 1, "total_pts": 4, "total_exact": 1, "today_exact": 1, "today_pts": 4, "streak": 2  },
  { "user": "alice_wc", "global_rank": 2, "group_rank": 2, "total_pts": 3, "total_exact": 1, "today_exact": 1, "today_pts": 3, "streak": -1 },
  { "user": "carol_wc", "global_rank": 5, "group_rank": 3, "total_pts": 0, "total_exact": 0, "today_exact": 0, "today_pts": 0, "streak": -2 }
]
```

**Field decisions:**

| Field | Keep / Change | Reason |
|---|---|---|
| `rank` | ❌ **rename → `group_rank`** | Makes explicit this is group rank (not global rank) |
| `global_rank` | ✅ **ADD** | This member's rank across ALL groups globally (same basis as leaderboard RPC) |
| `user` | ✅ keep | Names throughout |
| `total_pts` | ✅ keep | P2 gap calculation |
| `today_pts` | ✅ keep | P1, P3, P5 |
| `streak` | ✅ keep | P3 embarrassment, P6 danger — description already in v10 prompt |
| `exact` | ❌ **rename → `total_exact`** + **add description in AVAILABLE DATA** | No description in v10 prompt → AI guesses meaning → hallucinations |
| `today_exact` | ✅ **ADD** | Count of preds with pts=3 for today only. Computed from predictions[]. |

**AVAILABLE DATA descriptions to add in prompt:**
```
leaderboard[].group_rank    = this member's rank within THIS group (1 = group leader)
leaderboard[].global_rank   = this member's rank across ALL groups in the competition
leaderboard[].total_exact   = total exact-score predictions in the tournament (not today only)
leaderboard[].today_exact   = exact-score predictions today only (pts=3 preds)
leaderboard[].streak        = consecutive days correct outcome (positive) or wrong (negative)
```

---

### today{}

**What it is:** Global context — who performed best/worst across ALL groups today.

**Real example:**
```json
{
  "global_top": [
    { "user": "bob_wc",   "pts": 4, "in_group": true },
    { "user": "alice_wc", "pts": 3, "in_group": true }
  ],
  "global_zero": [
    { "user": "carol_wc", "all_auto": true, "in_group": true }
  ]
}
```

**Field decisions:** ✅ keep as-is. `global_top` drives P1 "not just this group" angle. `global_zero` drives P3 social shame count. Both are high humor value.

---

### games[]

**What it is:** Today's finished games with prediction statistics.

**Real example (two games with data, four without):**
```json
[
  {
    "match": "UEFA PO-B 1-0 Tunisia",
    "phase_label": "Group Stage",
    "group_exact_n": 0,
    "upset": false,
    "scorers": null,
    "dist_group": null,
    "dist_global": null
  },
  {
    "match": "Spain 3-0 Morocco",
    "phase_label": "Group Stage",
    "group_exact_n": 1,
    "upset": false,
    "scorers": null,
    "dist_group": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0, "top_score": "3-0", "top_score_n": 1 },
    "dist_global": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0, "exact_hits": 1, "top_score": "1-1", "top_score_n": 1 }
  },
  {
    "match": "France 0-0 Germany",
    "phase_label": "Group Stage",
    "group_exact_n": 1,
    "upset": true,
    "scorers": null,
    "dist_group": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0, "top_score": "1-0", "top_score_n": 1 },
    "dist_global": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0, "exact_hits": 1, "top_score": "0-0", "top_score_n": 1 }
  }
]
```

**Field decisions:**

| Field | Keep / Change | Reason |
|---|---|---|
| `match` | ✅ keep | Used everywhere |
| `phase_label` | ✅ keep | User confirmed |
| `group_exact_n` | ✅ keep | P4/P5 when ≥2 |
| `global_exact_n` | ✅ **ADD** | How many users globally predicted exact score — parallel to group_exact_n. Sourced from dist_global.exact_hits |
| `upset` | ❌ **rename → `group_upset`** | Clarifies this is based on group majority prediction |
| `global_upset` | ✅ **ADD** | Did result go against majority of ALL users globally (based on dist_global pcts) |
| `scorers[]` | ✅ keep | Null now; WC = goal drama + top-scorer rivalry fuel |
| `home_team` | ✅ **ADD** | Explicit home team name (currently buried in match string) |
| `away_team` | ✅ **ADD** | Explicit away team name |
| `result` | ✅ **ADD** | `"home_win"/"draw"/"away_win"` — actual outcome, no parsing needed |
| `home_score` | ✅ **ADD** | Explicit home score |
| `away_score` | ✅ **ADD** | Explicit away score |
| `dist_group` | ✅ keep | n, home_pct, draw_pct, away_pct — **remove top_score + top_score_n** (useless with 3-5 members, top_score_n almost always = 1) |
| `dist_global` | ✅ keep + extend | Per game. Fields: n, home_pct, draw_pct, away_pct, exact_hits, top_score, top_score_n, **+top_score_tied**, **+group_on_top_score_n** |
| `member_preds[]` | ❌ **REMOVED** | Moved to predictions[] per-member view |

**dist_global field meanings (per game):**
- `top_score` — most commonly predicted exact scoreline globally for THIS game (e.g. "1-0")
- `top_score_n` — how many users globally predicted it
- `top_score_tied` — `true` if another scoreline shares the same vote count (field unreliable when true)
- `group_on_top_score` — list of group member usernames who predicted the same exact score as the global top_score. Empty array `[]` if none.

**Prompt rule:** *"Use top_score only when top_score_n ≥ 2 AND top_score_tied is false. If group_on_top_score is non-empty, name the member(s) who predicted it."*

**v11 games[] example (after changes) for Spain 3-0 Morocco:**
```json
{
  "match": "Spain 3-0 Morocco",
  "home_team": "Spain", "away_team": "Morocco",
  "home_score": 3, "away_score": 0, "result": "home_win",
  "phase_label": "Group Stage",
  "group_exact_n": 1, "global_exact_n": 1,
  "group_upset": false, "global_upset": false,
  "scorers": null,
  "dist_group": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0 },
  "dist_global": {
    "n": 20, "home_pct": 67, "draw_pct": 20, "away_pct": 13,
    "exact_hits": 1,
    "top_score": "1-0", "top_score_n": 5,
    "top_score_tied": false,
    "group_on_top_score": []
  }
}
```

`result` values: `"home_win"` / `"draw"` / `"away_win"` — explicit, no parsing needed.

**Duplication note:** `global_exact_n` = `dist_global.exact_hits` — keep both. Top-level makes the group vs global comparison obvious; inside dist_global preserves context.

---

### predictions[]

**What it is:** Each member's predictions across today's games with points earned.

**Real example:**
```json
[
  {
    "user": "alice_wc", "today_pts": 3,
    "preds": [
      { "game": "Spain 3-0 Morocco",   "pred": "3-0", "pts": 3, "auto": false },
      { "game": "France 0-0 Germany",  "pred": "1-0", "pts": 0, "auto": false }
    ]
  },
  {
    "user": "bob_wc", "today_pts": 4,
    "preds": [
      { "game": "Spain 3-0 Morocco",  "pred": "2-0", "pts": 1, "auto": false },
      { "game": "France 0-0 Germany", "pred": "0-0", "pts": 3, "auto": false }
    ]
  },
  {
    "user": "carol_wc", "today_pts": 0,
    "preds": [
      { "game": "Spain 3-0 Morocco",  "pred": "1-1", "pts": 0, "auto": true },
      { "game": "France 0-0 Germany", "pred": "2-1", "pts": 0, "auto": true }
    ]
  }
]
```

**Field decisions:**

| Field | Keep / Change | Reason |
|---|---|---|
| `user` | ✅ keep | |
| `today_pts` | ✅ keep | Per-member today total |
| `preds[].game` | ✅ keep | Match string with result e.g. "Spain 3-0 Morocco" |
| `preds[].result` | ✅ **ADD** | Actual outcome: `"home_win"/"draw"/"away_win"` |
| `preds[].pred` | ✅ keep | User's predicted scoreline e.g. "3-0" |
| `preds[].pred_result` | ✅ **ADD** | Direction of user's prediction: `"home_win"/"draw"/"away_win"` |
| `preds[].pts` | ✅ keep | Points earned: 0, 1, or 3 |
| `preds[].exact` | ✅ **ADD** | `true` if pts=3 |
| `preds[].auto` | ✅ keep | `true` if system-generated |

**v11 example:**
```json
{ "game": "Spain 3-0 Morocco",  "result": "home_win", "pred": "3-0", "pred_result": "home_win", "pts": 3, "exact": true,  "auto": false }
{ "game": "France 0-0 Germany", "result": "draw",     "pred": "1-0", "pred_result": "home_win", "pts": 0, "exact": false, "auto": false }
```

AI sees immediately: Alice predicted France to win (1-0) but result was draw — wrong direction, 0pts. No parsing needed.

Used for P3 worst-prediction lookup and P5 game duel.

---

### picks[]

**What it is:** Each member's champion and top-scorer picks for the tournament.

**Real example (WC-style — all set):**
```json
[
  { "user": "alice_wc", "champion": "Spain",  "top_scorer": "Álvaro Morata",  "scorer_goals_today": null },
  { "user": "bob_wc",   "champion": "France", "top_scorer": "Kylian Mbappé",  "scorer_goals_today": null },
  { "user": "carol_wc", "champion": "Brazil", "top_scorer": "Vinicius Jr",    "scorer_goals_today": null }
]
```

**Test/league game example (all null — omit entirely):**
```json
[ { "user": "bob_wc", "champion": null, "top_scorer": null, "scorer_goals_today": null } ]
```

**Field decisions:**

| Field | Keep / Change | Reason |
|---|---|---|
| `champion` | ✅ keep when set | Best rivalry fuel |
| `champion_played_today` | ✅ **ADD** | `true/false` — AI doesn't have to scan games[] |
| `champion_result` | ✅ **ADD** | `"win"/"draw"/"loss"` — only present when `champion_played_today=true` |
| `top_scorer` | ✅ keep when set | "your top scorer scored" = immediate, personal humor |
| `scorer_goals_today` | ✅ keep | `null`=stats not ready, `0`=played no goal, `1+`=scored |
| `scorer_total_goals` | ✅ **ADD** | Total tournament goals by this scorer so far — null if stats not ready |
| `scorer_tournament_rank` | ✅ **ADD** | Current rank in top scorer standings — null if stats not ready |
| `picks[]` when all null | ❌ **omit entirely** | Saves ~100 tokens, removes confusion for test/league games |

**AVAILABLE DATA description to add in prompt:**
```
picks[].scorer_goals_today      = goals scored today by this user's top scorer pick.
  null = stats not yet available.  0 = played, did not score.  1+ = scored today.
picks[].scorer_total_goals      = total tournament goals by this scorer so far (null if stats not ready)
picks[].scorer_tournament_rank  = current rank in top scorer standings (1 = leading scorer)
```

**v11 example:**
```json
[
  {"user":"alice_wc","champion":"Spain","champion_played_today":true,"champion_result":"win","top_scorer":"Álvaro Morata","scorer_goals_today":null},
  {"user":"bob_wc",  "champion":"France","champion_played_today":true,"champion_result":"draw","top_scorer":"Kylian Mbappé","scorer_goals_today":null},
  {"user":"carol_wc","champion":"Brazil","champion_played_today":false,"top_scorer":"Vinicius Jr","scorer_goals_today":null}
]
```

**Prompt change:** Replace *"picks are bonus ammo, use at most twice"* with:
*"Picks are PRIMARY rivalry fuel. If a member's champion played today, mention it — winning champion = suspicious assistance, losing/drawing champion = pressure. If scorer_goals_today > 0, it is outside help. If = 0, the top scorer let them down. These must appear in P1 or P3, not buried."*

---

## Complete v11 Payload Example — The Legends, 2026-06-15

Full JSON sent to all 3 agents after all payload changes applied:

**Complete payload — 5 sections: leaderboard, today, games, predictions, picks**

```json
{
  "group": "The Legends",
  "date": "2026-06-15",

  "leaderboard": [
    { "user": "bob_wc",   "global_rank": 1, "group_rank": 1, "total_pts": 4, "total_exact": 1, "today_exact": 1, "today_pts": 4, "streak": 2  },
    { "user": "alice_wc", "global_rank": 2, "group_rank": 2, "total_pts": 3, "total_exact": 1, "today_exact": 1, "today_pts": 3, "streak": -1 },
    { "user": "carol_wc", "global_rank": 5, "group_rank": 3, "total_pts": 0, "total_exact": 0, "today_exact": 0, "today_pts": 0, "streak": -2 }
  ],

  "today": {
    "global_top": [
      { "user": "bob_wc",   "pts": 4, "in_group": true },
      { "user": "alice_wc", "pts": 3, "in_group": true }
    ],
    "global_zero": [
      { "user": "carol_wc", "all_auto": true, "in_group": true }
    ]
  },

  "games": [
    {
      "match": "UEFA PO-B 1-0 Tunisia",
      "home_team": "UEFA PO-B", "away_team": "Tunisia",
      "home_score": 1, "away_score": 0, "result": "home_win",
      "phase_label": "Group Stage",
      "group_exact_n": 0, "global_exact_n": 0,
      "group_upset": false, "global_upset": false,
      "scorers": null, "dist_group": null, "dist_global": null
    },
    {
      "match": "Spain 3-0 Morocco",
      "home_team": "Spain", "away_team": "Morocco",
      "home_score": 3, "away_score": 0, "result": "home_win",
      "phase_label": "Group Stage",
      "group_exact_n": 1, "global_exact_n": 1,
      "group_upset": false, "global_upset": false,
      "scorers": null,
      "dist_group": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0 },
      "dist_global": { "n": 20, "home_pct": 67, "draw_pct": 20, "away_pct": 13, "exact_hits": 1, "top_score": "1-0", "top_score_n": 5, "top_score_tied": false, "group_on_top_score": [] }
    },
    {
      "match": "France 0-0 Germany",
      "home_team": "France", "away_team": "Germany",
      "home_score": 0, "away_score": 0, "result": "draw",
      "phase_label": "Group Stage",
      "group_exact_n": 1, "global_exact_n": 1,
      "group_upset": true, "global_upset": true,
      "scorers": null,
      "dist_group": { "n": 3, "home_pct": 67, "draw_pct": 33, "away_pct": 0 },
      "dist_global": { "n": 20, "home_pct": 65, "draw_pct": 25, "away_pct": 10, "exact_hits": 1, "top_score": "0-0", "top_score_n": 3, "top_score_tied": false, "group_on_top_score": ["bob_wc"] }
    }
  ],

  "predictions": [
    {
      "user": "alice_wc", "today_pts": 3,
      "preds": [
        { "game": "Spain 3-0 Morocco",  "result": "home_win", "pred": "3-0", "pred_result": "home_win", "pts": 3, "exact": true,  "auto": false },
        { "game": "France 0-0 Germany", "result": "draw",     "pred": "1-0", "pred_result": "home_win", "pts": 0, "exact": false, "auto": false }
      ]
    },
    {
      "user": "bob_wc", "today_pts": 4,
      "preds": [
        { "game": "Spain 3-0 Morocco",  "result": "home_win", "pred": "2-0", "pred_result": "home_win", "pts": 1, "exact": false, "auto": false },
        { "game": "France 0-0 Germany", "result": "draw",     "pred": "0-0", "pred_result": "draw",     "pts": 3, "exact": true,  "auto": false }
      ]
    },
    {
      "user": "carol_wc", "today_pts": 0,
      "preds": [
        { "game": "Spain 3-0 Morocco",  "result": "home_win", "pred": "1-1", "pred_result": "draw",     "pts": 0, "exact": false, "auto": true },
        { "game": "France 0-0 Germany", "result": "draw",     "pred": "2-1", "pred_result": "home_win", "pts": 0, "exact": false, "auto": true }
      ]
    }
  ],

  "picks": [
    {
      "user": "alice_wc",
      "champion": "Spain", "champion_played_today": true, "champion_result": "win",
      "top_scorer": "Álvaro Morata",
      "scorer_goals_today": null, "scorer_total_goals": null, "scorer_tournament_rank": null
    },
    {
      "user": "bob_wc",
      "champion": "France", "champion_played_today": true, "champion_result": "draw",
      "top_scorer": "Kylian Mbappé",
      "scorer_goals_today": null, "scorer_total_goals": null, "scorer_tournament_rank": null
    },
    {
      "user": "carol_wc",
      "champion": "Brazil", "champion_played_today": false,
      "top_scorer": "Vinicius Jr",
      "scorer_goals_today": null, "scorer_total_goals": null, "scorer_tournament_rank": null
    }
  ]
}
```

**When stats are ready (scorer scored today), picks[] example:**
```json
{
  "user": "alice_wc",
  "champion": "Spain", "champion_played_today": true, "champion_result": "win",
  "top_scorer": "Álvaro Morata",
  "scorer_goals_today": 2, "scorer_total_goals": 3, "scorer_tournament_rank": 1
}
```

---

## Part 2: v10 Strengths and Weaknesses

### Concrete example: The Legends, 2026-06-15

**Input summary:**
- Bob: rank 1, 4pts today (exact: France 0-0 Germany), champion=France, top_scorer=Mbappé
- Alice: rank 2, 3pts today (exact: Spain 3-0 Morocco), champion=**Spain** (Spain played today and WON 3-0)
- Carol: rank 3, 0pts, all auto, streak=-2

**Generated summary:**
```
Bob, 4 points - top of the whole competition today, not just this group.
You scraped through with a 0-0 prediction, and that's some real luck hiding behind your picks.

Alice, only 1 point behind Bob - close enough to sniff victory,
but don't choke on your own delusions again.

Carol, 0 today - one of three across all competing groups, and the other two
had the guts to pick their own failures. The surprise model had to file 1-1
for a Spain 3-0, and that's just embarrassing.

Your competitors nailed the France draw, while this group missed it -
is this a group of bad guessers?

Spain 3-0 Morocco: Alice 3-0 (3pts), Bob 2-0 (1pt), Carol 1-1 auto (0pts).

Tomorrow's danger: Carol, because three straight losses with the surprise model
filing your picks is not a strategy.
```

---

### ✅ v10 STRENGTHS

| Strength | Evidence from example |
|---|---|
| P1 global context used correctly | "top of the whole competition today, not just this group" — uses global_top ✓ |
| P2 exact gap number | "only 1 point behind Bob" — 4-3=1 ✓ |
| P3 specific prediction named | "file 1-1 for a Spain 3-0" — Carol's pred was exactly 1-1 ✓ |
| P5 correct game and correct preds | All three preds verified: Alice 3-0 (3pts), Bob 2-0 (1pt), Carol 1-1 auto (0pts) ✓ |
| Structure mostly followed | 6 paragraphs, P6 starts with "Tomorrow's danger:" ✓ |
| Auto-predict shame works | "the other two had the guts to pick their own failures" — good roast of auto-picks |

---

### ❌ v10 WEAKNESSES

| Weakness | Evidence | Competition impact |
|---|---|---|
| **P4 copied verbatim 86%** | "is this a group of bad guessers?" — every group every night reads the same P4 | Friends stop reading after a few nights. The point of P4 is group identity — this destroys it. |
| **Picks ignored as rivalry fuel** | Alice predicted Spain 3-0 EXACTLY and her champion is Spain. Bob's champion is France who drew. Zero mention of either in P1/P2. This is the single best joke in the data and v10 skips it entirely. | Picks are the #1 source of personal competition. Missing them wastes the WC's biggest humor driver. |
| **P6 streak wrong** | "three straight losses" — Carol's streak=-2, should be "two" | Accuracy error. Destroys trust if friends notice. |
| **P1 backhanded compliment is generic** | "real luck hiding behind your picks" — not specific to Bob's data | Should say something about Bob's champion (France) drawing 0-0 today — suspicious or appropriate? |
| **P2 is a roast, not a P2** | "don't choke on your own delusions again" — invented narrative, Alice is only 1pt behind | P2 should be pure pressure/rivalry framing. "Delusions" is invented. |
| **4 games with null data ignored** | UEFA PO-B, Spain 1-0 Cape Verde, Belgium, Saudi Arabia all have null dist_group — ignored entirely | Fine for now, but with WC all 8 games will have data. P4 needs to pick the best angle. |

---

### Root cause of each weakness

```
P4 verbatim → Prompt uses "bad guessers?" in its own P4 example. AI copies it.
Picks ignored → Prompt treats picks as "bonus ammo" and says use them "at most twice."
               The real instruction should be: "if picks are set, they are your PRIMARY rivalry tool."
P6 streak wrong → `streak` field exists in payload. Prompt says verify it. AI doesn't verify.
Generic P1/P2 → When data is thin on variety, AI fills with invented narrative ("delusions")
               instead of picking a specific data point.
```

---

## Part 3: Three Agents — Design Based on Weaknesses

All 3 agents share the same **base rules** (facts only, 6 paragraphs, hard bans, P6 format, quality check).
All 3 receive the **same improved payload** (today_exact, member_preds, no noise fields).
Each agent addresses different v10 weaknesses as its primary focus.

---

### Agent 1 — v11-main (`agent_slot: 'main'`)
**Inherits v10 structure. Fixes the data bugs. Keeps what works.**

Key changes from v10:
1. Payload uses `today_exact` + `total_exact` (exact-score hallucination fix)
2. P5 uses `games[N].member_preds[]` directly (wrong-game fix)
3. P4 example phrase removed — replaced with: *"Pick ONE game. Compare dist_group vs dist_global. The angle must come from the actual numbers, not a generic label."*
4. New PICKS RULE: *"When champion or top_scorer is set, treat it as primary ammunition, not bonus. If a member's champion played today, that goes in P1 or P3, always."*
5. P6 streak enforcement: *"The streak number in your sentence must equal abs(leaderboard[member].streak). Check before writing."*

Parameters: `temperature 0.6, max_tokens 400, seed 42` (same as v10)

---

### Agent 2 — v12 (`agent_slot: 'candidate_2'`)
**Picks-maximizer — same structure as v11, prompt tuned to extract maximum rivalry from champion + scorer data**

**Core idea:** Same 6-paragraph format as v11. The difference is that v12's prompt treats picks as the #1 priority and puts the picks instruction at the top (not buried). It gives explicit examples of picks-driven P1 and P3. Higher temperature generates more creative angles from picks material.

**Primary weakness this targets:** Picks ignored as rivalry fuel — v10 summary never mentioned Alice's Spain champion despite Spain winning. v12 prompt is built around making that impossible to skip.

**Format:** Identical to v11 (6 paragraphs, P1–P6, same bans, same P6 format). No structural change.

**Key prompt differences from v11:**
1. **Picks instruction is first** in the prompt, before everything else — not buried under structure rules
2. **Explicit example:** "If a member's champion won today AND they predicted the game right → P1 must call this out. Example: 'Alice predicted Spain 3-0 exactly — and Spain is Alice's champion. Either Alice has inside information or the tournament is already over.'"
3. **Champion drew / lost framing:** "If a member's champion drew or lost, this is pressure. Name it explicitly and in P1 or P3."
4. **Scorer goals when >0:** "scorer_goals_today > 0 means outside assistance. Name the player, name the goal count. This goes in P1 or P3."
5. P4 and P5 instruction same as v11, but P4 is secondary to picks — if picks data is rich, picks take P1 AND P3.

**Hard bans:** "journey" / "remarkable" / "incredible" / "exciting" / generic group labels / pronouns

**Example output using The Legends 2026-06-15 (picks-first angle):**
```
Bob leads with 4 points — and got there by predicting France 0-0 exactly, which is also Bob's champion team. Drawing on matchday 1 is not the statement opener Bob wanted.

Alice is 1 point behind. Alice predicted Spain 3-0 exactly. Alice's champion is Spain, who just won their opener 3-0. Either Alice is a genius or Alice has information nobody else has.

Carol got 0 today, all auto. Champion Brazil didn't play. The algorithm predicted 1-1 for a Spain 3-0.

65% of all groups predicted France to win today. Bob went against the world and was right. Suspicious.

Spain 3-0 Morocco: Alice 3-0 (3pts), Bob 2-0 (1pt), Carol 1-1 auto (0pts).

Tomorrow's danger: Carol — two consecutive losses with auto-picks and a champion yet to play a game.
```

**Prompt key rules section (what goes in DB):**
```
PICKS RULE — READ FIRST:
Picks are your primary rivalry weapon. Before writing anything else, check:
- Did any member's champion play today? (champion_played_today=true)
  → YES: this member gets a picks mention in P1 or P3. No exceptions.
  → champion won = suspicious assistance or genius. Champion drew/lost = pressure building.
- Did any member's top scorer score today? (scorer_goals_today > 0)
  → YES: name the player and the goal count. Goes in P1 or P3.
If picks data is rich, picks drive both P1 AND P3.

STRUCTURE (6 paragraphs, same as always):
P1: Leader. Global rank if top today. Champion result if leader's champion played.
P2: 2nd place gap. Exact point gap required. Champion context if 2nd place's champion played.
P3: Worst performer. Auto-preds flag. Specific wrong scoreline.
P4: Group context — use dist_group or dist_global for one game. Unique angle from numbers.
P5: Per-game prediction breakdown for the most interesting game.
P6: "Tomorrow's danger: [name] — [reason]." Streak must = abs(streak).

RULES:
- No pronouns. No invented facts.
- Streak number must equal abs(leaderboard[member].streak) exactly.
- P4 angle must come from the numbers — no generic labels.
- Hard bans: journey / remarkable / incredible / exciting.
```

Parameters: `temperature 0.5, max_tokens 400, seed 43`

---

### Agent 3 — v13 (`agent_slot: 'candidate_3'`)
**Uniqueness-enforcer — same structure as v11, prompt tuned to prevent P4 verbatim repetition and generic openers**

**Core idea:** Same 6-paragraph format as v11. The difference is that v13's prompt aggressively fights the two generic-output weaknesses: P4 always outputs the same phrase ("is this a group of bad guessers?") and P1/P2 use invented narrative instead of specific data. v13 achieves this by banning generic P4 phrases explicitly and requiring a data anchor (specific number or scoreline) in the first sentence of every paragraph.

**Primary weakness this targets:** P4 verbatim 86% + generic P1/P2 invented narrative — v10 fills thin data moments with generic phrases. v13 forces every paragraph to open with a data fact.

**Format:** Identical to v11 (6 paragraphs, P1–P6, same bans, same P6 format). No structural change.

**Key prompt differences from v11:**
1. **P4 explicit ban list:** "FORBIDDEN P4 phrases: 'is this a group of bad guessers', 'are you all bad at this', 'what is going on with this group', or any variant. P4 must pick ONE game, name ONE number from dist_group or dist_global, and draw ONE specific conclusion."
2. **Opening anchor rule:** "The first sentence of every paragraph must contain at least one specific fact from the payload: a scoreline, a point count, a percentage, a player name, or a username. No paragraph may open with a general observation."
3. **Invented narrative ban:** "P2 may not contain invented character labels ('delusions', 'arrogance', 'overconfidence') unless that member has a negative streak ≥ 2 AND their prediction was wrong. Roast only what the data supports."
4. **P4 uniqueness check:** "Before writing P4, identify which game had the most interesting dist_group vs dist_global divergence, or the highest group_upset probability. Name that game and the specific percentage. This is your P4 angle."
5. Picks rule same as v11 (in P1 or P3 when champion played) — not the primary focus here.

**Hard bans:** "journey" / "remarkable" / "incredible" / "exciting" / generic group labels / pronouns / P4 template phrases (listed above)

**Example output using The Legends 2026-06-15 (uniqueness-focused angle):**
```
Bob leads with 4 points — top of the competition globally today, not just in this group.

Alice is exactly 1 point behind. Alice predicted Spain 3-0 exactly and her champion Spain won the opener. Bob predicted France 0-0 exactly and his champion France drew. One of these facts should make Alice feel better and one should make Bob nervous.

Carol got 0 today. All auto. The algorithm predicted 1-1 for Spain 3-0 and 2-1 for France 0-0. Two games, two wrong outcomes, two wrong scorelines.

France 0-0 was predicted as a home win by 67% of all users globally. This group had 2 out of 3 going France — same mistake as the majority. Bob was the outlier.

Spain 3-0 Morocco: Alice 3-0 (3pts), Bob 2-0 (1pt), Carol 1-1 auto (0pts).

Tomorrow's danger: Carol — two consecutive wrong outcomes and the auto-predict system is not improving the record.
```

**Prompt key rules section (what goes in DB):**
```
UNIQUENESS RULE — READ FIRST:
Every paragraph must open with a specific fact from the payload.
No paragraph may open with a general observation about the group.
Allowed openers: a username + number, a scoreline, a percentage, a player name.
Forbidden openers: "Today was...", "This group...", "It was a tough day...", or any abstract framing.

P4 RULE:
Pick ONE game. Find ONE angle from dist_group or dist_global numbers.
FORBIDDEN P4 phrases: "is this a group of bad guessers" / "are you all bad at this" /
"what is going on with this group" / or any variant. These are banned.
Name the game, name the percentage or count, draw a specific conclusion.

STRUCTURE (6 paragraphs):
P1: Leader. Global context if in global_top. Exact points.
P2: 2nd place. Exact gap. Champion context if champion played.
P3: Worst performer. Auto-preds flag. Specific wrong scoreline.
P4: Group vs. data angle (dist_group or dist_global). Must be specific to one game. No generic labels.
P5: Per-game prediction breakdown for the most interesting game.
P6: "Tomorrow's danger: [name] — [reason]." Streak must = abs(streak).

RULES:
- No pronouns. No invented character labels (no "arrogance", "delusions", etc. without data support).
- Streak number must equal abs(leaderboard[member].streak) exactly.
- Picks: if champion_played_today=true for any member, mention in P1 or P2.
- Hard bans: journey / remarkable / incredible / exciting.
```

Parameters: `temperature 0.4, max_tokens 400, seed 44`

---

## Part 4: What the Ideal Summary Looks Like

Using The Legends 2026-06-15 real data — this is what we want all 3 agents competing to produce:

**The data opportunity that v10 missed entirely:**
- Alice: champion=Spain, predicted Spain 3-0 Morocco EXACTLY → 3pts, champion won opener
- Bob: champion=France, predicted France 0-0 Germany EXACTLY → 4pts total, champion drew
- Carol: champion=Brazil (didn't play), all auto, 0pts

**An ideal Agent 2 (punchy) version:**
```
Bob leads with 4 points, including an exact France 0-0. His champion drew on
matchday 1. Suspicious timing.

Alice is 1 point behind and her champion Spain just crushed Morocco 3-0 — which
Alice also predicted exactly. Either Alice is a genius or cheating.

Carol: 0 points, all auto, champion Brazil nowhere near the pitch. The model
picked 1-1 for a 3-0. Three straight failures and counting.

Tomorrow's danger: Carol — because at some point the auto-picks run out of excuses.
```

**Why this is better:** Every line is specific to that group's data. Friends reading this will immediately think about Alice's Spain pick and wonder if she knew something. That's group competition.

**An ideal Agent 3 (uniqueness-enforcer) version:**
```
Bob leads with 4 points — top of the competition globally today, not just in this group.

Alice is exactly 1 point behind. Alice predicted Spain 3-0 exactly and her champion Spain won the opener. Bob predicted France 0-0 exactly and his champion France drew. One of these facts should make Alice feel better and one should make Bob nervous.

Carol got 0 today. All auto. The algorithm predicted 1-1 for Spain 3-0 and 2-1 for France 0-0. Two games, two wrong outcomes, two wrong scorelines.

France 0-0 was predicted as a home win by 67% of all users globally. This group had 2 out of 3 going France — same mistake as the majority. Bob was the outlier.

Spain 3-0 Morocco: Alice 3-0 (3pts), Bob 2-0 (1pt), Carol 1-1 auto (0pts).

Tomorrow's danger: Carol — two consecutive wrong outcomes and the auto-predict system is not improving the record.
```

**Why this is better:** Every paragraph opens with a number or scoreline — no generic framing. P4 is specific to France 0-0 with an actual percentage (67%), not a template phrase.

---

## Part 5: Judge Scoring Weights

All 3 candidates use the same 6-paragraph format and receive the same payload. The judge scores them on 4 shared dimensions.

| Dimension | Weight | What the judge checks |
|---|---|---|
| **Accuracy** | **45%** | No today_exact / total_exact confusion; streak number = abs(streak); no invented narrative; specific scorelines named correctly; champion result correct |
| **Humor & variety** | **30%** | Picks used as rivalry fuel when champion played; specific scoreline named for worst performer; P4 has unique angle from data (not a template phrase); personal not generic |
| **Compliance** | **15%** | No banned words (journey/remarkable/incredible/exciting); no pronouns; no invented character labels without data support; facts sourced from payload |
| **Structure** | **10%** | 6 paragraphs; P6 starts "Tomorrow's danger:"; exact point gap between rank 1 and rank 2 appears somewhere; streak number referenced in P6 |

Hard floor: accuracy score ≤ 3 → disqualified regardless of other scores.

**Why 45/30 not 50/25:** The v11 payload improvements make accuracy failures rare across all 3 agents. When all 3 are approximately equal on accuracy, humor is the real differentiator — and raising it to 30% lets the judge reward the summary friends will actually share, not just the most factually safe one.

**Judge model:** `gpt-4o` | `temperature 0.1` | `max_tokens 200` | `seed 1`

**Judge receives:** All 3 candidate texts labeled as v11/v12/v13, plus the original payload JSON. Judge scores each independently, then picks winner and writes one sentence of reasoning.

---

## Part 6: DB Schema

### New table: `ai_judge_runs`
```sql
CREATE TABLE ai_judge_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                uuid NOT NULL REFERENCES groups(id),
  date                    date NOT NULL,
  candidates              jsonb NOT NULL,
  -- per agent: { agent, prompt_version_id, content, model,
  --   prompt_tokens, completion_tokens, temperature, seed, char_len,
  --   accuracy_score, humor_score, compliance_score, structure_score,
  --   weighted_total, judge_notes }
  winner_agent            int NOT NULL CHECK (winner_agent IN (1,2,3)),
  judge_reasoning         text,
  judge_model             text NOT NULL,
  judge_prompt_tokens     int,
  judge_completion_tokens int,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, date)
);
ALTER TABLE ai_judge_runs ENABLE ROW LEVEL SECURITY;
```

### Changes to existing tables
```sql
-- prompt_versions: identify which slot each prompt fills
ALTER TABLE prompt_versions
  ADD COLUMN agent_slot text CHECK (agent_slot IN ('main','candidate_2','candidate_3'));
UPDATE prompt_versions SET agent_slot = 'main'
  WHERE id = 'e7593ac1-0290-4cfb-95c3-7d9c38b3a925'; -- v10

-- ai_summaries: link back to judge run and record which agent won
ALTER TABLE ai_summaries
  ADD COLUMN judge_run_id uuid REFERENCES ai_judge_runs(id),
  ADD COLUMN winner_agent int CHECK (winner_agent IN (1,2,3));
```

---

## Part 7: Build Order

```
Step 1 — Migration 20260504000062_judge_llm.sql
  · agent_slot on prompt_versions
  · ai_judge_runs table
  · ai_summaries: judge_run_id + winner_agent
  · fn_daily_admin_digest: add judge stats query

Step 2 — buildGroupPayload() in nightly-summary/index.ts

  leaderboard[]:
  · Rename rank → group_rank
  · Add global_rank (from globalRankByUserGroup computed in EF — same basis as display_data)
  · Rename exact → total_exact
  · Add today_exact (count of preds with pts=3 today, computed from predictions[])

  games[]:
  · Add home_team, away_team (split from match string)
  · Add home_score, away_score (split from match string)
  · Add result ("home_win"/"draw"/"away_win" — computed from scores)
  · Add global_exact_n (= dist_global.exact_hits, also keep inside dist_global)
  · Rename upset → group_upset
  · Add global_upset (based on dist_global majority vs actual result)
  · dist_group: keep n, home_pct, draw_pct, away_pct — remove top_score + top_score_n
  · dist_global: keep all + add top_score_tied (bool) + group_on_top_score_n (int)
  · Keep phase_label
  · No member_preds[] — per-game predictions live in predictions[].preds[]

  predictions[]:
  · Add preds[].result ("home_win"/"draw"/"away_win" — actual game outcome)
  · Add preds[].pred_result ("home_win"/"draw"/"away_win" — direction of user's prediction)
  · Add preds[].exact (true if pts=3)

  picks[]:
  · Add champion_played_today (true/false)
  · Add champion_result ("win"/"draw"/"loss" — only when champion_played_today=true)
  · Add scorer_total_goals (total tournament goals by this scorer — null if stats not ready)
  · Add scorer_tournament_rank (current rank in top scorer standings — null if stats not ready)
  · Omit picks[] key entirely when all champion+top_scorer are null

Step 3 — Write prompt rows in DB
  · Update v10 → v11-main (data fixes + picks rule + P4 fix + P6 streak enforcement)
  · Insert v11-punchy (candidate_2: 80 words, picks-led, high temp)
  · Insert v11-narrative (candidate_3: picks-storyline, match-drama-first)

Step 4 — nightly-summary/index.ts v17
  · Load 3 prompts by agent_slot
  · buildGroupPayload() with all fixes
  · Promise.all([agent1, agent2, agent3]) parallel
  · callJudge() → scores + winner
  · Insert ai_judge_runs
  · Upsert winner → ai_summaries (+ judge_run_id, winner_agent)
  · Update display_data (global ranks) — identical to v16

Step 5 — notify-admin/index.ts
  · Add judge run stats to daily digest

Step 6 — /verify-feature
```

## Critical Files

| File | Change |
|---|---|
| `supabase/migrations/20260504000062_judge_llm.sql` | New — M62 |
| `supabase/functions/nightly-summary/index.ts` | v16 → v17 |
| `supabase/functions/notify-admin/index.ts` | +judge stats |
| DB `fn_daily_admin_digest` | via migration |
| DB `prompt_versions` (3 rows) | via migration |

## Verification
1. `SELECT agent_slot, version_tag FROM prompt_versions WHERE agent_slot IS NOT NULL` → 3 rows
2. Manual EF trigger → `ai_judge_runs` row created with 3 candidates + scores
3. `ai_summaries` row has `judge_run_id` + `winner_agent` non-null
4. Winning candidate references `today_exact`, not `total_exact`, in text
5. P5 predictions match `member_preds[]` for that game
6. AiFeed.jsx loads unchanged — `content` field identical
