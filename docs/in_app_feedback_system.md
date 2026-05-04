# Plan: In-App Feedback System

## Context
Adding a user-facing feedback channel during user testing sessions. Users need one place inside the app to report issues (בעיה) and submit improvement ideas (שיפור), with optional screenshot, priority tagging, and a Hebrew auto-response. All feedback is stored in Supabase DB (+ Storage for screenshots) and read by the admin via the Supabase dashboard — no admin UI in the app.

---

## What's Being Built

- **Floating 💬 button** — fixed bottom-right above BottomNav, visible on every authenticated page
- **3-step modal** — category → form → success auto-response
- **`feedback` Supabase table** — stores category, priority, message, screenshot path, user_id
- **`feedback-screenshots` Storage bucket** — private, 5 MB limit, user-scoped upload path

---

## Files to Create / Modify

| Action | File |
|---|---|
| CREATE | `supabase/migrations/20260503000060_feedback.sql` |
| CREATE | `src/components/FeedbackButton.jsx` |
| MODIFY | `src/components/Layout.jsx` — add `<FeedbackButton />` after `<BottomNav />` |
| MODIFY | `css/style.css` — add `feedback-*` CSS classes |

---

## Migration SQL (`20260503000060_feedback.sql`)

```sql
CREATE TABLE public.feedback (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category       text        NOT NULL CHECK (category IN ('issue', 'idea')),
  priority       text        NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  message        text        NOT NULL CHECK (char_length(message) > 0),
  screenshot_url text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_user_id    ON public.feedback(user_id);
CREATE INDEX idx_feedback_created_at ON public.feedback(created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- INSERT for authenticated users only (no SELECT from frontend)
CREATE POLICY "feedback: authenticated insert"
  ON public.feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Storage bucket (private, 5 MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-screenshots', 'feedback-screenshots', false, 5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Users can upload to their own subfolder only
CREATE POLICY "feedback-screenshots: authenticated upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
```

---

## FeedbackButton.jsx — State Machine

```text
closed → category → form → success → closed (on "סגור" or Escape/overlay-click)
```

Single state object `s` with fields: `step`, `category`, `priority`, `message`, `screenshotFile`, `screenshotWarn`, `submitting`.

### Submit logic
1. Validate `message.trim()` and `priority` are set (button disabled otherwise)
2. If `screenshotFile` → upload to `{user.id}/{Date.now()}.{ext}` in `feedback-screenshots`
   - Upload failure → set `screenshotWarn=true`, continue without screenshot
3. Insert row into `feedback` table
4. On DB error → `showToast('שגיאה בשליחת הפידבק', 'error')`, stay on form
5. On success → `step = 'success'`

### Key JSX decisions
- `<input type="file" accept="image/*" capture="environment">` — opens camera on mobile, gallery on desktop
- Category buttons hidden as FAB while `step !== 'closed'` (FAB only shows when closed to avoid double-clicking)
- `dir="rtl"` on textarea and all form containers
- Priority pill colors: low=green, medium=gold, high=red

### Auto-response messages
- Issue: `"תודה על הדיווח! נבדוק את הבעיה בהקדם 🔧"`
- Idea: `"תודה על הרעיון! כל הצעה חשובה לנו ✨"`

---

## Layout.jsx Change (2 lines)

```jsx
// Add import at top:
import FeedbackButton from './FeedbackButton.jsx'

// Add after <BottomNav />:
<FeedbackButton />
```

---

## CSS Classes (add to css/style.css)

Key classes: `.feedback-fab` (fixed, z-index 300, above BottomNav z-index 200), `.feedback-category-grid` (2-col grid), `.feedback-priority-pill` + `.active.priority-{low|medium|high}` (green/gold/red), `.feedback-textarea` (RTL, dark theme), `.feedback-file-input` (hidden, label-triggered), `.feedback-success` (centered flex column).

FAB position: `bottom: calc(64px + env(safe-area-inset-bottom) + 12px)` — clears the 64px BottomNav.

---

## Reused Patterns
- `Modal` from `src/components/Modal.jsx` — `isOpen` / `onClose` / `children`
- `useToast()` from `src/context/ToastContext.jsx` — error toast on DB failure
- `useAuth()` from `src/context/AuthContext.jsx` — `user.id` for insert + upload path
- CSS vars: `--bg2`, `--bg3`, `--accent`, `--border`, `--radius`, `--red`, `--green`, `--muted`
- Migration SQL style: table + RLS + storage bucket in one file, index on FK + created_at

---

## Verification

1. **Migration** — apply M60, confirm `feedback` table + `feedback-screenshots` bucket + 2 RLS policies in Supabase dashboard
2. **FAB visible** — open any page, confirm gold 💬 appears above BottomNav, no overlap
3. **Flow** — tap FAB → step 1 category → tap בעיה → step 2 form → fill message + priority → submit → step 3 success message → close → FAB reappears
4. **Back button** — from step 2, tap ← חזרה → returns to step 1 with preserved category null
5. **Screenshot** — attach image, submit; confirm file in Storage at `{user_id}/{ts}.jpg` and `screenshot_url` populated in `feedback` table
6. **No screenshot** — submit without file; confirm `screenshot_url = null` in DB
7. **DB error** — error toast appears, modal stays on form
8. **Escape / overlay click** — closes modal, full state reset (reopening starts at step 1)
9. **Admin read** — Supabase dashboard → Table Editor → `feedback` rows visible
