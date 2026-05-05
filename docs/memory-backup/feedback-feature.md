---
name: feedback-feature
description: In-app Hebrew feedback system — DB schema, storage, component structure, admin access, and RLS
type: project
originSessionId: b0b4c415-382d-48d7-ba71-11f96d290bc8
---
# In-App Feedback System

Built 2026-05-03. Deployed to GitHub Pages same day.

## DB — `feedback` table (M60)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | auto |
| user_id | uuid → auth.users | ON DELETE CASCADE |
| category | text | `'issue'` or `'idea'` |
| priority | text | `'low'`, `'medium'`, `'high'` |
| message | text | free-form, Hebrew |
| screenshot_url | text | full public URL to image in Storage (nullable) |
| created_at | timestamptz | auto |

Indexes: `idx_feedback_user_id`, `idx_feedback_created_at DESC`

## RLS
- **INSERT**: authenticated users, own row only (`auth.uid() = user_id`)
- **SELECT/UPDATE/DELETE**: none from frontend — admin reads via Supabase dashboard (service_role bypasses RLS)

## Storage — `feedback-screenshots` bucket (M60 + M61)
- **Public bucket** (M61 set `public = true`)
- Upload path: `{user_id}/{Date.now()}.{ext}`
- 5 MB file size limit
- Allowed MIME: jpeg, png, webp, gif, heic
- Storage RLS: authenticated users upload to own subfolder only (`(storage.foldername(name))[1] = auth.uid()::text`)
- `screenshot_url` stores full `getPublicUrl()` result — paste in browser to view image directly

## Admin View — `feedback_readable` (M62)
SQL view in `public` schema joining `feedback` + `profiles`:
```sql
SELECT p.username, f.category, f.priority, f.message, f.screenshot_url, f.created_at
FROM public.feedback f JOIN public.profiles p ON p.id = f.user_id
ORDER BY f.created_at DESC
```
Access: Supabase dashboard → Table Editor → `feedback_readable`

## Component — `src/components/FeedbackButton.jsx`
- Floating 💬 FAB, fixed bottom-right, z-index 300, above BottomNav (z-index 200)
- FAB position: `bottom: calc(64px + env(safe-area-inset-bottom) + 12px)`
- Only renders for authenticated users (`useAuth`)
- 3-step state machine: `closed → category → form → success`
- Step 1: pick בעיה (issue) or שיפור (idea)
- Step 2: priority pills (נמוך/בינוני/גבוה) + textarea (RTL) + optional photo upload
- Step 3: Hebrew auto-response per category, "סגור" button
- Screenshot upload: `<input type="file" accept="image/*" capture="environment">` — camera on mobile, gallery on desktop
- Upload failure → `screenshotWarn` shown, submit proceeds without screenshot
- Uses: `Modal`, `useToast`, `useAuth`, `supabase`

## Layout.jsx change
Added `import FeedbackButton` + `<FeedbackButton />` after `<BottomNav />` — present on every authenticated page.

## CSS
All classes prefixed `feedback-` in `css/style.css`. Key: `.feedback-fab`, `.feedback-step`, `.feedback-category-grid`, `.feedback-priority-pill.active.priority-{low|medium|high}`, `.feedback-success`.

## How to read feedback (admin)
- **Rows**: Supabase dashboard → Table Editor → `feedback_readable` (username visible)
- **Screenshots**: `screenshot_url` is a full public URL — copy/paste into browser to view
