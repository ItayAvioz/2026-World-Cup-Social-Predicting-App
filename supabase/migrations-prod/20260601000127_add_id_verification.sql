-- M127 (PROD ONLY): add id_verification column to top_scorer_candidates
-- Snapshot of 2026-06-01 reconciliation of our api_player_id against api-football WC2026 squads.
--
-- 5 status values (plus 'no_api_id' used in JSON only):
--   fully_verified            -> in api WC squad for this team AND profile name matches
--   squad_ok_name_suspect     -> in api WC squad; name verifier flagged firstname (mostly initial-format false positives, harmless)
--   squad_ok_name_mismatch    -> in api WC squad; profile endpoint returned a different display name (api stale, squad endpoint authoritative)
--   squad_missing_name_ok     -> NOT in api's preliminary WC roster but profile name matches (api roster incomplete - Ronaldo/Memphis/Davies etc.)
--   squad_missing_name_flagged-> doubly suspect: not in api WC roster AND profile name flagged (mostly initial-format false positives + ~4 obscure backup players)
--
-- Source of truth for status: data/wc2026_squads.json (mirrors per-row).
-- WHY THIS HELPS: future audits start from a known baseline; we can quickly see which
-- ids need re-verification when api refreshes WC squads after FIFA Jun 2 deadline.

ALTER TABLE public.top_scorer_candidates
  ADD COLUMN IF NOT EXISTS id_verification text;

-- Status values applied per-id by the Node script after pulling api-football data.
-- (Actual UPDATE statements applied via execute_sql, not here, because they're per-id and
-- this migration just declares the column.)
