-- M119: Partial unique index on prompt_versions.is_active
--
-- Gap discovered in the 2026-05-30 parity re-audit (3rd verification pass):
-- dev had `prompt_versions_active_idx` (partial UNIQUE on `is_active` WHERE
-- `is_active = true`); prod did not. Origin: likely created via dashboard or
-- before the migration tracking convention.
--
-- Functional role: enforces "at most one active prompt version at any time".
-- Protects the nightly-summary EF fallback path which does
-- `.from('prompt_versions').select('*').eq('is_active', true).single()` —
-- without this constraint, two `is_active=true` rows would make `.single()`
-- throw at runtime.
--
-- IF NOT EXISTS makes this idempotent. Applied to BOTH envs via
-- mcp__supabase__apply_migration. Dev was a no-op (index already there);
-- prod actually created the index.

CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_active_idx
  ON public.prompt_versions USING btree (is_active)
  WHERE (is_active = true);
