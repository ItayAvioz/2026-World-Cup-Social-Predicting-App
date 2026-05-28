-- M114: backfill ai_summaries.display_data.global_ranks AND input_json.leaderboard[].global_rank
-- from the canonical SQL leaderboard. Fixes the JS-client 1000-row cap bug for historical summaries
-- (EF v35 onwards writes them correctly from the start). Roast TEXT is unchanged — only the
-- rank fields underneath the AI-written paragraph are refreshed.
-- Idempotent: re-running just overwrites with current-leaderboard values.
--
-- Root cause: nightly-summary EF (up to v34) re-implemented the leaderboard formula in JS by
-- summing predictions/champion_pick/top_scorer_pick rows pulled via the Supabase JS client, which
-- silently caps SELECT results at 1000 rows by default. Once `predictions WHERE points_earned
-- IS NOT NULL` exceeded 1000 (it was 1934 on 2026-05-28), the per-(user×group) sums were
-- under-counted by a random fraction → ranks went wrong. Same wrong value was stored in BOTH
-- display_data.global_ranks (the Total-standings table) AND input_json.leaderboard[].global_rank
-- (sent to the LLM). EF v35 (2026-05-28) replaces the JS recompute with a single get_leaderboard()
-- RPC call → no row cap + single source of truth shared with Dashboard / Groups.
--
-- Verified on Test3 / 2026-05-27: stored was Itay=1/zac=14/bob=16 → live get_leaderboard()
-- said 2/15/20. After this backfill the stored values match the live RPC exactly.

DO $$
DECLARE
  rec     RECORD;
  v_ranks jsonb;
  v_lb    jsonb;
BEGIN
  FOR rec IN
    SELECT id, group_id, input_json
    FROM public.ai_summaries
    WHERE group_id IS NOT NULL
  LOOP
    -- Build {username: rank} for THIS group's members from the canonical leaderboard
    SELECT jsonb_object_agg(p.username, l.rank)
    INTO v_ranks
    FROM public.get_leaderboard() l
    JOIN public.profiles p ON p.id = l.user_id
    WHERE l.group_id = rec.group_id;

    UPDATE public.ai_summaries
    SET display_data = jsonb_set(
      COALESCE(display_data, '{}'::jsonb),
      '{global_ranks}',
      COALESCE(v_ranks, '{}'::jsonb)
    )
    WHERE id = rec.id;

    -- Refresh input_json.leaderboard[].global_rank from the same source
    IF rec.input_json ? 'leaderboard'
       AND jsonb_typeof(rec.input_json->'leaderboard') = 'array' THEN
      SELECT jsonb_agg(
        CASE
          WHEN row->>'user' IS NOT NULL
               AND v_ranks IS NOT NULL
               AND v_ranks ? (row->>'user')
          THEN jsonb_set(row, '{global_rank}', v_ranks->(row->>'user'))
          ELSE row
        END
      )
      INTO v_lb
      FROM jsonb_array_elements(rec.input_json->'leaderboard') row;

      IF v_lb IS NOT NULL THEN
        UPDATE public.ai_summaries
        SET input_json = jsonb_set(input_json, '{leaderboard}', v_lb)
        WHERE id = rec.id;
      END IF;
    END IF;
  END LOOP;
END $$;
