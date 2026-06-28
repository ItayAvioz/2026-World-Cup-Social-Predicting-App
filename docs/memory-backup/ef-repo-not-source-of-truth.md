---
name: ef-repo-not-source-of-truth
description: Repo edge-function files are NOT in sync with deployed EFs — the live PROD edge functions are the source of truth
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 96a9c962-1117-49bc-9399-b10242a99be6
---

The local `supabase/functions/**/index.ts` files are **NOT kept in sync** with the deployed Edge Functions. The **deployed PROD edge functions are the source of truth** (extends [[feedback_supabase_source_of_truth]] to EFs specifically).

Confirmed 2026-06-13 for `football-api-sync`: three divergent versions coexist — PROD deployed **v18** (v15 Cape Verde / v16 DR Congo / v17 Czechia / **v18 Bosnia hyphen-normalize root-cause aliases**, 2026-06-15..19 — see [[bosnia-team-name-mismatch]]), DEV deployed **v39**, and the repo `index.ts` is a large **uncommitted WIP rewrite** (978 lines changed) matching neither. The repo file has been stale/ahead for a while; nobody reconciles it. (v18 deploy method: authored the full file from the fetched v17 source, rewriting diacritic ranges as `̀-ͯ`; smoke-tested `{"mode":"__smoke__"}`→`{"error":"Unknown mode"}`.)

**Why:** **How to apply:**
- Before editing or deploying ANY edge function, **fetch the live source first** via `get_edge_function` (prod project `asugxlvgcmkxspzokydk`, dev `ftryuvfdihmhlzvbpfeu`), make the minimal change to THAT, and `deploy_edge_function` from it. Verify by fetching the deployed copy back and diffing (only-intended-change check).
- **Do NOT** deploy the repo `index.ts` assuming it's current — it can silently revert live fixes (e.g. the Bosnia `canon()` fix in [[bosnia-team-name-mismatch]] is in prod v14 but NOT in the repo WIP).
- Reconciling the repo to match prod (commit deployed v14 as canonical + converge dev) is deferred by user choice — the WIP must be triaged first. Until then, treat repo EF files as untrusted.
