CREATE OR REPLACE FUNCTION public.get_my_trivia_result(p_question_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_secret public.trivia_secrets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Only return the secret if the user has already answered this question.
  IF NOT EXISTS (
    SELECT 1 FROM public.trivia_answers
    WHERE user_id = v_uid AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'not_answered';
  END IF;

  SELECT * INTO v_secret FROM public.trivia_secrets WHERE question_id = p_question_id;

  RETURN jsonb_build_object(
    'correct_option', v_secret.correct_option,
    'explanation',    v_secret.explanation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_trivia_result(uuid) TO authenticated;
