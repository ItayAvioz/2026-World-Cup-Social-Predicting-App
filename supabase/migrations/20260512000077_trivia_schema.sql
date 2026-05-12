-- ================================================================
-- Migration 77: Trivia — questions + answers tables + RLS
-- ================================================================
-- trivia_questions: one row per calendar day (admin-seeded via migration)
--   Standard time slot: available_from = DATE 19:00:00+00 (22:00 Israel / UTC+3 summer)
--                       available_until = DATE+1 19:00:00+00 (24-hour window)
--   correct_option: NOT exposed to client via SELECT — only via RPC after submission
-- trivia_answers: one answer per (user, question)
--   INSERT via submit_trivia_answer RPC (SECURITY DEFINER) only
-- Points are accumulated here and added to the leaderboard at tournament end (M79).
--
-- Seeding format (one row per day):
--   INSERT INTO public.trivia_questions
--     (question_date, available_from, available_until,
--      question_text, option_a, option_b, option_c, option_d, correct_option, explanation)
--   VALUES
--     ('2026-06-11', '2026-06-11T19:00:00+00', '2026-06-12T19:00:00+00',
--      'Question text?', 'A', 'B', 'C', 'D', 'b', 'Explanation.');
-- ================================================================

CREATE TABLE public.trivia_questions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_date   date        UNIQUE NOT NULL,
  available_from  timestamptz NOT NULL,
  available_until timestamptz NOT NULL,
  question_text   text        NOT NULL,
  option_a        text        NOT NULL,
  option_b        text        NOT NULL,
  option_c        text        NOT NULL,
  option_d        text        NOT NULL,
  correct_option  char(1)     NOT NULL CHECK (correct_option IN ('a','b','c','d')),
  explanation     text,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE public.trivia_answers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id     uuid        NOT NULL REFERENCES public.trivia_questions(id),
  selected_option text        NOT NULL,
  is_correct      boolean     NOT NULL,
  points_earned   int         NOT NULL DEFAULT 0,
  answered_at     timestamptz DEFAULT now(),
  UNIQUE(user_id, question_id)
);

ALTER TABLE public.trivia_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read questions"
  ON public.trivia_questions FOR SELECT TO authenticated USING (true);

ALTER TABLE public.trivia_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own answers"
  ON public.trivia_answers FOR SELECT TO authenticated
  USING (user_id = auth.uid());
