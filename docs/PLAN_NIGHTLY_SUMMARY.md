> File ID: `file_00000000cf787243b7e7858ffc576c57`

# Plan: Nightly-Summary Edge Function + Prompt Versions Table

## Context

All supporting DB infrastructure is already deployed (migrations 1–52): `ai_summaries`, `failed_summaries`, `get_group_summary_data()` RPC, `fn_schedule_ai_summaries()` scheduler (M44 — currently 110min, needs update to 150min), error-handling docs (A–D). The EF itself does not exist yet. Using **OpenAI gpt-4o-mini**. `OPENAI_API_KEY` is already set as a Supabase secret ✅.

---

## Step 1 — Create GitHub Branch

```bash
git checkout -b feature/nightly-summary
git push -u origin feature/nightly-summary
```

---

## Step 2 — Migration 53

**File:** `supabase/migrations/20260410000053_prompt_versions.sql`

Contains two changes:
1. `prompt_versions` table (new)
2. Update `fn_schedule_ai_summaries()` to fire at **last kickoff + 150 minutes** (was 110)

### 2a — `prompt_versions` table

Manages prompt lifecycle: draft → tested → active. Only one version active at a time. EF reads active prompt at runtime — prompts can be iterated without redeploying the function.

```sql
CREATE TABLE public.prompt_versions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version_tag           text        NOT NULL UNIQUE,         -- 'v1', 'v2', 'v1.1'
  description           text,                                -- what changed vs previous
  system_prompt         text        NOT NULL,                -- system role message to GPT
  user_prompt_template  text        NOT NULL,                -- user message; {{group_json}} placeholder
  is_active             boolean     NOT NULL DEFAULT false,  -- only one row true at a time
  -- Test run (written back by EF when called in test mode with version_id)
  test_input            jsonb,                               -- JSON payload sent to GPT in test
  test_output           text,                                -- GPT raw response from test run
  test_model            text,
  test_tokens_in        int,
  test_tokens_out       int,
  tested_at             timestamptz,
  -- Lifecycle
  created_at            timestamptz NOT NULL DEFAULT now(),
  activated_at          timestamptz,
  deprecated_at         timestamptz
);

-- Only one active version at a time
CREATE UNIQUE INDEX prompt_versions_active_idx
  ON public.prompt_versions (is_active) WHERE is_active = true;

-- Auto-manage activated_at / deprecated_at
CREATE OR REPLACE FUNCTION fn_manage_prompt_activation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = true AND (OLD IS NULL OR OLD.is_active = false) THEN
    NEW.activated_at = now();
    UPDATE public.prompt_versions
      SET is_active = false, deprecated_at = now()
      WHERE is_active = true AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prompt_activation
  BEFORE UPDATE ON public.prompt_versions
  FOR EACH ROW EXECUTE FUNCTION fn_manage_prompt_activation();

-- RLS: service role only
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON public.prompt_versions
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

### 2b — Add `prompt_version_id` to `ai_summaries`

```sql
ALTER TABLE public.ai_summaries
  ADD COLUMN prompt_version_id uuid
    REFERENCES public.prompt_versions(id) ON DELETE SET NULL;
```

### 2c — Update `fn_schedule_ai_summaries()` to 150 minutes

Replace the `+ interval '110 minutes'` line in the existing function body with `+ interval '150 minutes'`. This is a `CREATE OR REPLACE FUNCTION` in the migration — full function body is rewritten with only that offset changed.

### 2d — Seed v1 prompt (in this migration)

See exact system prompt and template text in Step 4.

```sql
INSERT INTO public.prompt_versions
  (version_tag, description, system_prompt, user_prompt_template, is_active, activated_at)
VALUES (
  'v1',
  'Initial prompt — social banter, compact JSON input',
  '<see Step 4 system prompt>',
  '<see Step 4 user template>',
  true,
  now()
);
```

---

## Step 3 — When the EF Runs

### Trigger

`fn_schedule_ai_summaries()` (M44, updated in M53) registers one pg_cron job per tournament game-day. Each job fires **150 minutes after the last kickoff** on that day.

Why 150 min: covers 90-min game + 30-min ET/pens + buffer for API sync to write scores, stats, and events.

### Hard guard — all games of the day must be finished

```sql
-- Must be 0 (no unfinished games on this date)
SELECT COUNT(*) FROM games
WHERE kick_off_time::date = :date AND score_home IS NULL
```

If > 0 → exit `{ reason: "games_not_finished" }`.

### Soft guard — stats synced?

```sql
SELECT COUNT(*) FROM game_player_stats gps
JOIN games g ON g.id = gps.game_id
WHERE g.kick_off_time::date = :date
```

If 0 → stats not yet synced. Proceed but omit `scorers` and `picks.scorer_goals_today` fields from JSON payload (set to null, note in prompt).

### Groups that qualify

Only groups with **≥3 active (non-inactive) members**. Below threshold: silently skipped, no LLM call, no row written.

```sql
SELECT g.id, g.name FROM groups g
WHERE (SELECT COUNT(*) FROM group_members gm
       WHERE gm.group_id = g.id AND gm.is_inactive = false) >= 3
