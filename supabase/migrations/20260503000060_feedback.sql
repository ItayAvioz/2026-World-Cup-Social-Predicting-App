-- M60: In-app feedback system
-- Table: feedback
-- Storage bucket: feedback-screenshots (private, 5MB limit)

-- ─────────────────────────────────────────────────────────────
-- 1. TABLE
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert their own feedback
CREATE POLICY "feedback: authenticated insert"
  ON public.feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No SELECT from frontend — admin reads via Supabase dashboard (service_role bypasses RLS)

-- ─────────────────────────────────────────────────────────────
-- 3. STORAGE BUCKET
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. STORAGE RLS
-- ─────────────────────────────────────────────────────────────
-- Users can upload only to their own subfolder: {user_id}/{filename}
CREATE POLICY "feedback-screenshots: authenticated upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
