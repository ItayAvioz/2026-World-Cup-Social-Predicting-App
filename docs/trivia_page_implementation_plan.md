# Trivia Page — Implementation Plan

## Context

Add a daily Trivia page to the WorldCup 2026 app. Starting from the tournament kick-off day (June 11, 2026), one football question is available each day within a defined time window. Users click "Open Question", have 60 seconds to pick one of 4 options, and earn 1 point for a correct answer.

**Trivia points are NOT added to the leaderboard during the tournament.** They are awarded in bulk after the tournament ends — at the same moment champion + top scorer points are finalized. Before the tournament starts, the page shows an explanation / teaser screen.

---

## Decisions

| # | Decision |
|---|---|
| Timer expiry | Timer hits 0 → call `submit_trivia_answer` with `'timeout'` → correct answer + explanation revealed, 0 points |
| Leaderboard scope | Per-user global (same trivia points in all group rows). Applied only after tournament ends |
| Leaderboard timing | **Deferred** — M79 (leaderboard update) is a separate migration applied manually after tournament ends |
| User stats | Total trivia points · Correct/Total count · Percentage |
| Correct answer security | `correct_option` NOT in client SELECT — only returned by SECURITY DEFINER RPC after answer submitted |
| Question window | Each question has `available_from` + `available_until` timestamps — defined per question when seeding |
| Pre-tournament state | Page shows explanation card ("Tournament starts June 11 — daily trivia questions will appear here") |
| Questions start | June 11, 2026 — one question every calendar day during the tournament (~30 days) |

---

## Phase 1 — Database (migrations M77, M78, M79)

### M77 — Schema

```sql
CREATE TABLE public.trivia_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_date   date UNIQUE NOT NULL,             -- calendar day (UTC)
  available_from  timestamptz NOT NULL,             -- question unlocks at this time
  available_until timestamptz NOT NULL,             -- question expires at this time
  question_text   text NOT NULL,
  option_a        text NOT NULL,
  option_b        text NOT NULL,
  option_c        text NOT NULL,
  option_d        text NOT NULL,
  correct_option  char(1) NOT NULL CHECK (correct_option IN ('a','b','c','d')),
  explanation     text,                             -- optional, shown after answer
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE public.trivia_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id     uuid NOT NULL REFERENCES public.trivia_questions(id),
  selected_option text NOT NULL,                   -- 'a'|'b'|'c'|'d'|'timeout'
  is_correct      boolean NOT NULL,
  points_earned   int NOT NULL DEFAULT 0,
  answered_at     timestamptz DEFAULT now(),
  UNIQUE(user_id, question_id)
);

-- RLS: any authenticated user can read questions (correct_option excluded at query level — returned only by RPC)
ALTER TABLE public.trivia_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read questions"
  ON public.trivia_questions FOR SELECT TO authenticated USING (true);

-- RLS: users see only their own answers; INSERT via RPC (SECURITY DEFINER) only
ALTER TABLE public.trivia_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own answers"
  ON public.trivia_answers FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

### M78 — `submit_trivia_answer` RPC

```sql
CREATE OR REPLACE FUNCTION public.submit_trivia_answer(
  p_question_id     uuid,
  p_selected_option text    -- 'a'|'b'|'c'|'d'|'timeout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_q   public.trivia_questions%ROWTYPE;
  v_uid uuid := auth.uid();
  v_correct boolean;
  v_pts   int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_q FROM public.trivia_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'question_not_found'; END IF;

  -- Enforce availability window
  IF NOW() < v_q.available_from OR NOW() > v_q.available_until
    THEN RAISE EXCEPTION 'question_not_available'; END IF;

  IF EXISTS (SELECT 1 FROM public.trivia_answers WHERE user_id = v_uid AND question_id = p_question_id)
    THEN RAISE EXCEPTION 'already_answered'; END IF;

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
```

### M79 — Leaderboard update (APPLY AFTER TOURNAMENT ENDS)

This migration is written now but **applied manually after the tournament finalizes** — at the same time champion + top scorer points are awarded.

Modify both `get_leaderboard()` and `get_group_leaderboard()` — in the `scores` CTE:

```sql
-- Add per-user trivia total (global, not per-group):
COALESCE((
  SELECT SUM(ta.points_earned)
  FROM public.trivia_answers ta
  WHERE ta.user_id = p.id
), 0) AS trivia_points
```

Then in `total_points`:
```sql
COALESCE(SUM(pr.points_earned), 0)
  + COALESCE(MAX(cp.points_earned), 0)
  + COALESCE(MAX(ts.points_earned), 0)
  + trivia_points    -- ← added at tournament end
AS total_points
```

Because trivia is per-user (not per-group), the same `trivia_points` value is added to **every** (user × group) row for that user.

---

## Phase 2 — Frontend (3 files changed + 1 new)

### `src/components/BottomNav.jsx`

Add 5th tab after AI:

```jsx
const IconTrivia = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)
// In TABS array, after AI:
{ to: '/trivia', label: 'Trivia', Icon: IconTrivia }
```

### `src/App.jsx`

```jsx
import Trivia from './pages/Trivia.jsx'
// In <Routes>:
<Route path="/trivia" element={<AuthGuard><Trivia /></AuthGuard>} />
```

### `src/pages/Trivia.jsx` (new file)

**Page states**

| State | Condition | UI |
|---|---|---|
| `loading` | On mount | Spinner |
| `pre_tournament` | Today < 2026-06-11 OR no question row exists for any date yet | Explanation teaser card |
| `no_question` | Tournament started, but no question for today | "No question today — come back tomorrow" |
| `not_yet` | Question exists but `available_from` is in the future | "Today's question unlocks at HH:MM" + countdown |
| `idle` | Question available, user hasn't answered | Stats + "Open Today's Question" button |
| `active` | User clicked Open — timer running (60s) | Question + 4 option buttons + countdown |
| `result` | Answer submitted or timed out | Result card — correct answer highlighted + explanation + stats update |
| `already_answered` | User already answered today (page reload) | Shows result card with stored answer (need correct_option from a separate RPC or store it after first submit) |

**On mount logic**

```
1. Fetch today's question:
   supabase.from('trivia_questions')
     .select('id, question_date, available_from, available_until, question_text, option_a, option_b, option_c, option_d')
     .eq('question_date', todayUTC())
     .maybeSingle()