```

---

## Step 4 — Data Sent to the LLM

### Data sources

| Section | Source |
|---|---|
| Leaderboard + predictions + streaks | `get_group_summary_data(group_id, date)` RPC |
| Global prediction distributions | `get_game_prediction_distribution(game_id)` RPC |
| Group prediction distribution | Computed inline from member predictions |
| Champion picks | `SELECT user_id, team FROM champion_pick WHERE group_id = ?` |
| Top scorer picks | `SELECT user_id, player_name FROM top_scorer_pick WHERE group_id = ?` |
| Goal scorers (per game) | `game_events WHERE event_type='goal' AND game.date = ?` |
| Scorer goals today (for top scorer pick) | Cross-ref `top_scorer_pick.player_name` ↔ `game_events.player_name` |

### Compact JSON payload (sent as `{{group_json}}`)

All data for a group is serialized as a single compact JSON object. The EF builds this from the queries above, then passes it as the `{{group_json}}` placeholder in the user message template.

```json
{
  "group": "The Champions",
  "date": "2026-06-15",

  "leaderboard": [
    {"rank": 1, "user": "alice_wc", "total_pts": 45, "exact": 15, "today_pts": 3, "streak": 2},
    {"rank": 2, "user": "bob_wc",   "total_pts": 38, "exact": 12, "today_pts": 4, "streak": -1},
    {"rank": 3, "user": "carol_wc", "total_pts": 30, "exact": 10, "today_pts": 0, "streak": -3}
  ],

  "today": {
    "top_scorer": {"user": "bob_wc", "pts": 4},
    "zero_pts": [{"user": "carol_wc", "all_auto": true}]
  },

  "games": [
    {
      "match": "Argentina 2-1 Brazil", "phase": "r16",
      "scorers": ["Messi 23'(pen)", "Di Maria 67'", "Neymar 45'(og)"],
      "dist_group":  {"home_pct": 63, "draw_pct": 12, "away_pct": 25, "n": 8},
      "dist_global": {"home_pct": 44, "draw_pct": 18, "away_pct": 38, "n": 104,
                      "top_score": "2-1", "top_score_n": 12, "exact_hits": 3}
    },
    {
      "match": "France 0-0 Germany", "phase": "group_A",
      "scorers": [],
      "dist_group":  {"home_pct": 50, "draw_pct": 25, "away_pct": 25, "n": 8},
      "dist_global": {"home_pct": 55, "draw_pct": 20, "away_pct": 25, "n": 89,
                      "top_score": "1-0", "top_score_n": 15, "exact_hits": 2}
    }
  ],

  "predictions": [
    {
      "user": "alice_wc", "today_pts": 3,
      "preds": [
        {"game": "Argentina 2-1 Brazil", "pred": "2-1", "pts": 3, "auto": false},
        {"game": "France 0-0 Germany",   "pred": "1-0", "pts": 0, "auto": false}
      ]
    },
    {
      "user": "bob_wc", "today_pts": 4,
      "preds": [
        {"game": "Argentina 2-1 Brazil", "pred": "3-1", "pts": 1, "auto": false},
        {"game": "France 0-0 Germany",   "pred": "0-0", "pts": 3, "auto": false}
      ]
    },
    {
      "user": "carol_wc", "today_pts": 0,
      "preds": [
        {"game": "Argentina 2-1 Brazil", "pred": "1-2", "pts": 0, "auto": true},
        {"game": "France 0-0 Germany",   "pred": "2-1", "pts": 0, "auto": true}
      ]
    }
  ],

  "picks": [
    {"user": "alice_wc", "champion": "Argentina", "top_scorer": "Messi",  "scorer_goals_today": 1},
    {"user": "bob_wc",   "champion": "Brazil",    "top_scorer": "Neymar", "scorer_goals_today": 1},
    {"user": "carol_wc", "champion": "France",    "top_scorer": "Mbappe", "scorer_goals_today": 0}
  ]
}
```

**Field notes (for the system prompt to reference):**
- `streak`: positive = win streak (consecutive correct outcomes), negative = loss streak
- `all_auto: true` = user forgot to predict entirely, all picks were system-generated
- `auto: true` on individual pred = that specific game was auto-picked
- `dist_group` vs `dist_global`: group's own split vs all app users
- `scorer_goals_today`: how many goals this user's top scorer pick scored today (0 = silence)

### System prompt (v1)

The system prompt is divided into 5 parts. All 5 parts are concatenated and sent as a single system message.

---

**PART 1 — Role & Audience**
```
ROLE
You are the AI pundit for a private friends' World Cup betting group.

