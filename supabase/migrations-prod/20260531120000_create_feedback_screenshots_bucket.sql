-- M126 (PROD ONLY): Create feedback-screenshots storage bucket + RLS policy
--
-- WHY: Cutover B12 was supposed to migrate the bucket from DEV → PROD but didn't.
--   Discovered 2026-05-31 during DEV↔PROD parity audit: PROD has 0 storage.buckets
--   while DEV has 1 (`feedback-screenshots`, public, 8 objects). Frontend code at
--   src/components/FeedbackButton.jsx:41,48 calls
--   `supabase.storage.from('feedback-screenshots').upload(...)`. Without the bucket
--   the upload fails silently (screenshotWarn=true), text-only feedback still
--   submits, but admin email arrives without the screenshot link.
--
-- SOURCE OF TRUTH: this is a verbatim copy of DEV's bucket row + the single RLS policy
--   on storage.objects scoped to this bucket. DEV `public=true`, so SELECT works via
--   public CDN URL (matches getPublicUrl() call in FeedbackButton.jsx:48-50).
--
-- POLICY: authenticated users can only upload to a folder matching their auth.uid().
--   Folder convention enforced by frontend: `${user.id}/${Date.now()}.${ext}` (line 39).
--   storage.foldername(name)[1] returns the first path segment = user_id.
--
-- ID/MIME LIST/SIZE LIMIT all match DEV exactly:
--   - file_size_limit: 5 MB (5242880 bytes)
--   - allowed_mime_types: jpeg, png, webp, gif, heic (heic for iOS screenshots)
--   - avif_autodetection: false

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
VALUES (
  'feedback-screenshots',
  'feedback-screenshots',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic'],
  false
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "feedback-screenshots: authenticated upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'feedback-screenshots'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);
