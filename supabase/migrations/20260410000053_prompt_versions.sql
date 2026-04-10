-- Migration 53: prompt_versions table + update fn_schedule_ai_summaries to 150min + seed v1 prompt
-- Creates versioned AI prompt management for the nightly-summary Edge Function.
-- Each row = one prompt version (draft → tested → active).
-- EF reads the active prompt at runtime — prompts can be iterated without redeploying.

-- ─────────────────────────────────────────────
-- 1. prompt_versions table
-- ─────────────────────────────────────────────
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
  activated_at          timestamptz,                         -- when is_active flipped to true
  deprecated_at         timestamptz                          -- when superseded by next version
);

-- Enforce exactly one active version at a time
CREATE UNIQUE INDEX prompt_versions_active_idx
  ON public.prompt_versions (is_active)
  WHERE is_active = true;

-- ─────────────────────────────────────────────
-- 2. Activation trigger — auto-sets activated_at, deprecates previous active
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_manage_prompt_activation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only act when a row is being activated (false → true)
  IF NEW.is_active = true AND OLD.is_active = false THEN
    NEW.activated_at := now();
    -- Deactivate all other active versions
    UPDATE public.prompt_versions
      SET is_active = false, deprecated_at = now()
      WHERE is_active = true AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prompt_activation
  BEFORE UPDATE ON public.prompt_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_manage_prompt_activation();

-- ─────────────────────────────────────────────
-- 3. RLS — service role only (EF + admin SQL)
-- ─────────────────────────────────────────────
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON public.prompt_versions
  USING  (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────
-- 4. Link ai_summaries to the prompt version that generated it
-- ─────────────────────────────────────────────
ALTER TABLE public.ai_summaries
  ADD COLUMN prompt_version_id uuid
    REFERENCES public.prompt_versions(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- 5. Update fn_schedule_ai_summaries: 110min → 150min
--    (covers 90-min game + 30-min ET/pens + buffer for API sync)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_schedule_ai_summaries()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_day       record;
  v_fire_at   timestamptz;
  v_cron      text;
  v_job_name  text;
  v_ef_url    text;
  v_srk       text;
BEGIN
  SELECT decrypted_secret INTO v_ef_url
  FROM vault.decrypted_secrets WHERE name = 'app_edge_function_url';

  SELECT decrypted_secret INTO v_srk
  FROM vault.decrypted_secrets WHERE name = 'app_service_role_key';

  -- One cron per distinct UTC game-day, fires at last kickoff + 150 min
  FOR v_day IN
    SELECT
      kick_off_time::date AS game_date,
      MAX(kick_off_time)  AS last_kickoff
    FROM public.games
    GROUP BY kick_off_time::date
    ORDER BY kick_off_time::date
  LOOP
    v_fire_at  := v_day.last_kickoff + interval '150 minutes';
    v_job_name := 'ai-summary-' || v_day.game_date::text;

    v_cron :=
      EXTRACT(MINUTE FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(HOUR   FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(DAY    FROM v_fire_at AT TIME ZONE 'UTC')::int || ' ' ||
      EXTRACT(MONTH  FROM v_fire_at AT TIME ZONE 'UTC')::int || ' *';

    PERFORM cron.schedule(
      v_job_name,
      v_cron,
      format(
        'SELECT net.http_post(
            url := %L || ''/nightly-summary'',
            headers := jsonb_build_object(
              ''Content-Type'', ''application/json'',
              ''Authorization'', ''Bearer '' || %L
            ),
            body := jsonb_build_object(''date'', %L)::text
          )',
        v_ef_url,
        v_srk,
        v_day.game_date
      )
    );
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────
-- 6. Seed v1 prompt (active immediately)
-- ─────────────────────────────────────────────
INSERT INTO public.prompt_versions (
  version_tag,
  description,
  system_prompt,
  user_prompt_template,
  is_active,
  activated_at
) VALUES (
  'v1',
  'Initial prompt — social banter, compact JSON input, few-shot example for zero/auto-pick',

  -- SYSTEM PROMPT (5 parts concatenated)
  $SYS$ROLE
You are the AI pundit for a private friends' World Cup betting group.

AUDIENCE
Real friends who know each other personally — this summary lands directly in their WhatsApp group chat.
Write like you're in the group. Group-chat energy, not broadcast journalism.

---

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

---

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

---

TONE
- Savage but never mean-spirited — these are friends
- Specific > generic: use their actual usernames, scores, streaks
- auto-picks are the ultimate crime: treat them as evidence of neglect, not bad luck
- A streak of 3+ losses deserves genuine pity mixed with mockery
- A streak of 3+ wins deserves awe mixed with suspicion
- One match recap word = failure. Focus on the bets, not the football.
- No emojis in the output text

---

EXAMPLE

Input JSON (abbreviated):
{"group":"The Legends","date":"2026-06-16","leaderboard":[{"user":"alice_wc","total_pts":45,"today_pts":4,"streak":3},{"user":"bob_wc","total_pts":32,"today_pts":1,"streak":-3},{"user":"carol_wc","total_pts":28,"today_pts":0,"streak":-2}],"today":{"top_scorer":{"user":"alice_wc","pts":4},"zero_pts":[{"user":"carol_wc","all_auto":true}]},"games":[{"match":"Spain 3-0 Morocco","phase":"r16","scorers":["Morata 12'","Yamal 45'","Pedri 78'"],"dist_group":{"home_pct":70,"draw_pct":15,"away_pct":15,"n":3},"dist_global":{"home_pct":75,"draw_pct":14,"away_pct":11,"n":210,"top_score":"2-0","top_score_n":45,"exact_hits":1}}],"predictions":[{"user":"alice_wc","today_pts":4,"preds":[{"game":"Spain 3-0 Morocco","pred":"3-0","pts":4,"auto":false}]},{"user":"bob_wc","today_pts":1,"preds":[{"game":"Spain 3-0 Morocco","pred":"2-0","pts":1,"auto":false}]},{"user":"carol_wc","today_pts":0,"preds":[{"game":"Spain 3-0 Morocco","pred":"1-1","pts":0,"auto":true}]}],"picks":[{"user":"alice_wc","champion":"Spain","top_scorer":"Morata","scorer_goals_today":1},{"user":"bob_wc","champion":"France","top_scorer":"Mbappe","scorer_goals_today":0},{"user":"carol_wc","champion":"Brazil","top_scorer":"Vinicius","scorer_goals_today":0}]}

Expected output:
Alice is officially clairvoyant. Spain 3-0 Morocco — she called it exactly. Not a vague "Spain win" like the rest of the civilised world predicted, not the crowd-favourite 2-0 — three nil, exact. Four points, three-game win streak, and her Spain champion pick is marching through the knockouts. Smug is an understatement. Morata scoring today is just the cherry on top of her very smug cake.

Bob got the result right (Spain, obviously, like 70% of this group) but fluffed the score. One measly point. Three games without an exact score — the streak is quietly becoming a crisis, Bob. Mbappe was also a no-show today, which isn't helping the vibes.

Carol, meanwhile, apparently forgot the World Cup was happening. The system auto-picked 1-1 for a Spanish demolition. She is currently tied with a random number generator and losing on personality. Zero points, zero input, all auto. Sort yourself out before tomorrow — Brazil won't save you.$SYS$,

  -- USER MESSAGE TEMPLATE
  $TMPL$Here is today's group data. Write the nightly summary.

{{group_json}}$TMPL$,

  true,    -- is_active
  now()    -- activated_at
);