AUDIENCE
Real friends who know each other personally — this summary lands directly in their WhatsApp group chat.
Write like you're in the group. Group-chat energy, not broadcast journalism.
```

---

**PART 2 — JSON Data Guide**
```
DATA
You will receive a JSON object with the following fields:

leaderboard[]
  .user          — username
  .total_pts     — cumulative points in this tournament
  .exact         — number of exact-score predictions
  .today_pts     — points earned today
  .streak        — consecutive correct outcomes (positive) or wrong (negative)

today
  .top_scorer    — user with most points today
  .zero_pts[]
    .all_auto    — true = this user forgot to predict; all picks were system-generated

games[]
  .match         — "Team A score-score Team B"
  .phase         — group_X / r32 / r16 / qf / sf / third / final
  .scorers[]     — goal events: "Player MM'(type)" — pen = penalty, og = own goal
  .dist_group    — this group's prediction split (home_pct / draw_pct / away_pct, n = group size)
  .dist_global   — all app users' split (same fields + top_score, top_score_n, exact_hits)

predictions[]
  .preds[]
    .pred        — predicted scoreline
    .pts         — points earned (3 = exact, 1 = correct outcome, 0 = wrong)
    .auto        — true = this specific pick was system-generated (user forgot this game)

picks[]
  .champion           — team this user picked to win the tournament
  .top_scorer         — player this user picked as tournament top scorer
  .scorer_goals_today — goals scored today by this user's top-scorer pick (0 = silence)
```

---

**PART 3 — Task**
```
TASK
Write a nightly summary of 150–250 words in English.
Flowing paragraphs only — no bullet points, no headers, no lists.
Choose the 3–4 most dramatic story lines from the data. Do not list everything.

Story lines to consider (ranked by dramatic value):
1. Today's top scorer — make them feel like a genius
2. Zero-pointer who forgot to predict (all_auto=true) — comedic public shaming
3. Zero-pointer who did predict but got everything wrong — sympathetic but still a roast
4. Contrarian who beat the group majority — or spectacularly didn't
5. Group vs global split — the group as a collective was wrong (or right) vs the world
6. Long winning or losing streak — legendary or tragicomic
7. Champion pick team won or lost today — weigh in on title hopes
8. Top-scorer pick player scored (or stayed silent) today
9. The most popular exact score that landed

Lead with the most dramatic moment.
Close with a single punchy line about the standings or what's coming next.
```

---

**PART 4 — Tone Rules**
```
TONE
- Savage but never mean-spirited — these are friends
- Specific > generic: use their actual usernames, scores, streaks
- auto-picks are the ultimate crime: treat them as evidence of neglect, not bad luck
- A streak of 3+ losses deserves genuine pity mixed with mockery
- A streak of 3+ wins deserves awe mixed with suspicion
- One match recap word = failure. Focus on the bets, not the football.
- No emojis in the output text
```

---

**PART 5 — Few-Shot Example (zero / auto-pick scenario)**
```
EXAMPLE

