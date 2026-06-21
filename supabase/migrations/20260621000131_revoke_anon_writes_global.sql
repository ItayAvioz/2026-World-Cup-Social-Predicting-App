-- ================================================================
-- Migration 131: Global anon write hardening (defense-in-depth)
-- ================================================================
-- Follow-up to M130. M130 locked the 9 client-writable tables (column-level)
-- and closed the points_earned exploit. This migration strips ALL write
-- privileges from the `anon` role on EVERY public table — removing the latent
-- Supabase-default `GRANT ALL TO anon` grants that today are blocked only by
-- RLS. Removing them means a future RLS misconfig (disabled RLS, or a sloppy
-- WITH CHECK (true) policy) cannot silently expose a table to anonymous writes.
--
-- SAFE — verified:
--   * The app NEVER writes as anon. All client writes are `authenticated`.
--   * Registration writes go through SECURITY DEFINER RPCs (create_profile,
--     join_group, create_group) — anon retains EXECUTE on those (function
--     grants are untouched by a table REVOKE).
--   * SELECT is PRESERVED (landing page + pre-login reads keep working).
--   * `authenticated` grants are untouched (M130 column grants intact).
--
-- Applied to BOTH dev + prod. Idempotent (no-op where already revoked).
-- Scope = writes only; does NOT change anon SELECT (table read visibility is
-- governed separately by RLS + earlier M94/M95/M96 revokes).
-- ================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;

-- Best-effort: stop future tables (created by the migration role in this schema)
-- from re-granting writes to anon. Coverage depends on the table-creator role;
-- the dev/prod parity audit re-checks anon write grants regardless.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
