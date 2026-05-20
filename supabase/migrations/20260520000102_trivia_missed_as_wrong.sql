-- M102: Trivia — count missed questions as wrong.
-- Before: user who skipped a question got no row in trivia_answers → "free pass" (0/0 accuracy unchanged).
-- After:  at each question's available_until, a cron auto-inserts a miss row
--         (selected_option='miss', is_correct=false, points_earned=0) for every user
--         who was already registered when the question opened.
-- Effect: missed days now count toward accuracy as wrong answers; total_pts unchanged
--         (still 0 for a miss). Push notification untouched.

CREATE OR REPLACE FUNCTION public.fn_auto_miss_trivia(p_question_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_available_from timestamptz;
BEGIN
  SELECT available_from INTO v_available_from
  FROM public.trivia_questions WHERE id = p_question_id;

  IF v_available_from IS NULL THEN RETURN; END IF;

  INSERT INTO public.trivia_answers
    (user_id, question_id, selected_option, is_correct, points_earned, answered_at)
  SELECT p.id, p_question_id, 'miss', false, 0, now()
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.created_at <= v_available_from
  ON CONFLICT (user_id, question_id) DO NOTHING;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_auto_miss_trivia failed for %: %', p_question_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_schedule_trivia_miss(
  p_question_id uuid,
  p_available_until timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cron     text;
  v_job_name text;
BEGIN
  IF p_available_until <= now() THEN RETURN; END IF;

  v_job_name := 'trivia-miss-' || left(p_question_id::text, 8);
  v_cron :=
    EXTRACT(MINUTE FROM p_available_until AT TIME ZONE 'UTC')::int || ' ' ||
    EXTRACT(HOUR   FROM p_available_until AT TIME ZONE 'UTC')::int || ' ' ||
    EXTRACT(DAY    FROM p_available_until AT TIME ZONE 'UTC')::int || ' ' ||
    EXTRACT(MONTH  FROM p_available_until AT TIME ZONE 'UTC')::int || ' *';

  PERFORM cron.schedule(
    v_job_name,
    v_cron,
    format('SELECT public.fn_auto_miss_trivia(%L::uuid)', p_question_id)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_schedule_trivia_miss failed for %: %', p_question_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_schedule_trivia_miss_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM public.fn_schedule_trivia_miss(NEW.id, NEW.available_until);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_schedule_trivia_miss: scheduling failed for question %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_trivia_miss ON public.trivia_questions;
CREATE TRIGGER trg_schedule_trivia_miss
AFTER INSERT ON public.trivia_questions
FOR EACH ROW EXECUTE FUNCTION public.trg_schedule_trivia_miss_fn();

DO $$
DECLARE
  v_q record;
BEGIN
  FOR v_q IN
    SELECT id, available_until
    FROM public.trivia_questions
    WHERE available_until > now()
  LOOP
    PERFORM public.fn_schedule_trivia_miss(v_q.id, v_q.available_until);
  END LOOP;
END;
$$;