Input JSON (abbreviated):
{
  "group": "The Legends",
  "date": "2026-06-16",
  "leaderboard": [
    {"user": "alice_wc", "total_pts": 45, "today_pts": 4, "streak": 3},
    {"user": "bob_wc",   "total_pts": 32, "today_pts": 1, "streak": -3},
    {"user": "carol_wc", "total_pts": 28, "today_pts": 0, "streak": -2}
  ],
  "today": {
    "top_scorer": {"user": "alice_wc", "pts": 4},
    "zero_pts": [{"user": "carol_wc", "all_auto": true}]
  },
  "games": [{
    "match": "Spain 3-0 Morocco", "phase": "r16",
    "scorers": ["Morata 12'", "Yamal 45'", "Pedri 78'"],
    "dist_group": {"home_pct": 70, "draw_pct": 15, "away_pct": 15, "n": 3},
    "dist_global": {"home_pct": 75, "draw_pct": 14, "away_pct": 11,
                    "n": 210, "top_score": "2-0", "top_score_n": 45, "exact_hits": 1}
  }],
  "predictions": [
    {"user": "alice_wc", "today_pts": 4,
     "preds": [{"game": "Spain 3-0 Morocco", "pred": "3-0", "pts": 4, "auto": false}]},
    {"user": "bob_wc",   "today_pts": 1,
     "preds": [{"game": "Spain 3-0 Morocco", "pred": "2-0", "pts": 1, "auto": false}]},
    {"user": "carol_wc", "today_pts": 0,
     "preds": [{"game": "Spain 3-0 Morocco", "pred": "1-1", "pts": 0, "auto": true}]}
  ],
  "picks": [
    {"user": "alice_wc", "champion": "Spain",   "top_scorer": "Morata",   "scorer_goals_today": 1},
    {"user": "bob_wc",   "champion": "France",  "top_scorer": "Mbappe",   "scorer_goals_today": 0},
    {"user": "carol_wc", "champion": "Brazil",  "top_scorer": "Vinicius", "scorer_goals_today": 0}
  ]
}

Expected output:
Alice is officially clairvoyant. Spain 3-0 Morocco — she called it exactly. Not a vague "Spain win"
like the rest of the civilised world predicted, not the crowd-favourite 2-0 — three nil, exact.
Four points, three-game win streak, and her Spain champion pick is marching through the knockouts.
Smug is an understatement. Morata scoring today is just the cherry on top of her very smug cake.

Bob got the result right (Spain, obviously, like 70% of this group) but fluffed the score. One
measly point. Three games without an exact score — the streak is quietly becoming a crisis, Bob.
Mbappe was also a no-show today, which isn't helping the vibes.

Carol, meanwhile, apparently forgot the World Cup was happening. The system auto-picked 1-1 for a
Spanish demolition. She is currently tied with a random number generator and losing on personality.
Zero points, zero input, all auto. Sort yourself out before tomorrow — Brazil won't save you.
```

---

### User message template (v1)

```
Here is today's group data. Write the nightly summary.

{{group_json}}
```

---

## Step 5 — Build `supabase/functions/nightly-summary/index.ts`

### Processing flow

```
REQUEST IN:  POST /nightly-summary
             Authorization: Bearer <service_role_key>
             Body: { "date": "2026-06-15", "version_id"?: "<uuid>" }

1. Auth check → 401 if invalid

2. Parse { date, version_id? }
   If version_id provided → TEST MODE:
     uses that specific prompt version (even if not active)
     writes test_input/test_output back to prompt_versions row

3. Guard A1: any finished games at all?
   IF COUNT(games WHERE date=:date AND score_home IS NOT NULL) = 0
     → return { reason: "no_games_today" }

4. Guard A3: all games of day finished?
   IF COUNT(games WHERE date=:date AND score_home IS NULL) > 0
     → return { reason: "games_not_finished" }

5. Stats ready? (soft check)
   stats_ready = COUNT(game_player_stats WHERE game.date = :date) > 0

6. Get active prompt
   SELECT * FROM prompt_versions
     WHERE id = :version_id OR is_active = true
   ORDER BY activated_at DESC LIMIT 1
   → 500 if none found

7. Get qualifying groups (≥3 active members)

8. Query shared data ONCE for all groups:
   a. Today's games (id, teams, scores, phase)
   b. Goal scorers: game_events WHERE event_type='goal' AND game.date = :date
      (skip if stats_ready = false)
   c. Global dist per game: call get_game_prediction_distribution(game_id) per game

9. For each group (sequential — 2s gap):

   a. Call get_group_summary_data(group_id, date)
      → skip group on error, log, continue

   b. Compute group-level prediction distribution inline:
      For each game, count member predictions → home_pct / draw_pct / away_pct

   c. Query champion_pick and top_scorer_pick for group

   d. Cross-reference picks vs goal scorers → scorer_goals_today per member

   e. Compute today summary: top_scorer (max today_pts), zero_pts list, all_auto flags

   f. Build compact JSON payload (see Step 4 structure)

   g. Render user message: replace {{group_json}} with JSON.stringify(payload)

   h. POST to OpenAI gpt-4o-mini:
      { model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt.system_prompt },
          { role: "user",   content: renderedUserMessage }
        ],
        max_tokens: 400 }

   i. Validate response ≥50 chars
      → retry once after 5s if bad → fallback message if still bad

   j. Upsert to ai_summaries:
      { group_id, date, content, games_count, model: "gpt-4o-mini",
        prompt_tokens, completion_tokens, prompt_version_id }
      onConflict: "group_id,date"
      → on fail: insert to failed_summaries, continue

   k. TEST MODE only: UPDATE prompt_versions SET
        test_input = payload, test_output = content,
        test_model = 'gpt-4o-mini',
        test_tokens_in = promptTokens, test_tokens_out = completionTokens,
        tested_at = now()
      WHERE id = :version_id

