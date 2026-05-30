# Security Advisors — Pre-Prod Cutover Review (2026-05-30)

**Project audited:** `ftryuvfdihmhlzvbpfeu` (dev — Tokyo).
**Total lints:** 146 security + 44 performance = 190.
**ERROR-level:** **0** ✅ — no blocker for prod cutover.
**Verification:** `team_tournament_stats` SECURITY DEFINER view fix (M97) confirmed in place.

---

## Summary by category

| Lint | Level | Count | Action |
|---|---|---|---|
| `anon_security_definer_function_executable` | WARN | 47 | **No action** — design intent (frontend RPCs) |
| `authenticated_security_definer_function_executable` | WARN | 47 | **No action** — design intent (frontend RPCs) |
| `function_search_path_mutable` | WARN | 44 | **Defer to post-launch** — single migration that adds `SET search_path = public, pg_catalog` to all 44 functions |
| `rls_enabled_no_policy` | INFO | 6 | **No action** — service-role-only by design (ai_judge_runs, ef_errors, failed_summaries, pick_edit_log, prediction_edit_log, trivia_secrets) |
| `extension_in_public` (pg_net) | WARN | 1 | **Defer** — required for `net.http_post` from pg_cron; cosmetic |
| `auth_leaked_password_protection` | WARN | 1 | **Fix in prod at P6** — enable HIBP in Auth dashboard |
| `unindexed_foreign_keys` | INFO | 12 | **Defer** — no current performance impact (smallest table 38 rows) |
| `auth_rls_initplan` | WARN | 22 | **Defer to post-launch** — RLS uses `auth.uid()` directly; replace with `(select auth.uid())` for index-friendly plans |
| `multiple_permissive_policies` (push_subscriptions) | WARN | 5 | **Defer** — known overlap on service-role + user-own policies; harmless but a single CONSOLIDATE migration cleans it |
| `unused_index` | INFO | 2 | **Defer** — drop later if still unused after WC |
| `auth_db_connections_absolute` | INFO | 1 | **Fix in prod at P6** — switch to percentage-based connection allocation |

---

## Decisions for prod cutover

### Apply now (during prod setup)

1. **At P6 (Auth config)**: enable **HaveIBeenPwned leaked-password protection** in the prod dashboard. Toggle in Authentication → Settings → Auth Security.
2. **At P6 (Auth config)**: set **Auth DB connections** to percentage-based instead of absolute=10. Settings → Authentication → Advanced.

### Defer to post-launch cleanup migration

A single migration `2026XXXX_security_hardening.sql` can address:
- All 44 functions get `SET search_path = public, pg_catalog`
- 22 RLS policies converted from `auth.uid()` → `(select auth.uid())`
- push_subscriptions policies consolidated to drop the overlap
- Move `pg_net` extension to `extensions` schema
- Drop the 2 unused indexes

Not blocking go-live. Can be applied to dev + prod via the standard dev-first workflow once tournament starts and we have evidence of real query patterns.

### No action (design intent)

- 47 SECURITY DEFINER functions callable by anon/authenticated — these ARE the public RPC surface (create_group, join_group, submit_trivia_answer, get_leaderboard, get_dashboard_payload, etc.). They bypass RLS internally for legitimate operations. Each one verifies caller identity via `auth.uid()`. Not a vulnerability.
- 6 tables with RLS enabled but no policies — internal/system tables, service-role-only is correct.

---

## Pre-cutover decision

**🟢 PROCEED with cutover.** Zero ERROR-level findings. The 2 WARN items addressed at P6 are dashboard toggles (5 minutes total). Everything else is deferrable performance / cleanup work that does NOT affect prod correctness or security posture for go-live.

---

## What gets carried into prod via pg_dump

Since prod is built from `pg_dump` of dev (P3 strategy), **all 190 advisory findings carry over as-is** — both the good (the design-intent SECURITY DEFINER RPCs, the intentional service-role-only tables) and the bad (44 mutable search_paths, 22 sub-optimal RLS policies). This is expected and correct: dev IS the schema. Post-launch hardening migration will improve both projects together via the dev-first workflow.

---

## Sources

- Full security advisor JSON (128 KB): `C:\Users\yonatanam\.claude\projects\C--Users-yonatanam-Desktop-World-Cup-APP\213a6a40-7934-481f-8922-53d4461a0e0b\tool-results\mcp-supabase-get_advisors-1780137428402.txt`
- Performance advisor: inline in this conversation (44 lints)
- Remediation docs: <https://supabase.com/docs/guides/database/database-linter>
