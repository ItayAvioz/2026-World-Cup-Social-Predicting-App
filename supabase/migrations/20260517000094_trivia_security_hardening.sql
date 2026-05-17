-- ================================================================
-- Migration 94: Trivia security hardening
-- Fix 1: Move correct_option + explanation to trivia_secrets
--         (no user SELECT policy — server-side only)
-- Fix 2: Time-lock RLS on trivia_questions
--         users can only read questions where available_from <= now()
-- ================================================================

-- 1. Create server-side-only secrets table
CREATE TABLE public.trivia_secrets (
  question_id    uuid    PRIMARY KEY REFERENCES public.trivia_questions(id) ON DELETE CASCADE,
  correct_option char(1) NOT NULL CHECK (correct_option IN ('a','b','c','d')),
  explanation    text
);
-- RLS enabled with no policies → table fully locked to all users
ALTER TABLE public.trivia_secrets ENABLE ROW LEVEL SECURITY;

-- 2. Migrate answers + explanations from trivia_questions
INSERT INTO public.trivia_secrets (question_id, correct_option, explanation)
SELECT id, correct_option, explanation FROM public.trivia_questions;

-- 3. Drop answer columns from the user-readable table
ALTER TABLE public.trivia_questions DROP COLUMN correct_option;
ALTER TABLE public.trivia_questions DROP COLUMN explanation;

-- 4. Replace RLS: time-lock — only expose questions whose unlock time has passed
DROP POLICY "authenticated read questions" ON public.trivia_questions;
CREATE POLICY "authenticated read unlocked questions"
  ON public.trivia_questions FOR SELECT TO authenticated
  USING (available_from <= now());

-- 5. Update submit_trivia_answer to read answers from trivia_secrets
--    RPC is SECURITY DEFINER so it can access trivia_secrets even without a user policy
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
  v_secret  public.trivia_secrets%ROWTYPE;
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

  SELECT * INTO v_secret FROM public.trivia_secrets WHERE question_id = p_question_id;

  v_correct := (p_selected_option = v_secret.correct_option);
  v_pts     := CASE WHEN v_correct THEN 1 ELSE 0 END;

  INSERT INTO public.trivia_answers(user_id, question_id, selected_option, is_correct, points_earned)
  VALUES (v_uid, p_question_id, p_selected_option, v_correct, v_pts);

  RETURN jsonb_build_object(
    'is_correct',     v_correct,
    'correct_option', v_secret.correct_option,
    'explanation',    v_secret.explanation,
    'points_earned',  v_pts
  );
END;
$$;