10. Timeout guard: after each group, check elapsed.
    If elapsed > 120s → stop, return partial result with warning.

11. Return: { processed: N, skipped: M, errors: [...], elapsed_ms: N }
```

### Error handling

| Code | Condition | Action |
|------|-----------|--------|
| A1 | 0 finished games on date | Exit `no_games_today` |
| A3 | Not all games finished | Exit `games_not_finished` |
| B2/B3 | Group RPC error or empty | Skip group, log, continue |
| C1 | OpenAI timeout / 429 | Retry once after 5s → fallback |
| C2 | Response <50 chars | Retry once → fallback |
| D1 | ai_summaries upsert fail | Retry once → insert to failed_summaries |

Fallback message (C1/C2):
> "Our AI analyst called in sick today (probably still recovering from that last-minute equalizer). Summary coming tomorrow — in the meantime, check the leaderboard and start arguing with your group."

### Key implementation patterns

- `json(data, status)` helper + CORS headers on every response
- `createClient(url, serviceRoleKey)` inside handler (not module scope)
- `OPENAI_API_KEY` ✅ already set → `Deno.env.get('OPENAI_API_KEY')`
- OpenAI SDK: `import OpenAI from 'npm:openai'`
- 2s gap: `await new Promise(r => setTimeout(r, 2000))`
- Reference: `supabase/functions/football-api-sync/index.ts` for EF patterns

---

## Step 6 — Deploy EF

```bash
supabase functions deploy nightly-summary --project-ref ftryuvfdihmhlzvbpfeu
supabase functions list --project-ref ftryuvfdihmhlzvbpfeu   # verify ACTIVE
```

---

## Step 7 — Run `fn_schedule_ai_summaries()` (one-time, after games seeded)

```sql
SELECT fn_schedule_ai_summaries();
-- Creates one pg_cron job per tournament game day
-- Each fires 150min after last kickoff on that day
-- POSTs { "date": "YYYY-MM-DD" } to /nightly-summary
```

---

## Prompt Iteration Workflow

1. `INSERT INTO prompt_versions (version_tag='v2', ..., is_active=false)` — new draft
2. Trigger EF with `{ "date": "...", "version_id": "<v2-uuid>" }` — test mode, results written back
3. Review `test_output` in `prompt_versions` table
4. If satisfied: `UPDATE prompt_versions SET is_active=true WHERE id='<v2-uuid>'` — trigger auto-deprecates v1
5. All future nightly runs use v2; full history preserved

---

## Files to Create / Modify

| File | Action |
|---|---|
| `supabase/migrations/20260410000053_prompt_versions.sql` | CREATE — table + FK + update fn_schedule_ai_summaries to 150min + seed v1 |
| `supabase/functions/nightly-summary/index.ts` | CREATE |
| `supabase/CLAUDE.md` | UPDATE — migration 53 + EF status |
| `memory/edge-function-phase.md` | UPDATE |

---

## Verification

```sql
-- Prompt v1 active
SELECT version_tag, is_active, activated_at FROM prompt_versions;

-- After trigger: summaries created + linked to prompt version
SELECT group_id, date, model, prompt_version_id, char_length(content) AS len
FROM ai_summaries ORDER BY generated_at DESC LIMIT 5;

-- No failures
SELECT group_id, error_msg FROM failed_summaries WHERE resolved = false;

-- Read a summary
SELECT LEFT(content, 400) FROM ai_summaries ORDER BY generated_at DESC LIMIT 1;
```

**Manual trigger (normal):**
```bash
EF=https://ftryuvfdihmhlzvbpfeu.supabase.co/functions/v1
SRK=<service_role_key>
curl -s -X POST "$EF/nightly-summary" \
  -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-15"}'
```

**Manual trigger (test mode — draft prompt version):**
```bash
curl -s -X POST "$EF/nightly-summary" \
  -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-15","version_id":"<v2-uuid>"}'
```