2. Fetch user's answer for this question (if question exists):
   supabase.from('trivia_answers')
     .select('selected_option, is_correct, points_earned')
     .eq('question_id', q.id)
     .eq('user_id', user.id)
     .maybeSingle()

3. Fetch user stats:
   supabase.from('trivia_answers')
     .select('points_earned, is_correct')
     .eq('user_id', user.id)
   → compute: total_pts, correct_count, total_count, pct
```

**Key implementation notes**

- `todayUTC()`: `new Date().toISOString().slice(0,10)` — compare against `question_date`
- Timer: `useRef` for interval ID, clear on unmount and on answer submit
- If already answered, we don't have `correct_option` (not stored in `trivia_answers`). Solution: call `submit_trivia_answer` would error with `already_answered`. Instead, store `correct_option` in `localStorage` keyed by `question_id` after first submit, read it on reload for the result card display.
- `logEvent(supabase, user.id, 'page_view', 'trivia')` on mount
- `logEvent(supabase, user.id, 'trivia_answer', is_correct ? 'correct' : 'wrong')` on submit

**Pre-tournament explanation card (state: `pre_tournament`)**

```
┌────────────────────────────────┐
│  🏆 Daily Trivia               │
│                                │
│  Starting June 11, a new       │
│  football question will appear │
│  every day.                    │
│                                │
│  You have 1 minute to answer.  │
│  Correct answer = 1 point.     │
│  Points count toward the final │
│  tournament leaderboard.       │
│                                │
│  Come back on June 11!         │
└────────────────────────────────┘
```

**Active question layout**

```
┌────────────────────────────────┐
│  Layout title="Trivia"         │
│                                │
│  ┌─ Stats ─────────────────┐   │
│  │ 7 pts · 7/10 · 70%     │   │
│  └─────────────────────────┘   │
│                                │
│  ┌─ Question card ─────────┐   │
│  │  :60 ← timer            │   │
│  │  "Which country...?"    │   │
│  │  [A] Germany            │   │
│  │  [B] Brazil             │   │
│  │  [C] Argentina          │   │
│  │  [D] Italy              │   │
│  └─────────────────────────┘   │
└────────────────────────────────┘
```

---

## Question Seeding Format

When user provides questions, insert via migration (batch per week or full set upfront):

```sql
INSERT INTO public.trivia_questions
  (question_date, available_from, available_until,
   question_text, option_a, option_b, option_c, option_d,
   correct_option, explanation)
VALUES
  ('2026-06-11',
   '2026-06-11 08:00:00+00', '2026-06-11 23:59:59+00',
   'Which country has won the most World Cups?',
   'Germany', 'Brazil', 'Argentina', 'Italy',
   'b',
   'Brazil has won 5 World Cups (1958, 1962, 1970, 1994, 2002).'),
  -- one row per day...
;
```

---

## Verification

1. **DB**: Run M77 → confirm both tables exist with correct constraints and RLS enabled
2. **DB**: Insert a test question with `question_date = TODAY`, `available_from = NOW()-1min`, `available_until = NOW()+1hr`
3. **RPC M78**: Call `submit_trivia_answer(id, 'b')` → confirm returns `{is_correct, correct_option, explanation, points_earned}`
4. **RPC**: Call again → confirm `already_answered` exception
5. **RPC**: Call with a past/future question → confirm `question_not_available` exception
6. **M79** (deferred — verify logic in staging only): `get_leaderboard()` returns higher `total_points` after trivia points included
7. **Browser — pre-tournament**: Set test date before June 11 (or remove question row) → page shows explanation teaser
8. **Browser — idle**: Question exists and window open → Stats card + "Open Today's Question" button visible
9. **Browser — active**: Click button → question appears, 60s timer counts down
10. **Browser — answer**: Select option → result card shows correct answer highlighted + explanation
11. **Browser — reload**: Reload after answering → correct answer still shown (via localStorage)
12. **Browser — nav**: BottomNav shows 5 tabs including Trivia

---

## Files to Modify / Create

| File | Change |
|---|---|
| `supabase/migrations/YYYYMMDD000077_trivia_schema.sql` | New — tables + RLS |
| `supabase/migrations/YYYYMMDD000078_trivia_rpc.sql` | New — submit_trivia_answer RPC |
| `supabase/migrations/YYYYMMDD000079_leaderboard_trivia.sql` | New — leaderboard update (apply at tournament end) |
| `src/pages/Trivia.jsx` | New — Trivia page |
| `src/App.jsx` | Add import + route for /trivia |
| `src/components/BottomNav.jsx` | Add Trivia tab + icon |
