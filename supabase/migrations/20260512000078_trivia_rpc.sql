-- ================================================================
-- Migration 78: Trivia — submit_trivia_answer RPC
-- ================================================================
-- SECURITY DEFINER so it can read correct_option (not exposed by RLS SELECT)
-- and INSERT into trivia_answers (no direct INSERT policy on that table).
-- Returns: is_correct, correct_option, explanation, points_earned
-- Errors: not_authenticated | question_not_found | question_not_available | already_answered
-- ================================================================

CREATE OR REPLACE FUNCTION public.submit_trivia_answer(
  p_question_id     uuid,
  p_selected_option text   -- 'a'|'b'|'c'|'d'|'timeout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_q       public.trivia_questions%ROWTYPE;
  v_uid     uuid := auth.uid();
  v_correct boolean;
  v_pts     int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_q FROM public.trivia_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'question_not_found'; END IF;

  IF NOW() < v_q.available_from OR NOW() > v_q.available_until THEN
    RAISE EXCEPTION 'question_not_available';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trivia_answers
    WHERE user_id = v_uid AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'already_answered';
  END IF;

  v_correct := (p_selected_option = v_q.correct_option);
  v_pts     := CASE WHEN v_correct THEN 1 ELSE 0 END;

  INSERT INTO public.trivia_answers(user_id, question_id, selected_option, is_correct, points_earned)
  VALUES (v_uid, p_question_id, p_selected_option, v_correct, v_pts);

  RETURN jsonb_build_object(
    'is_correct',     v_correct,
    'correct_option', v_q.correct_option,
    'explanation',    v_q.explanation,
    'points_earned',  v_pts
  );
END;
$$;
